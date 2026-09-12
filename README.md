# Cloud Armor Scanner

**See which public Google Cloud backends have Cloud Armor coverage, and follow the resources behind each load balancer.**

Cloud Armor Scanner combines a React dashboard with a FastAPI backend. It checks Google Cloud permissions, discovers external HTTP(S) load balancers, and traces their forwarding rules, target proxies, URL maps, backend services, and attached security policies.

Google Cloud operations are read-only. Account and session data are stored in MongoDB Atlas.

## Features

- **Permission preflight:** check the configured credentials before scanning and see missing permissions.
- **Live scan progress:** stream activity logs while the backend discovers resources.
- **Coverage overview:** view load balancer, backend, protected, and unprotected counts.
- **Searchable backend list:** filter by project, load balancer, protection status, or resource name.
- **Expandable waterfall:** follow resource relationships down and to the right, with page scrolling and expand/collapse controls.
- **Resource inspector:** click a resource to open its details in a sidebar.
- **Accounts:** sign up, sign in, sign out, edit your profile, and change your password.
- **Demo workspace:** explore two sample projects individually or choose **All projects** for a combined view.

## Stack

- **Frontend:** React 19, Vite 8, CSS, hash-based navigation.
- **Backend:** Python, FastAPI, Uvicorn, Pydantic, Google Cloud client libraries.
- **Database:** MongoDB Atlas through PyMongo.
- **Authentication:** bcrypt password hashes and opaque cookie sessions.
- **Tests:** Vitest, React Testing Library, Python unittest, and mongomock.

## Quick start

### Prerequisites

- Python **3.12** (the version used for development).
- Node.js **22.12+** or a compatible newer release, with npm.
- A MongoDB Atlas cluster and database user with read/write access to the application database.
- For live scans: Google Cloud credentials with access to the target project. Demo browsing does not require Google Cloud credentials.

The commands below use **PowerShell** and start from the repository root.

### 1. Set up the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Create `backend/.env` using placeholders like these. If the file already exists, edit it instead of replacing your existing configuration.

```dotenv
MONGODB_URI=mongodb+srv://<database-user>:<url-encoded-password>@<cluster-host>/?appName=CloudScanner
MONGODB_DATABASE=cloudscanner
SESSION_COOKIE_SECURE=false
SESSION_HOURS=24
CORS_ORIGINS=["http://127.0.0.1:5173","http://localhost:5173"]
```

The backend loads this file relative to its own directory, regardless of where Uvicorn is launched. `.env` is ignored by Git; never put connection strings or account passwords in frontend code or documentation.

In Atlas, allow the backend machine's public IP in **Network Access**. On the first database connection, the app creates a unique email index and expiration indexes for sessions and authentication attempt records.

Start the API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. Start the frontend

