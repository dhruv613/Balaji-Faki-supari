-- New orderable product: Tamaku (Gujarati: તમાકુ, tobacco), added at the end of the catalogue. Created WITHOUT prices or stock:
-- it cannot be ordered in production until the owner sets a price and stock in Price Management, which is also the moment to
-- confirm the legal requirements for selling tobacco online. Existing rows are never changed.
insert into public.products (slug, name, name_gu, category, description, image_url, is_active)
values ('tamaku', 'Tamaku', 'તમાકુ', 'Tobacco', '', '/images/products/balaji-tamaku-sachets.webp', true)
on conflict (slug) do nothing;

insert into public.product_variants (product_id, pack_size, sku, price_paise, is_available, total_stock, reserved_stock, low_stock_threshold)
select p.id, v.pack_size, v.sku, null, true, 0, 0, 10
from public.products p
join (
  values
    ('tamaku', '250g', 'BFP-TAMAKU-250G'),
    ('tamaku', '500g', 'BFP-TAMAKU-500G'),
    ('tamaku', '1kg',  'BFP-TAMAKU-1KG')
) as v(slug, pack_size, sku) on p.slug = v.slug
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text, position)
select p.id, v.storage_path, v.alt_text, v.position
from public.products p
join (
  values
    ('tamaku', '/images/products/balaji-tamaku-sachets.webp', 'Balaji Faki Point orange parcel sachets', 0),
    ('tamaku', '/images/products/balaji-tamaku-banner.jpg',   'Tamaku parcel banner with a single sachet', 1)
) as v(slug, storage_path, alt_text, position) on p.slug = v.slug
where not exists (select 1 from public.product_images pi where pi.product_id = p.id)
on conflict do nothing;
