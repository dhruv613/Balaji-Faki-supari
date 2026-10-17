-- =============================================================================
-- Balaji Faki Point — Simple Database-Backed Login (No Email Confirmation)
-- Migration: 20261017000002_simple_db_auth.sql
--
-- Behavior:
-- 1. If email is NOT in Database (`public.user_profiles`) -> creates account
--    immediately and logs in (no Supabase Auth email confirmation required).
-- 2. If email IS in Database -> verifies password and logs in immediately.
-- 3. `simple_auth_update_profile` saves `full_name` and `phone` to both
--    `public.user_profiles` and `public.customers`.
-- =============================================================================

begin;

-- Allow `public.user_profiles` to store accounts created directly in DB without requiring `auth.users`
alter table public.user_profiles
  drop constraint if exists user_profiles_id_fkey;

alter table public.user_profiles
  alter column id set default gen_random_uuid();

alter table public.user_profiles
  add column if not exists password_hash text;

create unique index if not exists user_profiles_email_lower_uidx
  on public.user_profiles (lower(email));

-- Update RLS policies on `user_profiles` and `customers` to support direct DB login & profile save
drop policy if exists "user_profiles_select_own_or_admin" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_select" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_insert" on public.user_profiles;
drop policy if exists "user_profiles_simple_auth_update" on public.user_profiles;

create policy "user_profiles_simple_auth_select"
  on public.user_profiles for select
  to anon, authenticated
  using (true);

create policy "user_profiles_simple_auth_insert"
  on public.user_profiles for insert
  to anon, authenticated
  with check (role in ('CUSTOMER', 'OWNER_ADMIN'));

create policy "user_profiles_simple_auth_update"
  on public.user_profiles for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "customers_select_own_or_admin" on public.customers;
drop policy if exists "customers_admin_insert" on public.customers;
drop policy if exists "customers_admin_update" on public.customers;
drop policy if exists "customers_simple_auth_select" on public.customers;
drop policy if exists "customers_simple_auth_insert" on public.customers;
drop policy if exists "customers_simple_auth_update" on public.customers;

create policy "customers_simple_auth_select"
  on public.customers for select
  to anon, authenticated
  using (true);

create policy "customers_simple_auth_insert"
  on public.customers for insert
  to anon, authenticated
  with check (true);

create policy "customers_simple_auth_update"
  on public.customers for update
  to anon, authenticated
  using (true)
  with check (true);

-- =============================================================================
-- RPC 1: `public.simple_auth_login(p_email, p_password)`
-- - If email not in DB -> creates account & returns user + action = 'CREATED'
-- - If email in DB -> verifies password & returns user + action = 'LOGGED_IN'
-- =============================================================================
create or replace function public.simple_auth_login(
  p_email text,
  p_password text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_profile public.user_profiles%rowtype;
  v_action text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Please enter a valid email address.';
  end if;

  if coalesce(char_length(p_password), 0) < 4 then
    raise exception 'Password must be at least 4 characters.';
  end if;

  select *
  into v_profile
  from public.user_profiles up
  where lower(up.email) = v_email
  limit 1;

  if not found then
    insert into public.user_profiles (
      email,
      password_hash,
      full_name,
      phone,
      role,
      is_active
    )
    values (
      v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      '',
      '',
      'CUSTOMER',
      true
    )
    returning * into v_profile;

    v_action := 'CREATED';
  else
    if not v_profile.is_active then
      raise exception 'This account has been deactivated.';
    end if;

    if v_profile.password_hash is null or v_profile.password_hash = '' then
      update public.user_profiles
      set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf')),
          updated_at = now()
      where id = v_profile.id
      returning * into v_profile;
    elsif v_profile.password_hash <> extensions.crypt(p_password, v_profile.password_hash) then
      raise exception 'Invalid login credentials';
    end if;

    v_action := 'LOGGED_IN';
  end if;

  return jsonb_build_object(
    'action', v_action,
    'user', jsonb_build_object(
      'id', v_profile.id,
      'email', v_profile.email,
      'fullName', v_profile.full_name,
      'phone', v_profile.phone,
      'role', v_profile.role,
      'isActive', v_profile.is_active
    )
  );
end;
$$;

grant execute on function public.simple_auth_login(text, text) to anon, authenticated, service_role;

-- =============================================================================
-- RPC 2: `public.simple_auth_update_profile(p_user_id, p_full_name, p_phone)`
-- Updates `user_profiles` and upserts `customers` in the database.
-- =============================================================================
create or replace function public.simple_auth_update_profile(
  p_user_id uuid,
  p_full_name text,
  p_phone text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_full_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
  v_profile public.user_profiles%rowtype;
begin
  update public.user_profiles
  set full_name = v_name,
      phone = v_phone,
      updated_at = now()
  where id = p_user_id
  returning * into v_profile;

  if not found then
    raise exception 'Account not found in database.';
  end if;

  insert into public.customers (
    user_id,
    full_name,
    phone,
    email
  )
  values (
    v_profile.id,
    v_name,
    v_phone,
    v_profile.email
  )
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

grant execute on function public.simple_auth_update_profile(uuid, text, text) to anon, authenticated, service_role;

commit;
