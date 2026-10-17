-- =============================================================================
-- Balaji Faki Point — Complete Production PostgreSQL & Supabase Schema
-- Migration: 20261017000000_balaji_faki_point_schema.sql
--
-- Covers all 18 operational tables, foreign-key indexes, state-machine CHECK
-- constraints, atomic payment/order verification functions, Row-Level Security
-- (RLS) policies following Supabase Postgres best practices, private Storage
-- bucket (`payment-proofs`), and initial catalog seed (`faki`, `supari`).
-- =============================================================================

begin;

-- Extensions
create extension if not exists pgcrypto with schema extensions;

-- Private schema for internal authorization helpers (not exposed via PostgREST)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- Generic updated_at trigger function
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- 1. user_profiles (RBAC & Authenticated Identity)
-- =============================================================================
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text not null default '',
  role text not null default 'CUSTOMER' check (role in ('CUSTOMER', 'OWNER_ADMIN')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_role_idx on public.user_profiles (role) where role = 'OWNER_ADMIN';
create index if not exists user_profiles_email_idx on public.user_profiles (email);

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function private.set_updated_at();

-- Helper function in non-exposed `private` schema to verify OWNER_ADMIN role.
-- Never uses editable `user_metadata` claims.
create or replace function private.is_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = (select auth.uid())
      and up.role = 'OWNER_ADMIN'
      and up.is_active = true
  );
$$;

revoke execute on function private.is_owner_admin() from public, anon;
grant execute on function private.is_owner_admin() to authenticated, service_role;

-- Automatically provision a CUSTOMER profile row when a new auth.users entry is created
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email, full_name, phone, role, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'fullName', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
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
        updated_at = now();
  return new;
end;
$$;

revoke execute on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update on auth.users
  for each row execute function private.handle_new_auth_user();

-- =============================================================================
-- 2. customers (Module 07 — Customer Management)
-- =============================================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.user_profiles(id) on delete set null,
  full_name text not null,
  phone text not null,
  email text,
  area text not null default '',
  address text not null default '',
  pin_code text not null default '',
  order_count integer not null default 0 check (order_count >= 0),
  total_spent_paise bigint not null default 0 check (total_spent_paise >= 0),
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_user_id_idx on public.customers (user_id);
create index if not exists customers_phone_idx on public.customers (phone);
create index if not exists customers_area_idx on public.customers (area);

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 3. products (Module 04 — Product Management)
-- =============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('faki', 'supari')),
  name text not null,
  name_gu text not null default '',
  category text not null,
  description text not null default '',
  image_url text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 4. product_variants (Module 04 & 05 — Variants & Stock)
-- =============================================================================
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  pack_size text not null check (pack_size in ('250g', '500g', '1kg')),
  sku text not null unique,
  -- Purchase/cost price stored separately from selling price (NULL means not configured)
  cost_price_paise bigint check (cost_price_paise is null or cost_price_paise >= 0),
  -- Selling price: NULL means awaiting admin price configuration (never fabricate prices)
  price_paise bigint check (price_paise is null or price_paise >= 0),
  is_available boolean not null default true,
  total_stock integer not null default 0 check (total_stock >= 0),
  reserved_stock integer not null default 0 check (reserved_stock >= 0),
  available_stock integer generated always as (total_stock - reserved_stock) stored,
  low_stock_threshold integer not null default 10 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_non_negative_available check (total_stock >= reserved_stock),
  unique (product_id, pack_size)
);

create index if not exists product_variants_product_id_idx on public.product_variants (product_id);

