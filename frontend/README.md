# CloudScanner frontend

See the [project README](../README.md) for Google OAuth, PostgreSQL, and backend setup.

The React app provides Google Sign-In, workspace cloud connections, a GCP scanner, backend coverage views, an expandable resource flow, and account details. AWS and Azure are future providers.

```powershell
npm ci
npm run dev
npm test -- --maxWorkers=1
npm run build
```

Vite proxies `/api` to `http://127.0.0.1:8000`, including the OAuth callback. Use the same origin as backend `PUBLIC_URL`. Cloud tokens stay on the backend.
