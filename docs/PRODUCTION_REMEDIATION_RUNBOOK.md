# Production Remediation Runbook (WRITTEN ONLY — NOT EXECUTED)

> **Nothing in this document has been run.** The online Supabase project was deliberately never contacted during local development.
> Review it with the owner, take backups, and run it only during the deployment phase and only with explicit owner approval.
> Replace `<PROD_REF>` with the project reference from the Supabase dashboard; no credentials belong in this file.

## 1. Why this exists
The archived Antigravity handoff (`docs/ANTIGRAVITY_HANDOFF.md` §5.1) states that migrations `20261017000000`, `…01` and `…02` were applied to the
online project and that the remediation `20261018000000` was only *prepared*. `…02` (`simple_db_auth`) put a `password_hash` column in the exposed
`public.user_profiles`, added `using (true)` policies for `anon`/`authenticated`, and allowed self-promotion to `OWNER_ADMIN`.
**If that is still the state of the online project, customer password hashes, emails and phone numbers may be readable with the public key,
and any visitor could make themselves an administrator.** This is UNVERIFIED: the project has not been inspected.

## 2. Treat as an incident first (owner decision)
1. Decide whether the site is publicly reachable. If it is, consider taking checkout offline (Vercel → pause deployment, or maintenance page) before changing the database.
2. Assume exposure of anything in `public.user_profiles` / `public.customers` and of legacy password hashes. Plan to force password resets for legacy accounts and notify affected customers if the owner's legal/privacy obligations require it.
3. Rotate the project's service-role/secret key and the JWT signing secret **after** remediation (dashboard → Settings → API), then update only the server environment.

## 3. Read-only inspection (run in the SQL editor, record the results)
```sql
-- Is the legacy hash column still there?
select column_name from information_schema.columns
 where table_schema='public' and table_name='user_profiles' and column_name='password_hash';
-- Permissive or legacy policies / functions
select schemaname, tablename, policyname, roles, cmd, qual from pg_policies
 where schemaname='public' and (policyname like '%simple_auth%' or qual = 'true');
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in ('simple_auth_login','simple_auth_update_profile');
-- Which migrations have been applied?
select version from supabase_migrations.schema_migrations order by version;
-- Anyone with an admin profile?
select id, email, role, is_active, created_at from public.user_profiles where role='OWNER_ADMIN';
```
Unexpected `OWNER_ADMIN` rows, or profiles created recently by unknown e-mails, indicate abuse: deactivate them (`is_active=false`) after taking a backup.

## 4. Backup before any change
Create a database backup / point-in-time restore point in the dashboard (Database → Backups) and export the two tables:
`public.user_profiles`, `public.customers`, plus `private.legacy_db_auth_accounts` if it exists. Store the export outside the repository.

## 5. Apply the corrected migration chain (forward-only)
Run in this order, each in a transaction, checking the result before continuing. **Never edit the already-applied files.**
1. `20261018000000_remediate_auth_and_rls_security.sql` — moves legacy hashes to `private.legacy_db_auth_accounts`, drops the insecure RPCs and policies, restores strict ownership RLS.
2. `20261019000000_product_information.sql`
3. `20261019000001_review_photos.sql`
4. `20261020000000_final_security_state.sql` — role-guard trigger that does not depend on a PostgREST setting; notification event CHECK; removes direct customer Storage upload and review-insert paths.
5. `20261020000001_catalog_store_content.sql` — catalogue/shop content tables, price-approval flag, buckets.
6. `20261020000002_least_privilege_grants.sql` — removes direct table access for `anon`/`authenticated` except the intentionally public columns.

Use the Supabase CLI against the **online** project only from a separate, deliberately linked checkout (never this working tree), or paste each file into the SQL editor.

## 6. Verify (do not declare safe until all pass)
- Re-run the Section 3 queries: no `password_hash`, no `simple_auth` objects, no `qual = 'true'` policies except the intentionally public ones (`products_public_select`, `product_variants_public_select`, `store_settings_select_public`, `product_images_public_select`, `store_photos_public_select`, published reviews).
- Run the assertions of `scripts/check-db-security.py` against a **copy/branch** of the production schema first (the script refuses non-local databases by design); adapt the connection guard only in that separate checkout.
- With the public (anon) key: reading `user_profiles`, `customers`, `orders`, `payment_attempts`, `bank_credits`, `admin_audit_logs` must fail; reading `product_variants.cost_price_paise` or `store_settings.upi_id` must fail.
- With a customer session: updating own `role` / `is_active` must fail; `sync_my_profile` must succeed.
- Storage: `payment-proofs`, `review-photos`, `payment-qr` private; no object policies that allow customer uploads.

## 7. Legacy account recovery
Legacy password hashes are **not** a login method. Affected customers sign up/sign in through Supabase Auth; `link_verified_legacy_account` (bcrypt check, lockout) and `admin_link_legacy_account` (Owner Admin, audited) only re-attach their old orders. Do not restore database-password authentication.

## 8. After remediation
Set the production `BFP_ENV` to anything other than `local`; enter real UPI/QR/delivery/PIN settings and approve prices in Admin; confirm business settings (checkout opens only after that); then follow the separate deployment checklist. Record what was run, by whom and when.