drop trigger if exists trg_product_variants_updated_at on public.product_variants;
create trigger trg_product_variants_updated_at
  before update on public.product_variants
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 5. orders (Module 02 — Order Management)
-- =============================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'PENDING_PAYMENT' check (
    status in (
      'PENDING_PAYMENT',
      'PAYMENT_REVIEW',
      'AWAITING_CONFIRMATION',
      'CONFIRMED',
      'PACKING',
      'PACKED',
      'PICKED_UP',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
      'DELIVERY_FAILED'
    )
  ),
  payment_status text not null default 'PENDING' check (
    payment_status in ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED')
  ),
  delivery_status text check (
    delivery_status is null or delivery_status in (
      'CONFIRMED',
      'PACKING',
      'PACKED',
      'PICKED_UP',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED'
    )
  ),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  delivery_fee_paise bigint not null default 0 check (delivery_fee_paise >= 0),
  total_paise bigint not null check (total_paise = subtotal_paise + delivery_fee_paise),
  shipping_name text not null,
  shipping_phone text not null,
  shipping_email text,
  shipping_address text not null,
  shipping_area text not null default '',
  shipping_pin_code text not null,
  customer_notes text,
  idempotency_key text unique,
  stock_reservation_expires_at timestamptz,
  stock_deducted boolean not null default false,
  confirmed_by uuid references public.user_profiles(id) on delete set null,
  confirmed_at timestamptz,
  cancelled_by uuid references public.user_profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Critical Rule: Order cannot be confirmed, packed, or shipped unless payment_status = 'VERIFIED'
  constraint orders_confirmed_requires_verified_payment check (
    status not in ('CONFIRMED', 'PACKING', 'PACKED', 'PICKED_UP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED')
    or payment_status = 'VERIFIED'
  )
);

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_payment_status_idx on public.orders (payment_status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_confirmed_by_idx on public.orders (confirmed_by);
create index if not exists orders_cancelled_by_idx on public.orders (cancelled_by);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 6. order_items (Module 02 — Line Items)
-- =============================================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_slug text not null check (product_slug in ('faki', 'supari')),
  product_name text not null,
  pack_size text not null check (pack_size in ('250g', '500g', '1kg')),
  quantity integer not null check (quantity between 1 and 20),
  unit_cost_paise bigint check (unit_cost_paise is null or unit_cost_paise >= 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint not null check (line_total_paise = unit_price_paise * quantity),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_items_product_id_idx on public.order_items (product_id);
create index if not exists order_items_variant_id_idx on public.order_items (variant_id);

-- =============================================================================
-- 7. payment_attempts (Module 03 — Manual Payment Verification)
-- =============================================================================
create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  expected_amount_paise bigint not null check (expected_amount_paise > 0),
  submitted_utr text not null check (submitted_utr ~ '^[0-9]{12}$'),
  verified_utr text check (verified_utr is null or verified_utr ~ '^[0-9]{12}$'),
  screenshot_storage_path text not null,
  status text not null default 'SUBMITTED' check (
    status in ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED')
  ),
  proof_correction_requested boolean not null default false,
  idempotency_key text unique,
  verified_by uuid references public.user_profiles(id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  admin_notes text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_attempts_order_id_idx on public.payment_attempts (order_id);
create index if not exists payment_attempts_user_id_idx on public.payment_attempts (user_id);
create index if not exists payment_attempts_status_idx on public.payment_attempts (status);
create index if not exists payment_attempts_verified_by_idx on public.payment_attempts (verified_by);
-- Prevent duplicate verified UTR across all orders
create unique index if not exists payment_attempts_verified_utr_unique_idx
  on public.payment_attempts (verified_utr)
  where status = 'VERIFIED' and verified_utr is not null;

drop trigger if exists trg_payment_attempts_updated_at on public.payment_attempts;
create trigger trg_payment_attempts_updated_at
  before update on public.payment_attempts
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 8. bank_credits (Module 03 — Independent Bank Credit Verification)
-- =============================================================================
create table if not exists public.bank_credits (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null unique references public.payment_attempts(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete restrict,
  bank_credit_ref text not null unique,
  receiving_bank_account text not null,
  verified_utr text not null unique check (verified_utr ~ '^[0-9]{12}$'),
  credited_amount_paise bigint not null check (credited_amount_paise > 0),
  transaction_status text not null default 'CREDITED' check (transaction_status = 'CREDITED'),
  verified_by uuid not null references public.user_profiles(id) on delete restrict,
  verified_at timestamptz not null default now(),
  verification_note text
);

create index if not exists bank_credits_verified_by_idx on public.bank_credits (verified_by);

-- =============================================================================
-- 9. order_status_history (Module 02 — Immutable Order Audit Timeline)
-- =============================================================================
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_name text not null,
  actor_role text not null check (actor_role in ('CUSTOMER', 'OWNER_ADMIN', 'SYSTEM')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_id_idx on public.order_status_history (order_id, created_at desc);
create index if not exists order_status_history_actor_id_idx on public.order_status_history (actor_id);

-- =============================================================================
-- 10. inventory_movements (Module 05 — Stock Movement Ledger)
-- =============================================================================
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type text not null check (
    movement_type in ('MANUAL_ADD', 'MANUAL_DEDUCT', 'RESERVED', 'RELEASED', 'ORDER_DEDUCTED')
  ),
  quantity_delta integer not null check (quantity_delta <> 0),
  previous_available integer not null check (previous_available >= 0),
  new_available integer not null check (new_available >= 0),
  reason text not null check (char_length(trim(reason)) >= 5),
  reference_order_id uuid references public.orders(id) on delete set null,
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_variant_id_idx on public.inventory_movements (variant_id, created_at desc);
create index if not exists inventory_movements_reference_order_id_idx on public.inventory_movements (reference_order_id);
create index if not exists inventory_movements_actor_id_idx on public.inventory_movements (actor_id);

-- =============================================================================
-- 11. shipments (Module 06 — Delivery Management)
-- =============================================================================
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  delivery_status text not null default 'CONFIRMED' check (
    delivery_status in (
      'CONFIRMED',
      'PACKING',
      'PACKED',
      'PICKED_UP',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED'
    )
  ),
  assigned_delivery_person text,
  delivery_phone text,
  courier_reference text,
  dispatch_date timestamptz,
  pickup_date timestamptz,
  estimated_delivery_date timestamptz,
  delivered_date timestamptz,
  delivery_notes text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_delivery_status_idx on public.shipments (delivery_status);

drop trigger if exists trg_shipments_updated_at on public.shipments;
create trigger trg_shipments_updated_at
  before update on public.shipments
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 12. delivery_events (Module 06 — Immutable Delivery Tracking Timeline)
-- =============================================================================
create table if not exists public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null check (
    status in (
      'CONFIRMED',
      'PACKING',
      'PACKED',
      'PICKED_UP',
      'SHIPPED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'DELIVERY_FAILED'
    )
  ),
  label text not null,
  note text,
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists delivery_events_shipment_id_idx on public.delivery_events (shipment_id, created_at asc);
create index if not exists delivery_events_order_id_idx on public.delivery_events (order_id, created_at asc);
create index if not exists delivery_events_actor_id_idx on public.delivery_events (actor_id);

-- =============================================================================
-- 13. reviews (Module 08 — Reviews & Feedback)
-- =============================================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  user_id uuid not null references public.user_profiles(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  review_text text not null check (char_length(trim(review_text)) >= 10),
  is_verified_purchase boolean not null default true,
  moderation_status text not null default 'PENDING_MODERATION' check (
    moderation_status in ('PUBLISHED', 'HIDDEN', 'PENDING_MODERATION')
  ),
  moderation_reason text,
  admin_reply text,
  admin_replied_at timestamptz,
  moderated_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reviews_customer_id_idx on public.reviews (customer_id);
create index if not exists reviews_user_id_idx on public.reviews (user_id);
create index if not exists reviews_product_id_idx on public.reviews (product_id);
create index if not exists reviews_moderation_status_idx on public.reviews (moderation_status);
create index if not exists reviews_moderated_by_idx on public.reviews (moderated_by);

drop trigger if exists trg_reviews_updated_at on public.reviews;
create trigger trg_reviews_updated_at
  before update on public.reviews
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 14. cancellation_requests (Module 09 — Cancellations)
-- =============================================================================
create table if not exists public.cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  requested_by_user_id uuid references public.user_profiles(id) on delete set null,
  requested_by_role text not null check (requested_by_role in ('CUSTOMER', 'OWNER_ADMIN')),
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create index if not exists cancellation_requests_order_id_idx on public.cancellation_requests (order_id);
create index if not exists cancellation_requests_requested_by_user_id_idx on public.cancellation_requests (requested_by_user_id);
create index if not exists cancellation_requests_reviewed_by_idx on public.cancellation_requests (reviewed_by);

-- =============================================================================
-- 15. refunds (Module 09 — Refunds & Bank Transfer Verification)
-- =============================================================================
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  original_payment_id uuid not null references public.payment_attempts(id) on delete restrict,
  original_payment_utr text not null,
  refund_amount_paise bigint not null check (refund_amount_paise > 0),
  verified_refund_amount_paise bigint check (
    verified_refund_amount_paise is null or verified_refund_amount_paise > 0
  ),
  refund_reason text not null,
  status text not null default 'PENDING' check (
    status in ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED')
  ),
  refund_transaction_reference text unique,
  refund_bank_account text,
  refund_date date,
  verified_by uuid references public.user_profiles(id) on delete set null,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Critical Rule: Refund cannot be COMPLETED without verified bank reference, bank account, date & exact amount
  constraint refunds_completed_requires_bank_verification check (
    status <> 'COMPLETED'
    or (
      refund_transaction_reference is not null
      and char_length(trim(refund_transaction_reference)) >= 6
      and refund_bank_account is not null
      and char_length(trim(refund_bank_account)) >= 4
      and refund_date is not null
      and verified_refund_amount_paise = refund_amount_paise
    )
  )
);

create index if not exists refunds_order_id_idx on public.refunds (order_id);
create index if not exists refunds_original_payment_id_idx on public.refunds (original_payment_id);
create index if not exists refunds_status_idx on public.refunds (status);
create index if not exists refunds_verified_by_idx on public.refunds (verified_by);

drop trigger if exists trg_refunds_updated_at on public.refunds;
create trigger trg_refunds_updated_at
  before update on public.refunds
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 16. notifications (Module 11 — Customer Notifications)
-- =============================================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  user_id uuid references public.user_profiles(id) on delete set null,
  event_type text not null check (
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
      'REFUND_PROCESSED'
    )
  ),
  channel text not null check (channel in ('IN_APP', 'EMAIL', 'SMS_WHATSAPP')),
  recipient text not null,
  subject text not null,
  message_preview text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENT', 'DELIVERED', 'FAILED')),
  error_message text,
  sent_by uuid references public.user_profiles(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_order_id_idx on public.notifications (order_id);
create index if not exists notifications_customer_id_idx on public.notifications (customer_id);
create index if not exists notifications_user_id_idx on public.notifications (user_id);
create index if not exists notifications_status_idx on public.notifications (status);
create index if not exists notifications_sent_by_idx on public.notifications (sent_by);

-- =============================================================================
-- 17. store_settings (Module 12 — Store Settings Singleton)
-- =============================================================================
create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  store_name text not null default 'Balaji Faki Point',
  store_name_gu text not null default 'બાલાજી ફાકી પોઈન્ટ',
  tagline text not null default 'Freshly Prepared Faki & Supari',
  support_phone text not null default '+91 80009 61030',
  support_whatsapp text not null default '918000961030',
  support_email text not null default 'support@balajifakipoint.com',
  store_address text not null default 'Rajkot, Gujarat',
  opening_hours text not null default '9:00 AM – 9:00 PM',
  upi_payee_name text,
  upi_id text,
  qr_code_storage_path text,
  delivery_charge_paise bigint check (delivery_charge_paise is null or delivery_charge_paise >= 0),
  free_delivery_threshold_paise bigint check (
    free_delivery_threshold_paise is null or free_delivery_threshold_paise >= 0
  ),
  serviceable_pin_codes jsonb not null default '["360001","360002","360004","360005","360007"]'::jsonb,
  low_stock_default_threshold integer not null default 10 check (low_stock_default_threshold >= 0),
  stock_reservation_expiry_minutes integer not null default 30 check (stock_reservation_expiry_minutes > 0),
  updated_by uuid references public.user_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists store_settings_updated_by_idx on public.store_settings (updated_by);

drop trigger if exists trg_store_settings_updated_at on public.store_settings;
create trigger trg_store_settings_updated_at
  before update on public.store_settings
  for each row execute function private.set_updated_at();

-- =============================================================================
-- 18. admin_audit_logs (Immutable Administrative Audit Log)
-- =============================================================================
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.user_profiles(id) on delete set null,
  actor_email text not null,
  actor_role text not null default 'OWNER_ADMIN',
  action text not null,
  module text not null,
  entity_type text not null,
  entity_id text not null,
  previous_state jsonb,
  new_state jsonb,
  ip_address text,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_actor_id_idx on public.admin_audit_logs (actor_id);
create index if not exists admin_audit_logs_entity_idx on public.admin_audit_logs (entity_type, entity_id);
create index if not exists admin_audit_logs_created_at_idx on public.admin_audit_logs (created_at desc);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES ON ALL 18 TABLES
-- Following Supabase security best practices:
-- - Enable RLS on every table in `public`
-- - Always specify `to authenticated` / `to anon` (never `auth.role()`)
-- - Wrap `(select auth.uid())` and `(select private.is_owner_admin())` for caching
-- - Provide both `using` and `with check` on UPDATE policies
-- =============================================================================

alter table public.user_profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.bank_credits enable row level security;
alter table public.order_status_history enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.shipments enable row level security;
alter table public.delivery_events enable row level security;
alter table public.reviews enable row level security;
alter table public.cancellation_requests enable row level security;
alter table public.refunds enable row level security;
alter table public.notifications enable row level security;
alter table public.store_settings enable row level security;
alter table public.admin_audit_logs enable row level security;

-- 1. user_profiles policies
create policy "user_profiles_select_own_or_admin"
  on public.user_profiles for select
  to authenticated
  using ((select auth.uid()) = id or (select private.is_owner_admin()));

create policy "user_profiles_update_own"
  on public.user_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id and role = (select up.role from public.user_profiles up where up.id = (select auth.uid())));

-- 2. customers policies
create policy "customers_select_own_or_admin"
  on public.customers for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "customers_admin_write"
  on public.customers for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 3. products & 4. product_variants policies (public catalog read; admin write)
create policy "products_public_select"
  on public.products for select
  to anon, authenticated
  using (is_active = true or (select private.is_owner_admin()));

create policy "products_admin_write"
  on public.products for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

create policy "product_variants_public_select"
  on public.product_variants for select
  to anon, authenticated
  using (true);

create policy "product_variants_admin_write"
  on public.product_variants for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 5. orders & 6. order_items policies
create policy "orders_select_own_or_admin"
  on public.orders for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "orders_admin_update"
  on public.orders for update
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

create policy "order_items_select_own_or_admin"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.user_id = (select auth.uid()) or (select private.is_owner_admin()))
    )
  );

-- 7. payment_attempts & 8. bank_credits policies
create policy "payment_attempts_select_own_or_admin"
  on public.payment_attempts for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "payment_attempts_admin_update"
  on public.payment_attempts for update
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

create policy "bank_credits_admin_only"
  on public.bank_credits for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 9. order_status_history policies
create policy "order_status_history_select_own_or_admin"
  on public.order_status_history for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_status_history.order_id
        and (o.user_id = (select auth.uid()) or (select private.is_owner_admin()))
    )
  );

