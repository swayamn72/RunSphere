# API development configuration

The API only returns CORS headers to origins explicitly listed in `CORS_ALLOWED_ORIGINS`. Supply a comma-separated list at process startup; do not commit a preview tunnel origin.

```sh
CORS_ALLOWED_ORIGINS=https://admin.runsphere.example pnpm --filter @runsphere/api dev
```

For a temporary public admin preview, provide the exact exposed origin in the shell that starts the API:

```sh
CORS_ALLOWED_ORIGINS=https://<preview-host>.preview.us1.vorflux.com pnpm --filter @runsphere/api dev
```

Use a durable admin URL in deployed environments. The checked-in default only enables the local Vite admin origin (`http://localhost:4173`).
