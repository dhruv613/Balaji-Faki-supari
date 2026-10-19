-- Real Faki packet photographs (bundled frontend assets under /images/products/). Local data fix-up that is safe to run
-- anywhere: it only touches the Faki product, never overwrites an image the owner has already set, and does not
-- assume a pack weight for the photographed packet.

update public.products
   set image_url = '/images/products/balaji-faki-packet-front.webp'
 where slug = 'faki' and image_url = '/images/hero-product.jpg';

insert into public.product_images (product_id, storage_path, alt_text, position)
select p.id, v.storage_path, v.alt_text, v.position
  from public.products p
  cross join (values
    ('/images/products/balaji-faki-packet-front.webp', 'Faki packet, front', 0),
    ('/images/products/balaji-faki-packet-back.webp',  'Faki packet, back',  1)
  ) as v(storage_path, alt_text, position)
 where p.slug = 'faki'
   and not exists (select 1 from public.product_images pi where pi.product_id = p.id)
on conflict do nothing;