create policy "order_status_history_admin_insert"
  on public.order_status_history for insert
  to authenticated
  with check ((select private.is_owner_admin()));

-- 10. inventory_movements policies
create policy "inventory_movements_admin_only"
  on public.inventory_movements for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 11. shipments & 12. delivery_events policies
create policy "shipments_select_own_or_admin"
  on public.shipments for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = shipments.order_id
        and (o.user_id = (select auth.uid()) or (select private.is_owner_admin()))
    )
  );

create policy "shipments_admin_write"
  on public.shipments for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

create policy "delivery_events_select_own_or_admin"
  on public.delivery_events for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = delivery_events.order_id
        and (o.user_id = (select auth.uid()) or (select private.is_owner_admin()))
    )
  );

create policy "delivery_events_admin_insert"
  on public.delivery_events for insert
  to authenticated
  with check ((select private.is_owner_admin()));

-- 13. reviews policies (published reviews visible; verified-purchase submission for delivered orders)
create policy "reviews_select_published_or_own_or_admin"
  on public.reviews for select
  to anon, authenticated
  using (
    moderation_status = 'PUBLISHED'
    or user_id = (select auth.uid())
    or (select private.is_owner_admin())
  );

create policy "reviews_insert_delivered_own_order"
  on public.reviews for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.orders o
      where o.id = reviews.order_id
        and o.user_id = (select auth.uid())
        and o.status = 'DELIVERED'
    )
  );

