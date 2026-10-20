# Neon setup

The app runs entirely on Neon project `spring-mode-09495880` (organization `org-raspy-dew-31743101`, AWS Singapore). `neon.ts` declares the services: Postgres, Neon Auth and Object Storage with one private bucket, `assets`. `.neon` links this folder to the `production` branch.

| Service | Used for | Code |
|---|---|---|
| Postgres | all application data | `backend/app/db/`, schema in `backend/migrations/neon/` |
| Neon Auth | sign-up, sign-in, emailed verification and password-reset codes | browser: `frontend/src/lib/auth.ts`, `frontend/src/components/common/EmailSignIn.tsx`; API: `backend/app/core/security.py` |
| Object Storage | payment screenshots, review photos, payment QR, uploaded product/shop photos | `backend/app/core/storage.py` |

## How sign-in reaches the API

1. The browser signs in with Neon Auth (`@neondatabase/auth`) and asks it for a short-lived JWT (only once the email is verified).
2. Every API call sends that JWT as `Authorization: Bearer`.
3. FastAPI verifies it against the branch's JWKS (EdDSA, expiry, issuer and audience = the Neon Auth origin), then reads `neon_auth."user"` to confirm the email is verified and the user is not banned.
4. The Neon user is linked to an application profile through `user_profiles.auth_subject`. The first time a verified email signs in, an existing profile with that email (from the old Supabase data) is reconnected with its original ID and orders; otherwise a `CUSTOMER` profile is created. Roles are only ever changed in the database.

## Environment

`neon env pull --branch <branch> --file <file>` writes `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), `NEON_BRANCH`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and the `AWS_*` storage variables. The frontends additionally need `VITE_NEON_AUTH_URL` (the same value as `NEON_AUTH_BASE_URL`). The API also needs `PROOF_SIGNING_SECRET`. All env files are gitignored; `.env.example` lists every variable.

The backend reads the process environment first, then root `.env.local`, root `.env`, `backend/.env.local` and `backend/.env`, never overwriting a value already set. To run against another branch, put that branch's variables into the process environment before starting it.

## Schema

`python scripts/setup-neon-db.py --project-id spring-mode-09495880 --branch <branch> [--env-file <file>]` applies the numbered files in `backend/migrations/neon/` that are not yet recorded in `private.neon_schema_migrations`, in one transaction, and refuses edited files. See [the migrations README](../backend/migrations/neon/README.md).

## Branches and testing

Use a branch for every test; see [Deploying to Vercel on Neon](VERCEL_DEPLOYMENT.md#4-testing-changes-on-a-neon-branch). `scripts/e2e-neon-dev.py` runs the full sign-up, order, payment and admin flow against a `dev` branch, and `scripts/check-neon-services.py` checks the catalogue and storage against a running API.

## Moving the old Supabase data

`scripts/migrate-supabase-to-neon.py` backs up the old Supabase data and files to `.migration-backups/` (export only by default) and, with `--apply --source-is-quiesced`, copies them into Neon in one verified transaction. Supabase is never modified. Steps: [cutover](VERCEL_DEPLOYMENT.md#3-cutover-from-supabase-once).
