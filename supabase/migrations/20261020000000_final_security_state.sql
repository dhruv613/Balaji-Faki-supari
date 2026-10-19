-- Final security state, part 1 (forward-only; earlier migrations are never edited).
-- STATUS: written 2026-10-19; NOT yet verified against local PostgreSQL (Docker was unavailable).
-- Verify with: python scripts/check-db-security.py (after a local `supabase db reset`).
begin;

-- 1. The legacy password-hash model must be gone. Fail loudly if the earlier remediation was not applied.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'password_hash'
  ) then
    raise exception 'public.user_profiles.password_hash still exists; apply 20261018000000 first.';
  end if;
end;
$$;

drop function if exists public.simple_auth_login(text, text);
drop function if exists public.simple_auth_update_profile(uuid, text, text);

drop policy if exists "user_profiles_simple_auth_select" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_insert" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_update" on public.user_profiles;
drop policy if exists "customers_simple_auth_select" on public.customers;
drop policy if exists "customers_simple_auth_insert" on public.customers;
drop policy if exists "customers_simple_auth_update" on public.customers;

-- 2. Role-escalation guard that does not depend on a PostgREST setting.
--    PostgREST executes requests after `SET LOCAL ROLE anon|authenticated`, so `current_user` identifies API callers.
--    The function is SECURITY INVOKER on purpose: inside SECURITY DEFINER functions `current_user` is the owner.
--    Trusted server paths (service_role, postgres, supabase_auth_admin, and the SECURITY DEFINER auth trigger) are not API roles.
create or replace function private.enforce_user_profile_role_security()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if not (select private.is_owner_admin()) then
      if tg_op = 'INSERT' then
        new.role := 'CUSTOMER';
        new.is_active := true;
      else
        if new.role is distinct from old.role then
          raise exception 'Unauthorized: users cannot modify their own role.';
        end if;
        if new.is_active is distinct from old.is_active then
          raise exception 'Unauthorized: users cannot modify their own active status.';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_user_profile_role_security() from public, anon;

drop trigger if exists trg_enforce_user_profile_role_security on public.user_profiles;
create trigger trg_enforce_user_profile_role_security
  before insert or update on public.user_profiles
  for each row execute function private.enforce_user_profile_role_security();

-- 3. Notification event types: superset of the old list so existing rows stay valid and
--    the backend's ORDER_CANCELLED / REFUND_COMPLETED events no longer violate the CHECK.
alter table public.notifications drop constraint if exists notifications_event_type_check;
alter table public.notifications
  add constraint notifications_event_type_check check (
    event_type in (
      'ORDER_CREATED',
      'PAYMENT_PROOF_RECEIVED',
      'PAYMENT_VERIFIED',
      'PAYMENT_REJECTED',
      'ORDER_CONFIRMED',
      'ORDER_PACKED',
      'ORDER_SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'REFUND_PROCESSED',
      'ORDER_CANCELLED',
      'REFUND_COMPLETED'
    )
  );

-- 4. Customers must not upload directly to Storage or write reviews straight through PostgREST:
--    FastAPI validates files and eligibility with a server-only credential.
drop policy if exists "payment_proofs_customer_upload_own_folder" on storage.objects;
drop policy if exists "reviews_insert_delivered_own_order" on public.reviews;

-- 5. Reviews are auto-published (post-moderation). Existing rows keep their current status.
alter table public.reviews alter column moderation_status set default 'PUBLISHED';

-- 6. Bank-credit evidence kind: real settlement evidence vs clearly labelled local TEST evidence.
alter table public.bank_credits
  add column if not exists evidence_kind text not null default 'BANK_STATEMENT';
alter table public.bank_credits drop constraint if exists bank_credits_evidence_kind_check;
alter table public.bank_credits
  add constraint bank_credits_evidence_kind_check check (evidence_kind in ('BANK_STATEMENT', 'LOCAL_TEST'));

-- 7. Found by the local PostgreSQL run: policies for `anon` must not call private.is_owner_admin() (anon has no access to the
--    private schema, so the whole query failed). Public rows get anon-safe policies; the admin branch stays authenticated-only.
drop policy if exists "products_public_select" on public.products;
create policy "products_public_select"
  on public.products for select
  to anon
  using (is_active = true); -- intentionally public catalogue rows
create policy "products_authenticated_select"
  on public.products for select
  to authenticated
  using (is_active = true or (select private.is_owner_admin()));

drop policy if exists "reviews_select_published_or_own_or_admin" on public.reviews;
create policy "reviews_select_published_public"
  on public.reviews for select
  to anon
  using (moderation_status = 'PUBLISHED'); -- column grants hide reviewer identity and moderation notes
create policy "reviews_select_published_or_own_or_admin"
  on public.reviews for select
  to authenticated
  using (
    moderation_status = 'PUBLISHED'
    or user_id = (select auth.uid())
    or (select private.is_owner_admin())
  );

-- 8. Found by the local PostgreSQL run: the own-profile UPDATE policy selected from user_profiles inside its own WITH CHECK
--    ("infinite recursion detected in policy"), so customers could not save their profile. Role and is_active are protected
--    by column grants (migration ...02), by this migration's trigger, and by the check below that admins only may change rows.
drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own"
  on public.user_profiles for update
  to authenticated
  using ((select auth.uid()) = id or (select private.is_owner_admin()))
  with check ((select auth.uid()) = id or (select private.is_owner_admin()));

commit;
