-- Two more orderable products: Mitho Mavo (No Tobacco Faki / Sadi Faki) and Water Bottle.
-- 1) The catalogue is no longer limited to faki/supari or to gram weights: slugs and pack sizes become validated formats
--    (250g, 1kg, 500ml, 1l ...), so each product carries its own pack sizes.
-- 2) The new products are created WITHOUT prices or stock: nothing is orderable until the owner sets a price and stock in
--    Price Management (prices are never fabricated; development placeholders come only from the explicit dev seed).
-- Existing rows are never changed.

alter table public.products drop constraint if exists products_slug_check;
alter table public.products add constraint products_slug_check check (slug ~ '^[a-z0-9-]{1,32}$');

alter table public.product_variants drop constraint if exists product_variants_pack_size_check;
alter table public.product_variants
  add constraint product_variants_pack_size_check check (pack_size ~ '^[0-9]{1,4}(g|kg|ml|l)$');

alter table public.order_items drop constraint if exists order_items_product_slug_check;
alter table public.order_items add constraint order_items_product_slug_check check (product_slug ~ '^[a-z0-9-]{1,32}$');

alter table public.order_items drop constraint if exists order_items_pack_size_check;
alter table public.order_items
  add constraint order_items_pack_size_check check (pack_size ~ '^[0-9]{1,4}(g|kg|ml|l)$');

insert into public.products (slug, name, name_gu, category, description, image_url, is_active)
values
  ('mitho-mavo', 'Mitho Mavo', 'મીઠો માવો', 'Faki', 'No Tobacco Faki (Sadi Faki)',
   '/images/products/balaji-mitho-mavo-sachet.webp', true),
  ('water', 'Water Bottle', 'પાણીની બોટલ', 'Water', '',
   '/images/products/balaji-water-bottle.webp', true)
on conflict (slug) do nothing;

insert into public.product_variants (product_id, pack_size, sku, price_paise, is_available, total_stock, reserved_stock, low_stock_threshold)
select p.id, v.pack_size, v.sku, null, true, 0, 0, 10
from public.products p
join (
  values
    ('mitho-mavo', '250g', 'BFP-MITHO-MAVO-250G'),
    ('mitho-mavo', '500g', 'BFP-MITHO-MAVO-500G'),
    ('mitho-mavo', '1kg',  'BFP-MITHO-MAVO-1KG'),
    ('water', '1l', 'BFP-WATER-1L')
) as v(slug, pack_size, sku) on p.slug = v.slug
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text, position)
select p.id, v.storage_path, v.alt_text, v.position
from public.products p
join (
  values
    ('mitho-mavo', '/images/products/balaji-mitho-mavo-sachet.webp',  'Mitho Mavo sachet with the mavo mixture', 0),
    ('mitho-mavo', '/images/products/balaji-mitho-mavo-sachets.webp', 'Two Mitho Mavo sachets with the mavo mixture', 1),
    ('water',      '/images/products/balaji-water-bottle.webp',       'Balaji Faki Point water bottle', 0),
    ('water',      '/images/products/balaji-water-label.jpg',         'Water bottle label artwork', 1)
) as v(slug, storage_path, alt_text, position) on p.slug = v.slug
where not exists (select 1 from public.product_images pi where pi.product_id = p.id)
on conflict do nothing;
