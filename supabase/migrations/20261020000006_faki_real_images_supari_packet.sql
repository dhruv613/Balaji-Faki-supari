-- Product photo fix-up.
-- 1) The two arecanut packet photographs (front/back, printed "Soft Cucing of Dry Arecanut") were attached to Faki by
--    mistake: they belong to Supari. They move to the end of Supari's gallery (its existing bowl photo stays first).
-- 2) Faki gets its real photographs: the tied sachet bundle first, then the box, then the promotional banner last.
-- Only touches rows created by the earlier packet-image migration; a gallery the owner has changed is never replaced.
do $$
declare
  faki_id uuid;
  supari_id uuid;
  r record;
  pos int;
begin
  select id into faki_id from public.products where slug = 'faki';
  select id into supari_id from public.products where slug = 'supari';
  if faki_id is null or supari_id is null then
    return;
  end if;

  if not exists (select 1 from public.product_images where product_id = supari_id) then
    insert into public.product_images (product_id, storage_path, alt_text, position)
    values (supari_id, '/images/supari-reference.png', 'Bowl of sliced supari', 0);
  end if;

  for r in
    select id, storage_path from public.product_images
     where product_id = faki_id
       and storage_path in ('/images/products/balaji-faki-packet-front.webp', '/images/products/balaji-faki-packet-back.webp')
     order by position
  loop
    select coalesce(max(position), -1) + 1 into pos from public.product_images where product_id = supari_id;
    update public.product_images
       set product_id = supari_id,
           position = pos,
           storage_path = replace(r.storage_path, 'balaji-faki-packet', 'balaji-supari-packet'),
           alt_text = case when r.storage_path like '%front%' then 'Supari packet, front' else 'Supari packet, back' end
     where id = r.id;
  end loop;

  if not exists (select 1 from public.product_images where product_id = faki_id) then
    insert into public.product_images (product_id, storage_path, alt_text, position) values
      (faki_id, '/images/products/balaji-faki-bundle.jpg', 'Faki sachets tied in a bundle', 0),
      (faki_id, '/images/products/balaji-faki-box.webp', 'Balaji Faki Point box', 1),
      (faki_id, '/images/products/balaji-faki-banner.jpg', 'Balaji Faki Point promotional banner', 2);
  end if;

  update public.products
     set image_url = '/images/products/balaji-faki-bundle.jpg'
   where id = faki_id
     and image_url in ('/images/products/balaji-faki-packet-front.webp', '/images/hero-product.jpg');
end $$;
