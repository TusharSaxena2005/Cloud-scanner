# CloudScanner

Cloud security visibility with Google Sign-In, PostgreSQL workspaces, and independent cloud connections. The current scanner discovers GCP external HTTP(S) load balancers and traces forwarding rules, proxies, URL maps, backends, and Cloud Armor policies.

## What is implemented

- Google OIDC login; first sign-in creates a user and personal workspace.
- Separate **Connect GCP** authorization using the same Google account.
- User-delegated, read-only Google Cloud API access; no shared service account or ADC fallback.
- Workspace membership checks on every connection, preflight, and scan request.
- Encrypted refresh tokens, hashed browser session tokens, OAuth state/nonce/PKCE protection, and rate-limited OAuth starts.
- Permission preflight, live scan progress, coverage summary, backend filters, expandable resource flow, and resource inspector.
- Editable display name; email and passwords are managed by Google.
- Provider-neutral connections; AWS and Azure are displayed as future providers. Their credentials and scanners are **not implemented**.

Website login and cloud permissions are separate. Google Sign-In alone cannot scan projects. The user must approve Google Cloud read access and already have the IAM permissions listed in `backend/config/lb_permissions.yaml`. OAuth consent never grants additional IAM roles.

## Local setup (PowerShell)

Requires Python 3.12+, a supported Node.js release (22.12+), and PostgreSQL. Docker Compose is provided for a local database.

From the repository root:

```powershell
docker compose up -d postgres
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

Use `backend/.env.example` as a reference for `backend/.env`. If `.env` already exists, edit it; do not overwrite existing secrets. Old MongoDB settings are ignored by the application.

```dotenv
DATABASE_URL=postgresql+psycopg://cloudscanner:local-development-only@127.0.0.1:5432/cloudscanner
GOOGLE_CLIENT_ID=<web-oauth-client-id>
GOOGLE_CLIENT_SECRET=<web-oauth-client-secret>
PUBLIC_URL=http://127.0.0.1:5173
CREDENTIAL_ENCRYPTION_KEY=<fernet-key>
SESSION_COOKIE_SECURE=false
SESSION_HOURS=24
CORS_ORIGINS=["http://127.0.0.1:5173","http://localhost:5173"]
```

Generate a key locally and paste its output into `CREDENTIAL_ENCRYPTION_KEY`:

```powershell
.\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep this key outside the database, backed up securely. Losing it makes stored cloud credentials unreadable; changing it requires re-encrypting existing credentials or reconnecting accounts. Never commit `.env`, OAuth secrets, or database dumps. `postgresql://` URLs are also accepted and use the psycopg driver.

The Compose password is for local development. For a hosted database, use its connection URL and required TLS parameters, such as `?sslmode=require`. Change the local password using `POSTGRES_PASSWORD` before initially creating the Compose volume; changing that environment variable later does not change an existing database password.

## Configure Google OAuth

In your Google Cloud project:

1. Configure the Google Auth Platform consent screen and audience. While in testing, add your Google account as a test user.
2. Create an OAuth client of type **Web application**.
3. Register this exact redirect URI for local development:
   `http://127.0.0.1:5173/api/oauth/google/callback`
4. Put the client ID and secret in the backend environment.
5. Configure identity scopes (`openid`, `email`, `profile`) and Google Cloud read access (`https://www.googleapis.com/auth/cloud-platform.read-only`).

The app uses a backend authorization-code redirect flow. The frontend never receives access or refresh tokens. Register each deployment's callback URI exactly; it is always `${PUBLIC_URL}/api/oauth/google/callback`.