Open another terminal from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the address printed by Vite, normally [http://127.0.0.1:5173](http://127.0.0.1:5173).

The development server proxies `/api` requests to `http://127.0.0.1:8000`. Both processes must be running. Create an account using **Create an account**, or seed a demo account using the instructions below.

> Use the same browser hostname consistently. `localhost` and `127.0.0.1` have separate cookie sessions.

## Connect Google Cloud

The backend uses **Application Default Credentials (ADC)**. Application login and Google Cloud authentication are separate: signing into the dashboard does not connect a Google account.

For local development with the Google Cloud CLI:

```powershell
gcloud auth application-default login
```

Alternatively, set a service account key path in the backend terminal before starting Uvicorn:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\scanner-service-account.json"
```

Keep credential files outside the repository. On Google Cloud infrastructure, the runtime can supply ADC through an attached service account.

### Required access

The permission manifest is [backend/config/lb_permissions.yaml](backend/config/lb_permissions.yaml). It includes project lookup and list/get access for forwarding rules, HTTP(S) proxies, URL maps, backend services, and security policies. Regional discovery also lists Compute Engine regions.

The configured principal needs sufficient access to the resources being inspected, and the relevant Compute Engine and Cloud Resource Manager APIs must be available. The preflight and scan logs help identify permission or API errors.

### Run a live scan

1. Sign in with a regular account.
2. Open **Scanner** and select **Project** scope.
3. Enter the Google Cloud project ID.
4. Click **Check permissions** and resolve any reported issues.
5. Click **Start scan**.
6. Explore **Unprotected Backends** or **Load Balancer Flow**.

Changing the project invalidates the previous permission check. The backend also performs its own preflight when a scan starts.

## Demo account and sample data

From `backend`, with MongoDB configured:

```powershell
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe scripts/seed_demo.py
```

The script creates `demo@example.com` and prints a generated password once. Save that password locally. It refuses to overwrite an account with the same email.

The sample workspace contains:

- **demo-cloud-armor:** 3 load balancers and 6 backends, with 3 protected and 3 unprotected.
- **demo-commerce-platform:** 2 load balancers and 4 backends, with 3 protected and 1 unprotected.
- **All projects:** a combined summary and backend list, with separate project branches in the waterfall.

Sample addresses and resource names are fictional. Sample data belongs to the demo account and is loaded after authentication. Demo accounts cannot call live scanning APIs.

## Profile and authentication

Click the initials avatar in the top bar to open **Your profile**.

- **Edit profile** updates your name and email. Email changes require your current password.
- **Change password** requires your current password and confirmation of the new one. Other sessions are invalidated after a successful change.
- New passwords use **bcrypt with cost 12** and a random salt. They must contain at least 8 characters and fit within **72 UTF-8 bytes**; passwords are never silently truncated.
- Existing scrypt hashes remain compatible. They are upgraded after a successful login when the password fits bcrypt's limit. Longer legacy passwords remain usable until changed.
- Session cookies are **HttpOnly**, use **SameSite=Strict**, and expire after the configured lifetime. MongoDB stores a hash of each session token, not the browser token itself.
- Authentication mutations require the application's request header. Login and signup attempts are rate limited.

Live scan results are held in browser state and mirrored to local storage. Authentication changes clear that state, and a page reload starts a fresh live workspace. MongoDB currently persists accounts, sessions, attempt records, and seeded demo snapshots—not a live scan history.

## Build and serve with FastAPI

From the repository root:

```powershell
cd frontend
npm ci
npm run build
cd ..\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000). FastAPI serves `frontend/dist/index.html` and `/assets`. Build the frontend **before** starting the backend, and restart the backend if it was started before the build directory existed.

For an HTTPS deployment, set `SESSION_COOKIE_SECURE=true` and serve the UI and API through the same origin. The frontend currently uses same-origin credentials; changing CORS settings alone does not enable a separately hosted cross-origin login flow.

`npm run preview` previews the static build. It is not the documented full-stack serving path; use FastAPI to verify authentication and scanning with a production build.

## Configuration

Settings are defined in [backend/app/config.py](backend/app/config.py).

- `MONGODB_URI`: backend-only Atlas connection string.
- `MONGODB_DATABASE`: application database; defaults to `cloudscanner`.
- `SESSION_HOURS`: session lifetime; defaults to `24`.
- `SESSION_COOKIE_SECURE`: `false` for local HTTP; set to `true` when deploying over HTTPS.
- `CORS_ORIGINS`: JSON list of allowed browser origins. Local Vite origins are configured by default.
- `PERMISSION_MANIFEST_PATH`: optional alternate permission manifest path; an absolute path avoids launch-directory ambiguity.
- `GCP_SERVICE_ACCOUNT_EMAIL` and `GCP_SERVICE_ACCOUNT_UNIQUE_ID`: identity metadata/fallback values. These do not provide Google Cloud credentials or grant permissions.

Use Uvicorn's `--host` and `--port` arguments to choose the listening address. If the API port changes, update the proxy in [frontend/vite.config.js](frontend/vite.config.js).

## API

Interactive API documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) while the backend is running.

**Accounts**

