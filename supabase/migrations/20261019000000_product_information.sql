-- Store-confirmed product facts are optional until an Owner Admin supplies them.
-- They use the existing products RLS policies; no new public write surface is added.
alter table public.products
  add column if not exists ingredients text,
  add column if not exists popularity text,
  add column if not exists characteristics text,
  add column if not exists production_packaging text,
  add column if not exists provider_manufacturer text,
  add column if not exists safety_storage text;
