-- Faki photo order (owner request): the box photo now comes first (it is also the card image), the tied sachet bundle second,
-- the promotional banner stays last. Only applies if the gallery is still exactly as the previous migration left it.
do $$
declare
  faki_id uuid;
  free_slot int;
  bundle constant text := '/images/products/balaji-faki-bundle.jpg';
  box constant text := '/images/products/balaji-faki-box.webp';
begin
  select id into faki_id from public.products where slug = 'faki';
  if faki_id is null then
    return;
  end if;
  if exists (select 1 from public.product_images where product_id = faki_id and position = 0 and storage_path = bundle)
     and exists (select 1 from public.product_images where product_id = faki_id and position = 1 and storage_path = box) then
    -- (product_id, position) is unique per row and positions are limited to 0-9, so move through a free slot
    select min(g) into free_slot from generate_series(0, 9) g
     where not exists (select 1 from public.product_images where product_id = faki_id and position = g);
    if free_slot is not null then
      update public.product_images set position = free_slot where product_id = faki_id and storage_path = bundle;
      update public.product_images set position = 0 where product_id = faki_id and storage_path = box;
      update public.product_images set position = 1 where product_id = faki_id and storage_path = bundle;
      update public.products set image_url = box where id = faki_id and image_url = bundle;
    end if;
  end if;
end $$;
