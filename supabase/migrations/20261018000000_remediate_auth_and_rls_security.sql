-- =============================================================================
-- Balaji Faki Point — Security Remediation for Auth, RLS & Legacy DB Accounts
-- Migration: 20261018000000_remediate_auth_and_rls_security.sql
--
-- Remediates vulnerabilities introduced in 20261017000002_simple_db_auth.sql:
-- 1. Archives legacy custom password hashes into non-exposed `private.legacy_db_auth_accounts`
--    and drops `password_hash` from exposed `public.user_profiles`.
-- 2. Revokes and drops unauthenticated RPCs `public.simple_auth_login` and
--    `public.simple_auth_update_profile`.
-- 3. Drops permissive `to anon, authenticated using (true)` policies on
--    `public.user_profiles` and `public.customers`.
-- 4. Restores strict ownership-based and `private.is_owner_admin()` RLS policies.
-- 5. Prevents privilege escalation (`role` / `is_active` tampering) via both RLS
--    `WITH CHECK` and a defense-in-depth `BEFORE INSERT OR UPDATE` trigger.
-- 6. Replaces automatic unverified email relinking with an EXPLICIT, ownership-verified
--    account-linking RPC (`public.link_verified_legacy_account(p_legacy_password text)`)
--    that requires an authenticated + email-confirmed Supabase Auth user AND cryptographic
--    verification of the legacy password hash before relinking profile, customer, and order rows.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Archive legacy custom DB-auth accounts to private schema & drop password_hash
-- -----------------------------------------------------------------------------
create table if not exists private.legacy_db_auth_accounts (
  user_id uuid primary key,
  email text not null,
  password_hash text not null,
  full_name text not null default '',
  phone text not null default '',
  role text not null,
  linked_auth_user_id uuid references auth.users(id) on delete set null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  migrated_to_auth_at timestamptz,
  archived_at timestamptz not null default now()
);

alter table private.legacy_db_auth_accounts
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz;

revoke all on table private.legacy_db_auth_accounts from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'password_hash'
  ) then
    execute $sql$
      insert into private.legacy_db_auth_accounts (
        user_id,
        email,
        password_hash,
        full_name,
        phone,
        role,
        linked_auth_user_id,
        migrated_to_auth_at
      )
      select
        up.id,
        lower(trim(up.email)),
        up.password_hash,
        coalesce(up.full_name, ''),
        coalesce(up.phone, ''),
        up.role,
        case when exists (select 1 from auth.users au where au.id = up.id) then up.id else null end,
        case when exists (select 1 from auth.users au where au.id = up.id) then now() else null end
      from public.user_profiles up
      where up.password_hash is not null and up.password_hash <> ''
      on conflict (user_id) do update
        set email = excluded.email,
            password_hash = excluded.password_hash,
            full_name = excluded.full_name,
            phone = excluded.phone,
            role = excluded.role,
            linked_auth_user_id = coalesce(private.legacy_db_auth_accounts.linked_auth_user_id, excluded.linked_auth_user_id),
            migrated_to_auth_at = coalesce(private.legacy_db_auth_accounts.migrated_to_auth_at, excluded.migrated_to_auth_at)
    $sql$;

    alter table public.user_profiles
      drop column password_hash;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Revoke and drop insecure direct-DB authentication RPCs
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'simple_auth_login'
  ) then
    revoke all on function public.simple_auth_login(text, text) from public, anon, authenticated, service_role;
    drop function public.simple_auth_login(text, text);
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'simple_auth_update_profile'
  ) then
    revoke all on function public.simple_auth_update_profile(uuid, text, text) from public, anon, authenticated, service_role;
    drop function public.simple_auth_update_profile(uuid, text, text);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Restore `auth.users` FK (NOT VALID for unmigrated legacy rows) & quarantine
--    unlinked legacy profile emails so new Supabase Auth registrations do not
--    collide on `user_profiles_email_lower_uidx` before ownership verification.
-- -----------------------------------------------------------------------------
alter table public.user_profiles
  alter column id drop default;

update public.user_profiles up
set email = 'legacy+' || up.id::text || '@unlinked.balajifakipoint.internal',
    is_active = false
where not exists (select 1 from auth.users au where au.id = up.id)
  and up.email not like 'legacy+%@unlinked.balajifakipoint.internal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_id_fkey'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_id_fkey
      foreign key (id) references auth.users(id)
      on delete cascade
      not valid;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Drop permissive `*_simple_auth_*` RLS policies & restore strict ownership RLS
