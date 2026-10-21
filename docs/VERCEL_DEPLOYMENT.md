# Deploying to Vercel on Neon

Two Vercel projects deploy from the same GitHub repository on every push. Neon provides the database, sign-in and file storage:

| Part | Where | Runs as |
|---|---|---|
| Storefront + API | repo root: `frontend/` (Vite) and `backend/app/` (FastAPI, exposed by `api/index.py`), settings in `vercel.json` | static files plus one Python 3.13 function; every `/api/*` request goes to it |
| Admin Panel | `admin-panel/` (Root Directory of the second project), settings in `admin-panel/vercel.json` | static files; `/api/*` is forwarded to the storefront's API |
| Database | Neon Postgres, project `spring-mode-09495880`, branch `production` | schema from `backend/migrations/neon/` |
| Sign-in | Neon Auth (Managed Better Auth) on the same branch | email + password, email verification and password reset by emailed code |
| Files | Neon Object Storage, private bucket `assets` | payment screenshots, review photos, payment QR, uploaded product/shop photos |

The API verifies every request's Neon Auth token (EdDSA signature, expiry, issuer and audience) and takes the role only from `public.user_profiles`, so `OWNER_ADMIN` cannot come from the browser.

## 1. Environment variables

Vercel → Project → Settings → Environment Variables, ticking **Production** and **Preview**. Values come from the Neon Console (or `neon env pull --branch production --file <file>`); never put them in the repo or a chat.

