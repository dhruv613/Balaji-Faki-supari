-- =============================================================================
-- Balaji Faki Point — Advisor Remediations (Security & RLS Performance)
-- Migration: 20261017000001_optimize_rls_and_security_advisors.sql
--
-- 1. Revokes public/anon/authenticated execution on `public.rls_auto_enable()` if present.
-- 2. Splits `FOR ALL` admin write policies into `FOR INSERT`, `FOR UPDATE`, and `FOR DELETE`
--    so tables with a `FOR SELECT` policy do not have duplicate permissive SELECT policies.
-- =============================================================================

begin;

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- 1. customers: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "customers_admin_write" on public.customers;
create policy "customers_admin_insert"
  on public.customers for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "customers_admin_update"
  on public.customers for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "customers_admin_delete"
  on public.customers for delete to authenticated
  using ((select private.is_owner_admin()));

-- 2. products: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_insert"
  on public.products for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "products_admin_update"
  on public.products for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "products_admin_delete"
  on public.products for delete to authenticated
  using ((select private.is_owner_admin()));

-- 3. product_variants: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "product_variants_admin_write" on public.product_variants;
create policy "product_variants_admin_insert"
  on public.product_variants for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "product_variants_admin_update"
  on public.product_variants for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "product_variants_admin_delete"
  on public.product_variants for delete to authenticated
  using ((select private.is_owner_admin()));

-- 4. shipments: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "shipments_admin_write" on public.shipments;
create policy "shipments_admin_insert"
  on public.shipments for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "shipments_admin_update"
  on public.shipments for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "shipments_admin_delete"
  on public.shipments for delete to authenticated
  using ((select private.is_owner_admin()));

-- 5. cancellation_requests: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "cancellation_requests_admin_write" on public.cancellation_requests;
create policy "cancellation_requests_admin_insert"
  on public.cancellation_requests for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "cancellation_requests_admin_update"
  on public.cancellation_requests for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "cancellation_requests_admin_delete"
  on public.cancellation_requests for delete to authenticated
  using ((select private.is_owner_admin()));

-- 6. refunds: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "refunds_admin_write" on public.refunds;
create policy "refunds_admin_insert"
  on public.refunds for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "refunds_admin_update"
  on public.refunds for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "refunds_admin_delete"
  on public.refunds for delete to authenticated
  using ((select private.is_owner_admin()));

-- 7. notifications: replace FOR ALL with INSERT / UPDATE / DELETE
drop policy if exists "notifications_admin_write" on public.notifications;
create policy "notifications_admin_insert"
  on public.notifications for insert to authenticated
  with check ((select private.is_owner_admin()));
create policy "notifications_admin_update"
  on public.notifications for update to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));
create policy "notifications_admin_delete"
  on public.notifications for delete to authenticated
  using ((select private.is_owner_admin()));

commit;
