# Deploying to Vercel (frontend + FastAPI backend in one project)

One Vercel project, imported from the whole repository. Everything Vercel needs is in the repo, so **no build settings have to be changed in the dashboard**:

| Part | Where | How Vercel runs it |
|---|---|---|
| Frontend (Vite + React) | `frontend/`, built by the root `npm run build` into `dist/` | static files from the CDN; unknown paths fall back to `index.html` |
| Backend (FastAPI) | `backend/app/`, exposed by `api/index.py` | one Python 3.13 serverless function; every `/api/*` request is rewritten to it |
| Config | `vercel.json` (framework "Other", build command, output dir, rewrites, function settings), `requirements.txt` + `.python-version` (root, same as `backend/`) | |

Browser and API share one domain, so there is no CORS to configure. Production builds call `/api` by default (`VITE_API_BASE_URL` is only for local development).
Because Vercel is connected to GitHub, every push deploys: the production branch becomes the production deployment, every other branch a preview deployment.

Checked against Vercel's current docs (FastAPI, Python runtime, Functions limits, `vercel.json`): FastAPI runs as a Vercel Function, `framework: null` selects "Other", dependencies come from `requirements.txt`, Python 3.13 is available, request bodies are capped at 4.5 MB.
It could not be tested on Vercel itself from the development machine (no access to the project), so the first deploy is the real test: read the build log if it fails.

## 1. Environment variables (the only manual step)

Vercel → Project → Settings → Environment Variables (tick Production and Preview). Names only here; the values come from the Supabase dashboard (Project Settings → API and Database) and never go in the repo or in a chat:

| Variable | Used by | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend build **and** backend | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | frontend build **and** backend | the publishable (anon) key |
| `SUPABASE_SECRET_KEY` | backend only | the secret / service-role key. Never give it a `VITE_` prefix. Mark as Sensitive |
| `DATABASE_URL` | backend only | the **transaction pooler** string: `postgresql+psycopg://postgres.<project-ref>:<db-password>@aws-<n>-<region>.pooler.supabase.com:6543/postgres` (Supabase "Connect" dialog, Transaction pooler). Mark as Sensitive. If unset, the backend uses `POSTGRES_URL` supplied by the Supabase Vercel integration |
| `PROOF_SIGNING_SECRET` | backend only | a long random string (32+ characters), e.g. `openssl rand -hex 32`. Signs the short-lived admin links to payment screenshots |
| `VITE_SUPPORT_WHATSAPP` | frontend (optional) | digits only, e.g. `918000961030` |
| `SUPABASE_JWT_SECRET` | backend (only if the Supabase project signs tokens with HS256) | the JWT secret from the dashboard; newer projects use signing keys and do not need it |

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` default to the `VITE_` values. Do **not** set `BFP_ENV` (any value other than `production` turns on development shortcuts) and do not set `CORS_ORIGINS` (same origin).
The backend refuses to start without `DATABASE_URL` outside local development, by design: a missing value shows up in the function log, not as lost orders.

Also: Supabase → Authentication → URL Configuration: set the Site URL to the Vercel production domain and add the preview/production URLs to Redirect URLs.

## 2. The database must be ready first

The code expects the current schema (migrations `20261017000000` through `20261020000009` in `supabase/migrations/`). **Do not point a deployment at the existing online Supabase project until it has been inspected and migrated**: an old schema makes the API fail, and the earlier remediation notes warn that the online project may still be in an insecure legacy state.
Follow `docs/PRODUCTION_REMEDIATION_RUNBOOK.md` (backup, read-only inspection, forward-only migrations, key rotation). Then enter the owner's real prices, stock, store details and payment QR in the admin panel: the migrations create products unpriced and out of stock on purpose, so nothing can be ordered at a made-up price.
A brand-new Supabase project is the cleaner alternative: run all migrations in order, then create the first Owner Admin.

## 3. Check a deployment

- `https://<deployment>/api/health` returns `{"status":"ok", ...}`.
- `https://<deployment>/api/products` lists the catalogue.
- The home page loads, a product card opens its details, sign-up works, and `/admin` accepts an Owner Admin only.
- Vercel → Deployment → Logs: no `DATABASE_URL is not set` and no Supabase errors.

## 4. Limits and behaviour worth knowing

