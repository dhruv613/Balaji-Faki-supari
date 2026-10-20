# Balaji Faki Point — Admin Panel

The Owner Admin app (React 19 + TypeScript + Vite). Self-contained: it has its own `package.json`, sources, public files
and tests, and imports nothing from the store (`../frontend`). Deployed as its own Vercel project with Root Directory
`admin-panel` (see `vercel.json`).

```text
admin-panel/
├── index.html, vite.config.ts, tsconfig.json, package.json, vercel.json
├── public/                 logo and favicon
├── src/
│   ├── main.tsx, app/      App (routes under /admin) and AdminLayout
│   ├── features/admin/     pages, components, API client, types, styles
│   ├── components/common/  sign-in form, notices, mobile number input
│   ├── lib/                API client, Neon Auth sign-in, env, profile
│   ├── styles/, types/
└── tests/admin.test.mjs
```

- **API**: the admin API is part of the shared backend (`../backend/app/routes/admin*.py`), so store and admin use one
  database and one set of order and payment rules. `vercel.json` forwards `/api/*` to the store's deployment, so the
  browser only talks to the admin domain (no CORS). Product photos are stored as `/images/...` paths of the store, so
  `/images/*` is forwarded there too (and to the store's dev server by `vite.config.ts` in development).
- **Sign-in**: Neon Auth (`src/lib/auth.ts`); the server decides who is Owner Admin.
- **Environment**: `VITE_NEON_AUTH_URL` (Neon Auth URL of the branch) and `VITE_STORE_URL` (store address for the "Store"
  links). Local development also needs `VITE_API_BASE_URL=http://127.0.0.1:8000/api`. Put them in `admin-panel/.env.local`
  (gitignored); see `.env.example`.

```powershell
cd admin-panel
npm install
npm run dev          # http://localhost:5174/admin
npm test
npm run build        # -> admin-panel/dist
```
