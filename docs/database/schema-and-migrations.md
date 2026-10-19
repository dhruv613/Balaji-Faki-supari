# Database Schema & Migrations — Balaji Faki Point

> **Historical document (written before the local-only phase).** It describes the previous online/staging setup, including the retired
> database-password login and commands that target the online Supabase project. Do **not** run any command from it.
> Current instructions: README section 3a and `docs/CLAUDE_CHANGE_PLAN.md`.


## 1. Live Supabase PostgreSQL Project

- **Project Reference**: `zyzkoolgwbczvvetjnwf` (`https://zyzkoolgwbczvvetjnwf.supabase.co`)
- **Config File**: [`supabase/config.toml`](../../supabase/config.toml)
- **Applied Migrations**:
  1. [`supabase/migrations/20261017000000_balaji_faki_point_schema.sql`](../../supabase/migrations/20261017000000_balaji_faki_point_schema.sql) — Creates all 18 operational tables, foreign-key indexes, state-machine CHECK constraints, RLS policies, private `payment-proofs` Storage bucket, and initial Faki & Supari catalog seed.
  2. [`supabase/migrations/20261017000001_optimize_rls_and_security_advisors.sql`](../../supabase/migrations/20261017000001_optimize_rls_and_security_advisors.sql) — Splits `FOR ALL` admin policies into explicit `FOR INSERT / UPDATE / DELETE` policies and revokes public execution on `public.rls_auto_enable()`.
  3. [`supabase/migrations/20261017000002_simple_db_auth.sql`](../../supabase/migrations/20261017000002_simple_db_auth.sql) — Adds `public.simple_auth_login` and `public.simple_auth_update_profile` RPC functions for direct database account creation and login without email confirmation delay.

---

## 2. All 18 Tables & Relationships

| # | Table | Primary Key | Key Foreign Keys & Constraints |
| --- | --- | --- | --- |
| 1 | `public.user_profiles` | `id (uuid)` | `role in ('CUSTOMER', 'OWNER_ADMIN')`, `lower(email)` unique index |
| 2 | `public.customers` | `id (uuid)` | `user_id -> user_profiles(id) UNIQUE`, `order_count >= 0`, `total_spent_paise >= 0` |
| 3 | `public.products` | `id (uuid)` | `slug in ('faki', 'supari') UNIQUE` |
| 4 | `public.product_variants` | `id (uuid)` | `product_id -> products(id)`, `pack_size in ('250g', '500g', '1kg')`, `total_stock >= reserved_stock`, `price_paise` (`bigint`, nullable) |
| 5 | `public.orders` | `id (uuid)` | `user_id -> user_profiles(id)`, `customer_id -> customers(id)`, `total_paise = subtotal_paise + delivery_fee_paise`, `orders_confirmed_requires_verified_payment` |
| 6 | `public.order_items` | `id (uuid)` | `order_id -> orders(id)`, `product_id -> products(id)`, `variant_id -> product_variants(id)`, `quantity between 1 and 20` |
| 7 | `public.payment_attempts` | `id (uuid)` | `order_id -> orders(id)`, `user_id -> user_profiles(id)`, `submitted_utr ~ '^[0-9]{12}$'`, partial unique index on `verified_utr` where `status = 'VERIFIED'` |
| 8 | `public.bank_credits` | `id (uuid)` | `payment_attempt_id -> payment_attempts(id) UNIQUE`, `order_id -> orders(id) UNIQUE`, `bank_credit_ref UNIQUE`, `verified_utr UNIQUE`, `transaction_status = 'CREDITED'` |
| 9 | `public.order_status_history` | `id (uuid)` | `order_id -> orders(id)`, `actor_id -> user_profiles(id)` |
| 10 | `public.inventory_movements` | `id (uuid)` | `variant_id -> product_variants(id)`, `reference_order_id -> orders(id)`, `new_available >= 0` |
| 11 | `public.shipments` | `id (uuid)` | `order_id -> orders(id) UNIQUE`, `delivery_status` |
| 12 | `public.delivery_events` | `id (uuid)` | `shipment_id -> shipments(id)`, `order_id -> orders(id)` |
| 13 | `public.reviews` | `id (uuid)` | `order_id -> orders(id) UNIQUE`, `customer_id -> customers(id)`, `product_id -> products(id)`, `rating between 1 and 5` |
| 14 | `public.cancellation_requests` | `id (uuid)` | `order_id -> orders(id)`, `requested_by_user_id -> user_profiles(id)` |
| 15 | `public.refunds` | `id (uuid)` | `order_id -> orders(id)`, `original_payment_id -> payment_attempts(id)`, `refunds_completed_requires_bank_verification` |
| 16 | `public.notifications` | `id (uuid)` | `order_id -> orders(id)`, `customer_id -> customers(id)`, `user_id -> user_profiles(id)` |
| 17 | `public.store_settings` | `id (int = 1)` | Singleton (`check (id = 1)`), `serviceable_pin_codes (jsonb)` |
| 18 | `public.admin_audit_logs` | `id (uuid)` | `actor_id -> user_profiles(id)`, `previous_state (jsonb)`, `new_state (jsonb)` |

---

## 3. Running & Verifying Migrations

```powershell
# Link project (already linked in workspace)
npx supabase link --project-ref zyzkoolgwbczvvetjnwf

# List local vs remote migration status
npx supabase migration list

# Push new migrations to Supabase
npx supabase db push --yes

# Run security & performance advisors
npx supabase db advisors --linked
```
