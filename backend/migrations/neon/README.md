# Neon database baseline

Run from the repository root after `neon deploy`:

```powershell
python scripts/setup-neon-db.py --project-id spring-mode-09495880 --branch production
```

The command uses the direct `DATABASE_URL_UNPOOLED` in the root environment file. It checks the linked project/branch, refuses an existing untracked public schema, applies the SQL in one transaction, and records migration checksums. Re-running unchanged migrations does nothing. Failed transactions roll back their schema and data changes.

`001_schema.sql` preserves the existing production business schema: money/stock/state checks, foreign keys, unique payment references, refund verification requirements, updated-at triggers, indexes, and the legacy cancellation table. It incorporates the business changes through Supabase migration `20261020000009`. `002_catalog.sql` adds only the six public products, their bundled image paths, empty-price/zero-stock variants, and unconfirmed store settings. No users, orders, payment credentials, or Supabase records are copied.

Neon Auth is the identity provider. FastAPI verifies its EdDSA JWTs against the branch JWKS and owns authorization; roles come only from `public.user_profiles`. `003_neon_identity.sql` adds `auth_subject`, which links a Neon Auth user to an existing profile once that user's email is verified (historical profile and order IDs never change).

Application tables have RLS enabled with no browser-facing policies and no grants to PUBLIC. The server-only database-owner connection supplied by Neon can access them. Never expose either database URL to the browser. A separately managed least-privilege API login is outside this baseline.

Rollback is transactional while applying. There is intentionally no destructive down migration after commit: keep the backup made by `scripts/migrate-supabase-to-neon.py` as the source of historical data, and remove a newly provisioned Neon database only after confirming it contains no wanted data. Subsequent changes go in new numbered SQL files; never edit an applied file.