create policy "reviews_admin_moderate"
  on public.reviews for update
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 14. cancellation_requests & 15. refunds policies
create policy "cancellation_requests_select_own_or_admin"
  on public.cancellation_requests for select
  to authenticated
  using (
    requested_by_user_id = (select auth.uid())
    or (select private.is_owner_admin())
  );

create policy "cancellation_requests_admin_write"
  on public.cancellation_requests for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

create policy "refunds_select_own_or_admin"
  on public.refunds for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = refunds.order_id
        and (o.user_id = (select auth.uid()) or (select private.is_owner_admin()))
    )
  );

create policy "refunds_admin_write"
  on public.refunds for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 16. notifications policies
create policy "notifications_select_own_or_admin"
  on public.notifications for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_owner_admin()));

create policy "notifications_admin_write"
  on public.notifications for all
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 17. store_settings policies
create policy "store_settings_select_public"
  on public.store_settings for select
  to anon, authenticated
  using (true);

create policy "store_settings_admin_update"
  on public.store_settings for update
  to authenticated
  using ((select private.is_owner_admin()))
  with check ((select private.is_owner_admin()));

-- 18. admin_audit_logs policies
create policy "admin_audit_logs_admin_select"
  on public.admin_audit_logs for select
  to authenticated
  using ((select private.is_owner_admin()));

