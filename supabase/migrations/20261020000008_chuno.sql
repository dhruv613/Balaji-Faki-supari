-- New orderable product: Chuno (Gujarati: ચુનો). Created WITHOUT prices or stock: it cannot be ordered in production until
-- the owner sets a price and stock in Price Management (prices are never fabricated). Existing rows are never changed.
insert into public.products (slug, name, name_gu, category, description, image_url, is_active)
values ('chuno', 'Chuno', 'ચુનો', 'Chuno', '', '/images/products/balaji-chuno-sachets.webp', true)
on conflict (slug) do nothing;

insert into public.product_variants (product_id, pack_size, sku, price_paise, is_available, total_stock, reserved_stock, low_stock_threshold)
select p.id, v.pack_size, v.sku, null, true, 0, 0, 10
from public.products p
join (
  values
    ('chuno', '250g', 'BFP-CHUNO-250G'),
    ('chuno', '500g', 'BFP-CHUNO-500G'),
    ('chuno', '1kg',  'BFP-CHUNO-1KG')
) as v(slug, pack_size, sku) on p.slug = v.slug
on conflict (sku) do nothing;

insert into public.product_images (product_id, storage_path, alt_text, position)
select p.id, v.storage_path, v.alt_text, v.position
from public.products p
join (
  values
    ('chuno', '/images/products/balaji-chuno-sachets.webp',        'Balaji Chuno sachets', 0),
    ('chuno', '/images/products/balaji-chuno-banner-parcel.jpg',   'Chuno parcel banner with a pile of sachets', 1),
    ('chuno', '/images/products/balaji-chuno-banner-sachet.jpg',   'Chuno parcel banner with a single sachet', 2)
) as v(slug, storage_path, alt_text, position) on p.slug = v.slug
where not exists (select 1 from public.product_images pi where pi.product_id = p.id)
on conflict do nothing;