**Storefront project (`balaji-faki-point`)**

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **pooled** connection string of branch `production` (host contains `-pooler`). Sensitive |
| `NEON_AUTH_BASE_URL` | the branch's Neon Auth URL (ends in `/neondb/auth`) |
| `NEON_AUTH_JWKS_URL` | the branch's JWKS URL |
| `VITE_NEON_AUTH_URL` | the same value as `NEON_AUTH_BASE_URL` (the browser needs it at build time) |
| `AWS_ENDPOINT_URL_S3`, `AWS_REGION` | Neon Object Storage endpoint and region |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Neon Object Storage keys. Sensitive |
| `PROOF_SIGNING_SECRET` | a long random string (32+ characters), e.g. `openssl rand -hex 32`. Sensitive |
| `ADMIN_EMAIL` | the one Admin Panel login email. Sensitive |
| `ADMIN_PASSWORD` | the Admin Panel password, 10+ characters. Changing it signs the admin out everywhere. Sensitive |
| `VITE_ADMIN_URL` | `https://balaji-faki-point-admin.vercel.app` (the Owner Admin's "Admin Panel" link) |
| `VITE_SUPPORT_WHATSAPP` | optional, digits only, e.g. `918000961030` |

**Admin project (`balaji-faki-point-admin`)**: only `VITE_STORE_URL=https://balaji-faki-point.vercel.app`. It runs no server code and has no Neon sign-in: its login is checked by the store's server (`ADMIN_EMAIL` / `ADMIN_PASSWORD` above).

**Delete** from both projects: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_SECRET`, `VITE_APP_MODE`, and any `POSTGRES_*` variables a Supabase integration added. Do not set `BFP_ENV` (anything other than `production` turns on development shortcuts) or `CORS_ORIGINS` (same origin).

Variables apply only to **new** deployments: redeploy after changing them.

## 2. Neon settings

- **Trusted domains** (sign-in only works from listed sites):
  ```bash
  neon neon-auth domain add https://balaji-faki-point.vercel.app --branch production
  neon neon-auth domain add https://balaji-faki-point-admin.vercel.app --branch production
  neon neon-auth domain list --branch production
  ```
  Add a custom domain the same way if you attach one later. Localhost is allowed by default for development.
- **Schema**: `python scripts/setup-neon-db.py --project-id spring-mode-09495880 --branch production` (uses the direct `DATABASE_URL_UNPOOLED` from your local `.env`). It applies only the files not yet recorded, in order, inside one transaction, and refuses an edited file.
- **Emails**: Neon Auth sends the verification and password-reset codes from its shared sender. For a real shop, set up your own SMTP in the Neon Console (Auth → Email), see https://neon.com/docs/auth/production-checklist.md.

## 3. Cutover from Supabase (once)

1. Stop new orders on the old site (they would not be copied).
2. Copy the old data: `python scripts/migrate-supabase-to-neon.py` first (export only: backs up everything to `.migration-backups/`, changes nothing), then `python scripts/migrate-supabase-to-neon.py --apply --source-is-quiesced`. It copies all 21 tables and uploaded files into Neon in one transaction and verifies checksums; Supabase is never changed. It refuses if the Neon database already has customers or orders.
3. Apply the remaining schema files (section 2).
4. Set the Vercel variables (section 1), add the trusted domains, redeploy both projects.
5. Check: `https://balaji-faki-point.vercel.app/api/health` returns `{"status":"ok"}`; the store lists the products.
6. Owner Admin: create your account on the **store** (Create account, then the emailed code). For safety the API never links an Owner Admin profile by email automatically (otherwise whoever registered the owner's email first would get admin access), so link it once in the Neon SQL editor, replacing the email:
   ```sql
   -- your verified Neon Auth account
   select id, email, "emailVerified" from neon_auth."user" where lower(email) = 'you@example.com';
   -- old owner profile copied from Supabase: attach it to that account (keeps its ID and history)
   update public.user_profiles
      set auth_subject = (select id::text from neon_auth."user" where lower(email) = 'you@example.com' and "emailVerified")
    where lower(email) = 'you@example.com' and role = 'OWNER_ADMIN' and auth_subject is null;
   -- or, if there was no old owner profile: you signed in once, so a customer profile exists; promote it
   update public.user_profiles set role = 'OWNER_ADMIN' where lower(email) = 'you@example.com';
   ```
   Then sign in on the admin site. Its sign-in has **Forgot password?** but no Create account.
7. Everyone else: passwords cannot be moved from Supabase. Existing customers use **Create account** (or **Forgot password?** once they have one) with the same email; after the emailed code their old orders reappear.

## 4. Testing changes on a Neon branch

Never test against `production`. A branch is an isolated copy with its own database, sign-in and storage:

```bash
neon branches create --name dev --parent production
neon env pull --branch dev --file .env.neon-dev
python scripts/setup-neon-db.py --project-id spring-mode-09495880 --branch dev --env-file .env.neon-dev
# start the API with only the dev settings loaded, then:
python scripts/e2e-neon-dev.py .env.neon-dev
neon branches delete dev
```

`scripts/e2e-neon-dev.py` signs up throwaway accounts with real Neon Auth, marks their emails verified directly in the dev database, makes one Owner Admin there, and walks through price setup, ordering, a payment screenshot upload, approval and account reconnection (33 checks). It refuses to run on any branch other than `dev` and stops at the first failure. `node frontend/tests/sdk-probe.mjs <creds.json>` runs the real `src/lib/auth.ts` with the real Neon Auth SDK against the branch (sign-in, token, API call, sign-out).

## 5. Limits and behaviour worth knowing

- **Request bodies are capped at 4.5 MB** by Vercel, so uploads are limited to 4 MB (payment screenshots, admin photos, and all photos of one review together). Client and server both enforce it.
- The API connects through Neon's pooler with no app-side pool and no prepared statements (`backend/app/db/session.py`); schema setup uses the direct connection.
- Uploaded product and shop photos are shown through one-hour signed links; payment screenshots and review photos are only ever served through the API after its checks.
- Sign-in tokens last 15 minutes and are refreshed by the browser automatically. Signing out ends the session; an already-issued token stays valid until it expires.
- Neon Auth keeps its session on the Neon Auth domain. Browsers that block third-party cookies strictly (Safari, some privacy modes) may need the user to sign in again more often; test on an iPhone after the cutover.
- Dependencies are pinned (`requirements.txt`, Python 3.13); the root copy must equal `backend/requirements.txt` (a test checks it).
- The function bundle excludes `frontend/`, `docs/`, `scripts/`, migrations and tests (`vercel.json` → `excludeFiles`).

## 6. Admin Panel project

`admin-panel/` is a self-contained app like D&D's `Admin/` (own `package.json` and lockfile; `vercel.json` runs `npm ci` and `npm run build` and serves `dist`). Root Directory of the Vercel project is `admin-panel`. Its `vercel.json` forwards `/api/*` and `/images/*` (product photos live in the store's public folder) to `https://balaji-faki-point.vercel.app`; change that URL if the store moves to a custom domain. Admin access is enforced by the API on every request, not by the separate address.

Local development: `npm run dev` inside `frontend/` (store, port 5173) and inside `admin-panel/` (admin, `http://localhost:5174/admin`). The store reads `frontend/.env*`, the admin `admin-panel/.env*` (see each `.env.example`).

## 7. Troubleshooting

Open `https://balaji-faki-point.vercel.app/api/health`:

| You see | Meaning | Fix |
|---|---|---|
| `503` `The API could not start: DATABASE_URL is not set...` | no database URL | add the pooled `DATABASE_URL` |
| `503` `"status":"misconfigured"` with `missingConfig` | those settings are missing (names only) | add them, redeploy |
| `500` `FUNCTION_INVOCATION_FAILED` | unexpected crash | Vercel → deployment → Logs |
| `200`, but sign-in says "invalid domain" or nothing happens | the site is not a trusted domain in Neon Auth | section 2 |
| `200`, but `/api/me` answers 403 "Verify your email" | the account's email is not verified | finish the emailed code step |
| Admin says "could not verify your role" | the API is down or the account is not `OWNER_ADMIN` | check `/api/health`, then section 3 step 6 |

### Payment QR upload and nationwide delivery

Open **Settings** from the admin sidebar (or `/admin/settings`). A successful API health check does not verify storage credentials or upload permission.

If QR upload fails, check the **storefront/API project's** environment variables in Vercel, then redeploy it:

| Variable | Check in Neon Object Storage |
|---|---|
| `AWS_ENDPOINT_URL_S3` | The S3 endpoint of the branch used by the running API |
| `AWS_REGION` | That endpoint's region |
| `AWS_ACCESS_KEY_ID` | The storage credential's `token_id` |
| `AWS_SECRET_ACCESS_KEY` | The credential's `s3_secret_access_key`, not its `api_token` |

The credential must permit storage reads/writes on that branch, with the private `assets` bucket available. Verify the deployed `DATABASE_URL` and Neon project/branch before copying values: a local `.neon` link or an older project ID in these instructions does not establish which branch production currently uses. Do not switch the database or authentication project to repair an upload. See [Neon storage authentication](https://neon.com/docs/storage/authentication) and [storage troubleshooting](https://neon.com/docs/storage/troubleshooting).

After storage works, set the real UPI ID/payee and delivery charge, clear **Serviceable PIN codes** for delivery across India, and click **Save changes**. Upload the correct QR image, verify the displayed payment details, then click **Confirm payment, delivery & PIN settings**. Payment/delivery changes withdraw confirmation, so confirm last. Empty coverage permits valid Indian PIN codes; product restrictions and all checkout checks still apply.

## 8. Rollback

Vercel → Deployments → pick an earlier deployment → Promote to Production. Database changes are forward-only; the Supabase project and the backup in `.migration-backups/` remain the source of the old data.