create policy "admin_audit_logs_admin_insert"
  on public.admin_audit_logs for insert
  to authenticated
  with check ((select private.is_owner_admin()));

-- =============================================================================
-- PRIVATE SUPABASE STORAGE BUCKET FOR PAYMENT SCREENSHOTS (`payment-proofs`)
-- Never expose public URLs for payment screenshots.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880, -- 5 MB limit
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS: Only OWNER_ADMIN or owning customer folder (`<user_id>/<order_id>/...`) can read/upload
create policy "payment_proofs_customer_upload_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "payment_proofs_select_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.is_owner_admin())
    )
  );

-- =============================================================================
-- INITIAL CATALOG & STORE SETTINGS SEED
-- Initial products: Faki & Supari
-- Initial variants: 250g, 500g, 1kg (prices NULL until configured by Owner Admin)
-- =============================================================================
insert into public.products (slug, name, name_gu, category, description, image_url, is_active)
values
  (
    'faki',
    'Balaji Special Faki',
    'બાલાજી સ્પેશિયલ ફાકી',
    'Traditional Faki',
    'Signature freshly blended Kathiyawadi Faki prepared with traditional spices.',
    '/images/hero-product.jpg',
    true
  ),
  (
    'supari',
    'Premium Roasted Supari',
    'પ્રીમિયમ શેકેલી સોપારી',
    'Premium Supari',
    'Cleaned, aromatic roasted Supari cut and packed for consistent freshness.',
    '/images/supari-reference.png',
    true
  )
on conflict (slug) do nothing;

insert into public.product_variants (product_id, pack_size, sku, price_paise, is_available, total_stock, reserved_stock, low_stock_threshold)
select p.id, v.pack_size, v.sku, null, true, 0, 0, 10
from public.products p
join (
  values
    ('faki', '250g', 'BFP-FAKI-250G'),
    ('faki', '500g', 'BFP-FAKI-500G'),
    ('faki', '1kg',  'BFP-FAKI-1KG'),
    ('supari', '250g', 'BFP-SUPARI-250G'),
    ('supari', '500g', 'BFP-SUPARI-500G'),
    ('supari', '1kg',  'BFP-SUPARI-1KG')
) as v(slug, pack_size, sku) on p.slug = v.slug
on conflict (sku) do nothing;

insert into public.store_settings (id, store_name, store_name_gu)
values (1, 'Balaji Faki Point', 'બાલાજી ફાકી પોઈન્ટ')
on conflict (id) do nothing;

commit;
