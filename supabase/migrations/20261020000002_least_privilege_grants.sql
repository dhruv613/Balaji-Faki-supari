-- Final security state, part 2: least-privilege table and function grants.
-- All application writes go through FastAPI with a server-side credential. The browser only needs:
--   * intentionally public reads (catalogue, published reviews, shop content) with non-sensitive columns only,
--   * reading/updating its OWN profile contact fields (RLS-limited) through `sync_my_profile`.
-- STATUS: written 2026-10-19; NOT yet verified against local PostgreSQL. Verify with scripts/check-db-security.py.
begin;

-- 1. Start from zero: no API-role privileges on any existing public table.
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from public, anon, authenticated', r.tablename);
  end loop;
end;
$$;

-- Tables created later by the migration role do not inherit API-role grants automatically.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon;

-- 2. Intentionally public reads. Sensitive columns (cost prices, stock, UPI details, reviewer identity,
--    moderation notes, QR path, settings internals) are NOT granted, even though the rows are visible.
grant select on public.products, public.product_images, public.store_photos to anon, authenticated;

grant select (id, product_id, pack_size, price_paise, is_available, price_confirmed)
  on public.product_variants to anon, authenticated;

grant select (
  id, store_name, store_name_gu, tagline, support_phone, support_whatsapp, support_email,
  store_address, opening_hours, shop_intro, production_info, provider_manufacturer, packaging_info, updated_at
) on public.store_settings to anon, authenticated;

grant select (
  id, product_id, rating, review_text, is_verified_purchase, moderation_status,
  admin_reply, admin_replied_at, created_at
) on public.reviews to anon, authenticated;

-- 3. Own-profile access (rows limited by the existing RLS policies).
grant select on public.user_profiles to authenticated;
grant update (full_name, phone, updated_at) on public.user_profiles to authenticated; -- never role / is_active / email

grant select on public.customers to authenticated;
grant insert (user_id, full_name, phone, email, area, address, pin_code) on public.customers to authenticated;
grant update (full_name, phone, email, area, address, pin_code, updated_at) on public.customers to authenticated;
-- order_count / total_spent_paise / last_order_at are server-maintained and not writable by customers.

-- 4. Functions: nothing executable by anon; authenticated only gets the three guarded RPCs.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.sync_my_profile(text, text) to authenticated, service_role;
grant execute on function public.link_verified_legacy_account(text) to authenticated, service_role;
grant execute on function public.admin_link_legacy_account(uuid, uuid, text) to authenticated, service_role;

commit;