- `POST /api/auth/signup`: create an account and session.
- `POST /api/auth/login`: authenticate and start a session.
- `GET /api/auth/me`: retrieve the current account.
- `POST /api/auth/logout`: revoke the current session.
- `PATCH /api/auth/profile`: update account details.
- `PATCH /api/auth/password`: change the password and invalidate other sessions.

For authentication mutations, send `Content-Type: application/json` and `X-CloudScanner-Request: 1`. The frontend handles these headers and session cookies.

**Scanning — authenticated, non-demo accounts only**

- `GET /api/service-account`: configured Google Cloud identity.
- `GET /api/permissions/manifest`: permission manifest.
- `POST /api/check-lb-permissions`: permission check.
- `POST /api/check-lb-permissions/stream`: streamed permission check.
- `GET /api/v1/scan/{project_id}`: scan a project.
- `GET /api/v1/scan/{project_id}/stream`: streamed scan.

The permission-check body is `{"project_id":"your-project-id"}`. Streaming endpoints emit server-sent events containing logs, a result, or an error.

`GET /health` is a process health check. A successful response does not establish MongoDB or Google Cloud connectivity.

## Tests

Frontend, from `frontend`:

```powershell
npm test -- --maxWorkers=1
npm run build
```

Backend, from `backend`:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Backend tests use mongomock rather than the Atlas database. Frontend tests cover forms, account updates, filters, waterfall controls, resource details, and demo project aggregation. These tests do not prove live Atlas or Google Cloud connectivity.

## Project structure

```text
CloudScanner/
├── backend/
│   ├── app/
│   │   ├── main.py              # API routes and production frontend serving
│   │   ├── auth.py              # Accounts, password hashing, sessions
│   │   ├── config.py            # Environment settings
│   │   ├── models/              # Request and response schemas
│   │   └── services/            # Google Cloud discovery and permission checks
│   ├── config/lb_permissions.yaml
│   ├── scripts/seed_demo.py
│   ├── tests/
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/
│   ├── src/                    # React pages, components, API client, tests
│   ├── css/styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── LICENSE
```

## Troubleshooting

### Sign-in service unavailable

Check that the Python API is running on port 8000 and that the Vite proxy targets that port. A proxy `502` usually means the frontend cannot reach the API. Restart the backend after installing dependencies or changing backend code when not using `--reload`.

### Cannot connect to the account database

Check `MONGODB_URI`, Atlas database-user permissions, and the backend machine's current public IP in Atlas Network Access. DNS failures, VPN/firewall restrictions, and TLS handshake failures can prevent connectivity even when `/health` succeeds. An unavailable database is not the same as an incorrect account password. Keep TLS verification enabled while diagnosing the connection.

### Application Default Credentials not found

Run `gcloud auth application-default login`, set `GOOGLE_APPLICATION_CREDENTIALS` in the backend process environment, or configure the runtime's attached service account. Restart the backend after changing its environment.

### Scan is blocked or returns incomplete resources

Review the permission results and activity log. Missing access prevents the scan from starting or can leave resources unresolved. Check the selected project ID, enabled APIs, and the configured principal's access.

### Frontend build missing

Run `npm ci` and `npm run build` from `frontend`, then restart the backend. Do not open the source `index.html` directly in a browser.

## Current scope and limitations

- Live scanning supports **one project at a time**. Folder and organization scans are not implemented. **All projects** currently combines seeded demo snapshots.
- Discovery targets external HTTP(S) load balancers using `EXTERNAL` or `EXTERNAL_MANAGED`, including global and regional forwarding rules. It is not an inventory of every Google Cloud load balancer type.
- A protected label indicates an attached, resolved Cloud Armor policy. It does not assess rule quality or prove that an application is secure.
- Unresolved backends/policies can appear as unprotected. Review details and logs before interpreting a finding as confirmed exposure.
- All regular application accounts use the **same backend ADC identity**. Signup does not establish per-user Google Cloud credentials or project-level authorization. Restrict access appropriately before offering the app to multiple tenants.
- Email verification, forgotten-password recovery, and persistent live scan history are not implemented.

## License

[MIT](LICENSE) — Copyright (c) 2026 Tushar Saxena.
