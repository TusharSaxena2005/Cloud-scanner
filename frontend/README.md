# Cloud Armor Scanner frontend

For complete setup, demo account instructions, API routes, and troubleshooting, see the [project README](../README.md).

The UI is built with React and Vite. Scanner, backend table, waterfall tree, and resource drawer are React components in `src/`. Existing API endpoints and saved browser state are retained.

## Development

Requires Node.js 22.12+ (or a supported newer release).

Start the Python API on port 8000 using the existing backend environment:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite. Requests under `/api` are proxied to `http://127.0.0.1:8000`; change `vite.config.js` if the backend uses another port.

## Production

```powershell
cd frontend
npm ci
npm run build
```

Restart the Python backend after building. It serves `frontend/dist/index.html` and its `/assets` files at port 8000. Hash routes work without server routing rules. Do not serve the source `index.html` directly.

## Checks

```powershell
npm test
npm run build
```

## MongoDB authentication

The backend reads `backend/.env` regardless of the launch directory. Set:

```dotenv
MONGODB_URI=<your Atlas connection URI>
MONGODB_DATABASE=cloudscanner
SESSION_COOKIE_SECURE=false
SESSION_HOURS=24
```

Use `SESSION_COOKIE_SECURE=true` when serving over HTTPS in production. Keep `.env` out of source control. If the browser and API use different origins, configure `CORS_ORIGINS` as a JSON list of trusted origins; the default Vite proxy keeps browser requests same-origin.

Signup creates a MongoDB user and an opaque HttpOnly cookie session. Login restores access; logout revokes the session. New passwords use bcrypt with cost 12 and a random salt. Existing scrypt hashes remain verifiable and are upgraded on successful login when the password fits bcrypt's 72-byte UTF-8 limit. Longer legacy passwords continue working until changed; new passwords are never truncated. MongoDB sessions and attempt limits have TTL indexes. Session expiry is also checked on every authenticated request. Scanner APIs now require a valid session. Scan data is cleared across authentication changes to avoid displaying another user's results.

Ensure the machine running the Python API is allowed in Atlas Network Access and the database user has read/write access to the configured database. Run backend tests with `pip install -r requirements-dev.txt`, then `python -m unittest discover -s tests` from `backend`.