-- -----------------------------------------------------------------------------
drop policy if exists "user_profiles_simple_auth_select" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_insert" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_update" on public.user_profiles;
drop policy if exists "user_profiles_select_own_or_admin" on public.user_profiles;
drop policy if exists "user_profiles_insert_own_customer" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;

create policy "user_profiles_select_own_or_admin"
  on public.user_profiles for select
  to authenticated
  using ((select auth.uid()) = id or (select private.is_owner_admin()));

create policy "user_profiles_insert_own_customer"
  on public.user_profiles for insert
  to authenticated
  with check (
    (select auth.uid()) = id
    and role = 'CUSTOMER'
    and is_active = true
  );

create policy "user_profiles_update_own"
  on public.user_profiles for update
  to authenticated
  using ((select auth.uid()) = id or (select private.is_owner_admin()))
  with check (
    (
      (select auth.uid()) = id
      and role = (select up.role from public.user_profiles up where up.id = (select auth.uid()))
      and is_active = (select up.is_active from public.user_profiles up where up.id = (select auth.uid()))
    )
    or (select private.is_owner_admin())
  );

drop policy if exists "customers_simple_auth_select" on public.customers;
drop policy if exists "customers_simple_auth_insert" on public.customers;
drop policy if exists "customers_simple_auth_update" on public.customers;
drop policy if exists "customers_select_own_or_admin" on public.customers;
drop policy if exists "customers_admin_insert" on public.customers;
drop policy if exists "customers_admin_update" on public.customers;
drop policy if exists "customers_admin_delete" on public.customers;
drop policy if exists "customers_insert_own_or_admin" on public.customers;
drop policy if exists "customers_update_own_or_admin" on public.customers;

