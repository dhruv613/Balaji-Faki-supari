-- Customer review photos remain private in Storage. FastAPI authorizes every image read.

create table if not exists public.review_photos (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  position smallint not null check (position between 0 and 4),
  created_at timestamptz not null default now(),
  unique (review_id, position)
);

create index if not exists review_photos_review_position_idx
  on public.review_photos (review_id, position asc);

alter table public.review_photos enable row level security;

revoke all on table public.review_photos from anon, authenticated;
grant select on table public.review_photos to authenticated;

drop policy if exists "review_photos_select_owner_or_admin" on public.review_photos;
create policy "review_photos_select_owner_or_admin"
  on public.review_photos for select
  to authenticated
  using (
    exists (
      select 1
      from public.reviews r
      where r.id = review_photos.review_id
        and (r.user_id = (select auth.uid()) or (select private.is_owner_admin()))
    )
  );

-- No authenticated Storage object policies are created for this bucket: FastAPI's
-- server-only credential stores and reads these private images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-photos',
  'review-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
