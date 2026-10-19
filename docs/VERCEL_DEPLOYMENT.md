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
| `DATABASE_URL` | backend only | the **transaction pooler** string: `postgresql+psycopg://postgres.<project-ref>:<db-password>@aws-<n>-<region>.pooler.supabase.com:6543/postgres` (Supabase "Connect" dialog, Transaction pooler). Mark as Sensitive |
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

## 5. Rollback

Vercel → Deployments → pick an earlier deployment → Promote to Production (or Instant Rollback). Database migrations are forward-only and are not undone by a rollback.