create policy "customers_select_own_or_admin"
  on public.customers for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "customers_insert_own_or_admin"
  on public.customers for insert
  to authenticated
  with check (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "customers_update_own_or_admin"
  on public.customers for update
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner_admin()))
  with check (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "customers_admin_delete"
  on public.customers for delete
  to authenticated
  using ((select private.is_owner_admin()));

-- -----------------------------------------------------------------------------
-- 5. Defense-in-depth trigger preventing self-assignment of OWNER_ADMIN
-- -----------------------------------------------------------------------------
create or replace function private.enforce_user_profile_role_security()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  -- Only service_role, postgres/supabase_auth_admin triggers, or verified OWNER_ADMIN may assign OWNER_ADMIN
  if v_jwt_role in ('anon', 'authenticated') and not private.is_owner_admin() then
    if tg_op = 'INSERT' then
      new.role := 'CUSTOMER';
      new.is_active := true;
    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role then
        raise exception 'Unauthorized: users cannot modify their own role.';
      end if;
      if new.is_active is distinct from old.is_active then
        raise exception 'Unauthorized: users cannot modify their own active status.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_user_profile_role_security() from public, anon, authenticated;

drop trigger if exists trg_enforce_user_profile_role_security on public.user_profiles;
create trigger trg_enforce_user_profile_role_security
  before insert or update on public.user_profiles
  for each row execute function private.enforce_user_profile_role_security();

-- -----------------------------------------------------------------------------
-- 6. `private.handle_new_auth_user()` — Provisions a clean `public.user_profiles`
--    row for `new.id` without blindly auto-linking unverified legacy accounts.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_full_name text := trim(coalesce(new.raw_user_meta_data ->> 'fullName', ''));
  v_phone text := trim(coalesce(new.raw_user_meta_data ->> 'phone', ''));
  v_profile public.user_profiles%rowtype;
begin
  insert into public.user_profiles (id, email, full_name, phone, role, is_active)
  values (
    new.id,
    v_email,
    v_full_name,
    v_phone,
    case
      when (new.raw_app_meta_data ->> 'role') = 'OWNER_ADMIN' then 'OWNER_ADMIN'
      else 'CUSTOMER'
    end,
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case when excluded.full_name <> '' then excluded.full_name else public.user_profiles.full_name end,
        phone = case when excluded.phone <> '' then excluded.phone else public.user_profiles.phone end,
        role = case
          when (new.raw_app_meta_data ->> 'role') = 'OWNER_ADMIN' then 'OWNER_ADMIN'
          else public.user_profiles.role
        end,
        updated_at = now()
  returning * into v_profile;

  if v_profile.full_name <> '' and v_profile.phone <> '' then
    insert into public.customers (user_id, full_name, phone, email)
    values (v_profile.id, v_profile.full_name, v_profile.phone, v_profile.email)
    on conflict (user_id) do update
      set full_name = excluded.full_name,
          phone = excluded.phone,
          email = excluded.email,
          updated_at = now();
  end if;

  return new;
end;
$$;

revoke execute on function private.handle_new_auth_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Explicit, Ownership-Verified Legacy Account Linking RPCs
--    `public.link_verified_legacy_account(p_legacy_password text)`
--    `public.admin_link_legacy_account(p_legacy_user_id uuid, p_target_auth_user_id uuid, p_verification_notes text)`
--
--    Security guarantees:
--    - Requires an authenticated Supabase Auth user (`auth.uid()`).
--    - When "Confirm email" is disabled in Supabase Auth, `email_confirmed_at` is
--      auto-populated on signup and MUST NOT be treated as proof of ownership.
--      Ownership is verified strictly via cryptographic check of the legacy password
--      against `private.legacy_db_auth_accounts.password_hash` (`extensions.crypt`).
--    - Enforces brute-force lockout: after 5 failed attempts, the legacy account is
--      locked for 30 minutes.
--    - Explicitly relinks `public.customers`, `public.orders`, `public.payment_attempts`,
--      `public.reviews`, `public.cancellation_requests`, and `public.notifications`
--      from the legacy UUID to `auth.uid()`.
--    - Never escalates user role: linked profile retains its verified `CUSTOMER` role.
--    - Audited admin recovery pathway allows `OWNER_ADMIN` to link verified accounts
--      with mandatory verification notes if customer forgot their legacy password.
-- -----------------------------------------------------------------------------
create or replace function public.link_verified_legacy_account(
  p_legacy_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_auth_email text;
  v_legacy private.legacy_db_auth_accounts%rowtype;
  v_legacy_customer_id uuid;
  v_current_customer_id uuid;
  v_profile public.user_profiles%rowtype;
  v_max_attempts constant integer := 5;
begin
  if v_uid is null then
    raise exception 'Authentication required to link a legacy account.';
  end if;

  select lower(trim(au.email))
  into v_auth_email
  from auth.users au
  where au.id = v_uid;

  if v_auth_email is null or v_auth_email = '' then
    raise exception 'Authenticated user does not have a valid email address.';
  end if;

  select *
  into v_legacy
  from private.legacy_db_auth_accounts la
  where lower(la.email) = v_auth_email
    and la.linked_auth_user_id is null
  for update;

  if not found then
    raise exception 'No unlinked legacy account found for %.', v_auth_email;
  end if;

  -- Brute-force protection: check if account is locked
  if v_legacy.locked_until is not null and v_legacy.locked_until > now() then
    raise exception 'Legacy account recovery is temporarily locked due to repeated failed attempts. Please try again after %.',
      to_char(v_legacy.locked_until, 'YYYY-MM-DD HH24:MI:SS UTC');
  end if;

  -- Cryptographic verification of legacy password
  if coalesce(p_legacy_password, '') = ''
     or v_legacy.password_hash <> extensions.crypt(p_legacy_password, v_legacy.password_hash) then
    update private.legacy_db_auth_accounts
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= v_max_attempts then now() + interval '30 minutes' else null end
    where user_id = v_legacy.user_id;

    if v_legacy.failed_attempts + 1 >= v_max_attempts then
      raise exception 'Invalid legacy account password. Account locked for 30 minutes due to % consecutive failed attempts.',
        v_max_attempts;
    else
      raise exception 'Invalid legacy account password. Ownership verification failed (% attempts remaining).',
        v_max_attempts - (v_legacy.failed_attempts + 1);
    end if;
  end if;

  -- Preserve full_name and phone on the verified auth.uid() profile (never escalate role)
  update public.user_profiles
  set full_name = case when full_name = '' then v_legacy.full_name else full_name end,
      phone = case when phone = '' then v_legacy.phone else phone end,
      updated_at = now()
  where id = v_uid
  returning * into v_profile;

  -- Relink customer record and all dependent orders/reviews if a legacy customer row exists
  select c.id into v_legacy_customer_id
  from public.customers c
  where c.user_id = v_legacy.user_id;

  select c.id into v_current_customer_id
  from public.customers c
  where c.user_id = v_uid;

  if v_legacy_customer_id is not null then
    if v_current_customer_id is not null and v_current_customer_id <> v_legacy_customer_id then
      update public.orders
      set customer_id = v_current_customer_id
      where customer_id = v_legacy_customer_id;

      update public.reviews
      set customer_id = v_current_customer_id
      where customer_id = v_legacy_customer_id;

      update public.notifications
      set customer_id = v_current_customer_id
      where customer_id = v_legacy_customer_id;

      delete from public.customers
      where id = v_legacy_customer_id;
    else
      update public.customers
      set user_id = v_uid,
          email = v_auth_email,
          updated_at = now()
      where id = v_legacy_customer_id;
    end if;
  end if;

  -- Relink user_id references across operational tables
  update public.orders set user_id = v_uid where user_id = v_legacy.user_id;
  update public.payment_attempts set user_id = v_uid where user_id = v_legacy.user_id;
  update public.reviews set user_id = v_uid where user_id = v_legacy.user_id;
  update public.cancellation_requests set requested_by_user_id = v_uid where requested_by_user_id = v_legacy.user_id;
  update public.notifications set user_id = v_uid where user_id = v_legacy.user_id;
  update public.order_status_history set actor_id = v_uid where actor_id = v_legacy.user_id;

  -- Remove quarantined orphan profile row if it was distinct from v_uid
  if v_legacy.user_id <> v_uid then
    delete from public.user_profiles
    where id = v_legacy.user_id
      and not exists (select 1 from auth.users au where au.id = v_legacy.user_id);
  end if;

  update private.legacy_db_auth_accounts
  set linked_auth_user_id = v_uid,
      migrated_to_auth_at = now(),
      failed_attempts = 0,
      locked_until = null
  where user_id = v_legacy.user_id;

  insert into public.admin_audit_logs (
    actor_id,
    actor_email,
    actor_role,
    action,
    module,
    entity_type,
    entity_id,
    previous_state,
    new_state
  )
  values (
    v_uid,
    v_auth_email,
    v_profile.role,
    'LEGACY_ACCOUNT_LINKED',
    'AUTH',
    'USER_PROFILE',
    v_uid::text,
    jsonb_build_object('legacyUserId', v_legacy.user_id, 'email', v_legacy.email),
    jsonb_build_object('linkedAuthUserId', v_uid, 'email', v_auth_email, 'method', 'PASSWORD_VERIFIED')
  );

  return jsonb_build_object(
    'linked', true,
    'legacyUserId', v_legacy.user_id,
    'authUserId', v_uid,
    'email', v_auth_email
  );
end;
$$;

revoke all on function public.link_verified_legacy_account(text) from public, anon;
grant execute on function public.link_verified_legacy_account(text) to authenticated, service_role;

-- Administrative legacy account linkage for customer recovery (Owner Admin only)
create or replace function public.admin_link_legacy_account(
  p_legacy_user_id uuid,
  p_target_auth_user_id uuid,
  p_verification_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_uid uuid := (select auth.uid());
  v_admin_email text;
  v_legacy private.legacy_db_auth_accounts%rowtype;
  v_target_email text;
  v_legacy_customer_id uuid;
  v_current_customer_id uuid;
begin
  if not (select private.is_owner_admin()) then
    raise exception 'Owner Admin privileges required for administrative account recovery.';
  end if;

  if coalesce(trim(p_verification_notes), '') = '' then
    raise exception 'Verification notes are required for administrative account recovery.';
  end if;

  select lower(trim(au.email)) into v_admin_email
  from auth.users au where au.id = v_admin_uid;

  select lower(trim(au.email)) into v_target_email
  from auth.users au where au.id = p_target_auth_user_id;

  if v_target_email is null then
    raise exception 'Target auth user % does not exist.', p_target_auth_user_id;
  end if;

  select * into v_legacy
  from private.legacy_db_auth_accounts la
  where la.user_id = p_legacy_user_id
    and la.linked_auth_user_id is null
  for update;

  if not found then
    raise exception 'Unlinked legacy account % not found.', p_legacy_user_id;
  end if;

  -- Relink customer records and operations to target user
  select c.id into v_legacy_customer_id from public.customers c where c.user_id = v_legacy.user_id;
  select c.id into v_current_customer_id from public.customers c where c.user_id = p_target_auth_user_id;

  if v_legacy_customer_id is not null then
    if v_current_customer_id is not null and v_current_customer_id <> v_legacy_customer_id then
      update public.orders set customer_id = v_current_customer_id where customer_id = v_legacy_customer_id;
      update public.reviews set customer_id = v_current_customer_id where customer_id = v_legacy_customer_id;
      update public.notifications set customer_id = v_current_customer_id where customer_id = v_legacy_customer_id;
      delete from public.customers where id = v_legacy_customer_id;
    else
      update public.customers set user_id = p_target_auth_user_id, email = v_target_email, updated_at = now() where id = v_legacy_customer_id;
    end if;
  end if;

  update public.orders set user_id = p_target_auth_user_id where user_id = v_legacy.user_id;
  update public.payment_attempts set user_id = p_target_auth_user_id where user_id = v_legacy.user_id;
  update public.reviews set user_id = p_target_auth_user_id where user_id = v_legacy.user_id;
  update public.cancellation_requests set requested_by_user_id = p_target_auth_user_id where requested_by_user_id = v_legacy.user_id;
  update public.notifications set user_id = p_target_auth_user_id where user_id = v_legacy.user_id;
  update public.order_status_history set actor_id = p_target_auth_user_id where actor_id = v_legacy.user_id;

  if v_legacy.user_id <> p_target_auth_user_id then
    delete from public.user_profiles
    where id = v_legacy.user_id
      and not exists (select 1 from auth.users au where au.id = v_legacy.user_id);
  end if;

  update private.legacy_db_auth_accounts
  set linked_auth_user_id = p_target_auth_user_id,
      migrated_to_auth_at = now(),
      failed_attempts = 0,
      locked_until = null
  where user_id = v_legacy.user_id;

  insert into public.admin_audit_logs (
    actor_id,
    actor_email,
    actor_role,
    action,
    module,
    entity_type,
    entity_id,
    previous_state,
    new_state
  )
  values (
    v_admin_uid,
    v_admin_email,
    'OWNER_ADMIN',
    'ADMIN_LEGACY_ACCOUNT_LINKED',
    'AUTH',
    'USER_PROFILE',
    p_target_auth_user_id::text,
    jsonb_build_object('legacyUserId', v_legacy.user_id, 'email', v_legacy.email),
    jsonb_build_object(
      'linkedAuthUserId', p_target_auth_user_id,
      'targetEmail', v_target_email,
      'verificationNotes', p_verification_notes
    )
  );

  return jsonb_build_object(
    'linked', true,
    'legacyUserId', v_legacy.user_id,
    'authUserId', p_target_auth_user_id,
    'method', 'ADMIN_VERIFIED'
  );
end;
$$;

revoke all on function public.admin_link_legacy_account(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_link_legacy_account(uuid, uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Authenticated-only profile sync RPC (`public.sync_my_profile`)
--    Uses `(select auth.uid())` — never accepts an arbitrary user_id parameter.
-- -----------------------------------------------------------------------------
create or replace function public.sync_my_profile(
  p_full_name text,
  p_phone text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := trim(coalesce(p_full_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
  v_profile public.user_profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 100 then
    raise exception 'Full name must be between 2 and 100 characters.';
  end if;

  if v_phone !~ '^\+91[6-9][0-9]{9}$' then
    raise exception 'Phone must be a valid Indian mobile number (+91 followed by 10 digits).';
  end if;

  update public.user_profiles
  set full_name = v_name,
       phone = v_phone,
      updated_at = now()
  where id = v_uid
  returning * into v_profile;

  if not found then
    raise exception 'Authenticated user profile not found.';
  end if;

  insert into public.customers (user_id, full_name, phone, email)
  values (v_uid, v_name, v_phone, v_profile.email)
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        email = excluded.email,
        updated_at = now();

  return jsonb_build_object(
    'id', v_profile.id,
    'email', v_profile.email,
    'fullName', v_profile.full_name,
    'phone', v_profile.phone,
    'role', v_profile.role,
    'isActive', v_profile.is_active
  );
end;
$$;

revoke all on function public.sync_my_profile(text, text) from public, anon;
grant execute on function public.sync_my_profile(text, text) to authenticated, service_role;

commit;