Google may require OAuth verification before public use of sensitive scopes. External apps in testing can have short-lived refresh grants; reconnect when Google expires or revokes access. Organization policies can also block user consent. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) and [verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

## Migrate and run

From `backend`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal, from `frontend`:

```powershell
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Keep this hostname consistent with `PUBLIC_URL`. Vite proxies `/api`, including the OAuth callback, to FastAPI.

1. Click **Continue with Google**.
2. Open **Cloud connections**, choose your workspace, and click **Connect GCP**.
3. Approve read-only cloud access using the same Google account.
4. Open **Scanner**, select the connection, and enter a GCP project ID.
5. Click **Check permissions**, resolve missing IAM permissions or disabled APIs, then **Start scan**.

Every scan repeats preflight on the backend using the selected connection. Switching or disconnecting a connection clears the browser's previous preflight and results. Revoked credentials require reconnecting. Disconnect deletes the encrypted credentials for that workspace; to revoke the complete Google grant, use your [Google account connections](https://myaccount.google.com/permissions). The app does not revoke the combined grant automatically, because it may also be used by the same account in another workspace.

## Existing MongoDB users

This change creates a new PostgreSQL schema; it does not read, modify, or delete the existing MongoDB database. Password login, password reset, and password changes have been removed. Existing sessions do not transfer. New Google sign-ins create personal workspaces automatically.

Optional migration tooling is in `backend/scripts/import_mongo_users.py`. It imports names, emails, creation dates, and demo flags, creating one workspace per mapped identity. It never imports passwords, old sessions, or tokens. Existing Google identities are skipped and are not overwritten. Live scan history was not persisted in MongoDB and therefore has no historical records to migrate.

To preserve selected legacy accounts, an operator must first verify the destination Google subject for each legacy account. Do not derive or automatically match Google identities from email alone. Prepare a private JSON mapping:

```json
{"<legacy-mongo-object-id>": "<verified-google-subject>"}
```

From `backend`, with the source URI supplied only in the terminal environment:

```powershell
.\.venv\Scripts\python.exe -m pip install 'pymongo>=4.10,<5'
$env:PYTHONPATH = "."
$env:MONGODB_URI = "<source-uri>"
.\.venv\Scripts\python.exe scripts/import_mongo_users.py --mapping C:\secure\identity-map.json
# After reviewing the preview counts:
.\.venv\Scripts\python.exe scripts/import_mongo_users.py --mapping C:\secure\identity-map.json --apply
```

Without `--apply`, the import rolls back all writes. With it, PostgreSQL writes commit as one transaction. MongoDB is accessed only for reads. Back up both databases before a real cutover.

To make an existing Google user a demo-only account, run:

```powershell
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe scripts/seed_demo.py --google-sub <verified-google-subject>
```

Demo identities can browse generated samples but cannot connect accounts or run live scans.

## Production serving

Build the frontend, set `PUBLIC_URL` to the HTTPS application origin, register its Google callback URI, set `SESSION_COOKIE_SECURE=true`, run migrations, then start FastAPI:

```powershell
cd frontend
npm ci
npm run build
cd ..\backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Serve UI and API through the same HTTPS origin. The backend serves the built frontend when `frontend/dist` exists at startup. Browser sessions use HttpOnly, SameSite=Lax cookies; callback state is one-use, expires after ten minutes, and is bound to the initiating browser. GCP connection callbacks are additionally bound to the current signed-in session. Use a trusted reverse proxy if proxy headers are enabled. Rate limiting uses the request's client IP.

No tables are created automatically at application startup. Alembic owns the schema. Never point test tooling at a production database.

## API

Interactive documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

- `POST /api/auth/google/start`: obtain a Google login URL and binding cookie.
- `GET /api/oauth/google/callback`: validate state, exchange code, verify Google identity, then redirect.
- `GET /api/auth/me`, `POST /api/auth/logout`, `PATCH /api/auth/profile`.
- `GET /api/workspaces`: workspaces accessible to the signed-in user.
- `GET /api/connections`: accessible connections and provider availability, without credentials.
- `POST /api/workspaces/{workspace_id}/connections/gcp/start`: begin cloud consent (workspace owner).
- `DELETE /api/connections/{connection_id}`: disconnect (workspace owner).
- `GET /api/permissions/manifest`.
- `POST /api/check-lb-permissions?connection_id=<id>` and `/stream`: body `{"project_id":"my-project"}`.
- `GET /api/v1/scan/{project_id}?connection_id=<id>` and `/{project_id}/stream?connection_id=<id>`.
- `GET /health`: process health only; does not establish Google or database connectivity.

Authentication mutations and connection mutations require `X-CloudScanner-Request: 1`. Scan APIs require a workspace-accessible GCP connection; they never use machine ADC. The legacy response field `service_account_email` now contains the connected user's email, retained for compatibility with the resource views.

## Validation

From `frontend`:

```powershell
npm test -- --maxWorkers=1
npm run build
```

From `backend`:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

FastAPI tests use a relational SQLite fixture and mocked Google exchanges. Migration tests compare the migrated schema with ORM metadata. PostgreSQL migration SQL can be inspected without connecting via `alembic upgrade head --sql`. These checks do not prove live Google consent, project permissions, or a hosted PostgreSQL connection.

## Current limits

- Only GCP external HTTP(S) load balancers are scanned, one project at a time. AWS, Azure, folder, and organization scanning are not implemented.
- One personal workspace is created per user. Membership enforcement is implemented; invitations and workspace administration UI are not.
- GCP connections currently require the same Google identity as website sign-in.
- Connections are persisted; live scan results remain in browser state/local storage and are cleared on authentication or connection changes. Persistent scan history is not implemented.
- A protected label indicates an attached resolved policy; it does not assess policy effectiveness. Unresolved resources require reviewing scan logs.

## License

[MIT](LICENSE).
