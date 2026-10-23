-- Saved delivery addresses added by a signed-in customer. Historical order addresses remain in orders.
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  address text not null check (char_length(btrim(address)) between 10 and 500),
  pin_code text not null check (pin_code ~ '^[1-9][0-9]{5}$'),
  created_at timestamptz not null default now(),
  unique (user_id, address, pin_code)
);

create index if not exists customer_addresses_user_id_idx on public.customer_addresses (user_id);
alter table public.customer_addresses enable row level security;
revoke all on table public.customer_addresses from public;