- **Request bodies are capped at 4.5 MB** by Vercel (`413 FUNCTION_PAYLOAD_TOO_LARGE`), so uploads are limited to 4 MB: payment screenshots, admin product/shop photos, and all review photos of one review together. The client and the server both enforce it.
- The database connection uses the Supabase pooler with no app-side pool and no prepared statements (`backend/app/db/session.py`, switched on by a pooler URL or the `VERCEL` variable); a direct port-5432 connection is not suited to serverless.
- Dependencies are pinned (`requirements.txt`, tested on Python 3.13) and the root copy must equal `backend/requirements.txt` (a test checks it). To upgrade: install newer versions in a clean venv, run `python -m unittest discover -s tests` from `backend/`, re-freeze, and replace both files.
- Preview deployments are behind Vercel Deployment Protection by default; sign in to Vercel to open them.
- Functions run on Fluid compute (the config sets a 60 s limit); the first request after idle time has a short cold start.
- The bundle excludes `frontend/`, `docs/`, `supabase/`, `scripts/` and tests (`vercel.json` → `excludeFiles`).

## 5. Admin panel: the `admin-panel/` folder, its own Vercel project

The Admin Panel is a separate app in `admin-panel/`:

| Folder | Contents |
|---|---|
| `admin-panel/frontend/` | the admin UI (Vite + React): `src/app/App.tsx` (routes under `/admin`), `src/features/admin/` (pages, components, API client, styles). Shared code (API client, Supabase sign-in, common components, styles, images) is imported from `frontend/src` through the `@shared` alias, so nothing is duplicated |
| `admin-panel/backend/` | notes only: the admin API is the shared FastAPI app in `backend/` (`/api/admin/*`), see its README |
| `admin-panel/vercel.json` | build settings for the admin Vercel project |

The storefront (`frontend/`, root `vercel.json`) no longer contains any admin code. Its "Admin Panel" link (Owner Admin only) points to `VITE_ADMIN_URL`.

Create the admin project (Vercel dashboard, once):
1. Add New → Project → import the **same** repository (`dhruv613/Balaji-Faki-supari`). Name it e.g. `balaji-faki-admin`.
2. **Root Directory: `admin-panel`** (Edit next to Root Directory). Leave Framework and Build settings untouched; `admin-panel/vercel.json` sets them. Keep "Include files outside the root directory in the Build Step" enabled (the default): the build installs from the repo root and uses `frontend/src`.
3. Environment variables (Production and Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (same values as the storefront) and `VITE_STORE_URL=https://balaji-faki-point.vercel.app` (the admin's "Store" links). The admin project runs no server code, so it needs no `DATABASE_URL` or secret keys.
4. Deploy. Then in the **storefront** project add `VITE_ADMIN_URL=https://<admin domain>` and redeploy it, so the Owner Admin sees the "Admin Panel" link. `VITE_APP_MODE` is no longer used and can be deleted from both projects.
5. Supabase → Authentication → URL Configuration: add the admin domain to Redirect URLs.

From then on every push to GitHub deploys both projects.

How the admin reaches the API: `admin-panel/vercel.json` rewrites `/api/*` to the storefront's API (`https://balaji-faki-point.vercel.app/api/*`), so the browser only talks to the admin domain and no CORS setup is needed. If the storefront moves to a custom domain, change that one URL. Admin access is enforced by the API on every request (`user_profiles.role` must be `OWNER_ADMIN`), not by the separate address.
Optional: protect the admin project with Vercel Deployment Protection or a custom domain such as `admin.<your domain>`.

Local development: `npm run dev` (storefront, port 5173) and `npm run dev:admin` (Admin Panel, port 5174, `http://localhost:5174/admin`). Both read `frontend/.env`.

## 6. Troubleshooting

**The storefront shows only names, "Awaiting price" and the notice that prices are unavailable:** the API is not reachable. Open `https://<your site>/api/health`:

| You see | Meaning | Fix |
|---|---|---|
| `503` `The API could not start: DATABASE_URL is not set...` | the backend has no database URL | add `DATABASE_URL` (Supabase transaction pooler string) |
| `503` `"status":"misconfigured"` with a `missingConfig` list | those settings are not configured (names only) | add the variables listed |
| `500` `FUNCTION_INVOCATION_FAILED` | the function crashed with something unexpected | Vercel → the deployment → Logs: the traceback is printed there |
| `404` | the `api/index.py` function was not deployed | check the build log and that Root Directory is the repo root |
| `200` ok, but `/api/products` fails | the database cannot be reached or is not migrated | check the pooler URL and section 2 |

Environment variables only apply to **new** deployments: after adding or changing one, redeploy (Deployments → ⋯ → Redeploy). Production and Preview have separate variable scopes, so set both.
While the API is down the storefront still shows each product's photo and name (a fallback); ordering stays disabled because no price can be shown.

## 7. Rollback

Vercel → Deployments → pick an earlier deployment → Promote to Production (or Instant Rollback). Database migrations are forward-only and are not undone by a rollback.
