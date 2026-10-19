-- Catalogue and shop content (forward-only). Owner-supplied facts stay NULL until entered in admin.
-- STATUS: written 2026-10-19; NOT yet verified against local PostgreSQL.
begin;

-- 1. Product facts: add the missing owner-editable fields. `production_packaging` is now labelled
--    "Preparation / production" and `safety_storage` "Storage" in the UI; no data is moved or lost.
alter table public.products
  add column if not exists shelf_life text,
  add column if not exists packaging text,
  add column if not exists safety_disclosures text;

-- 2. Remove marketing copy that earlier seed data invented, only where it is still untouched.
update public.products
set name = 'Faki', name_gu = 'ફાકી', category = 'Faki', description = ''
where slug = 'faki'
  and description = 'Signature freshly blended Kathiyawadi Faki prepared with traditional spices.';
update public.products
set name = 'Supari', name_gu = 'સુપારી', category = 'Supari', description = ''
where slug = 'supari'
  and description = 'Cleaned, aromatic roasted Supari cut and packed for consistent freshness.';

-- 3. Price approval flag: a price is "development data" until the owner confirms it.
alter table public.product_variants
  add column if not exists price_confirmed boolean not null default false;

-- 4. Product images (public catalogue assets; writes only through FastAPI with the server credential).
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique,
  alt_text text not null default '',
  position smallint not null default 0 check (position between 0 and 9),
  created_at timestamptz not null default now(),
  unique (product_id, position)
);
create index if not exists product_images_product_position_idx on public.product_images (product_id, position);
alter table public.product_images enable row level security;
drop policy if exists "product_images_public_select" on public.product_images;
create policy "product_images_public_select"
  on public.product_images for select
  to anon, authenticated
  using (true); -- intentionally public catalogue content

-- 5. Shop content.
alter table public.store_settings
  add column if not exists shop_intro text,
  add column if not exists production_info text,
  add column if not exists provider_manufacturer text,
  add column if not exists packaging_info text,
  add column if not exists business_settings_confirmed_at timestamptz,
  add column if not exists business_settings_confirmed_by uuid references public.user_profiles(id) on delete set null;

-- Earlier defaults contained values nobody confirmed. Make the columns optional and clear untouched defaults.
alter table public.store_settings alter column support_email drop not null;
alter table public.store_settings alter column support_email drop default;
update public.store_settings set support_email = null where support_email = 'support@balajifakipoint.com';
update public.store_settings set opening_hours = 'Call the store to confirm opening hours' where opening_hours = '9:00 AM – 9:00 PM';

create index if not exists store_settings_confirmed_by_idx on public.store_settings (business_settings_confirmed_by);

create table if not exists public.store_photos (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  caption text not null default '',
  position smallint not null default 0 check (position between 0 and 19),
  created_at timestamptz not null default now(),
  unique (position)
);
alter table public.store_photos enable row level security;
drop policy if exists "store_photos_public_select" on public.store_photos;
create policy "store_photos_public_select"
  on public.store_photos for select
  to anon, authenticated
  using (true); -- intentionally public shop content

-- 6. Review moderation: `moderation_reason` already exists; keep it mandatory for HIDDEN reviews.
alter table public.reviews drop constraint if exists reviews_hidden_requires_reason;
alter table public.reviews
  add constraint reviews_hidden_requires_reason check (
    moderation_status <> 'HIDDEN' or char_length(trim(coalesce(moderation_reason, ''))) >= 3
  ) not valid; -- NOT VALID: historic rows are not re-checked; new and updated rows are.

-- 7. Buckets. Catalogue/shop images are public-read; QR codes, review photos and payment proofs are private.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('store-photos', 'store-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('payment-qr', 'payment-qr', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;
