-- 002_catalog.sql inserted the six products in one statement, so they share created_at and the catalogue
-- (ordered by created_at, then slug) fell back to alphabetical. Restore the intended queue:
-- Faki, Supari, Mitho Mavo, Water, Chuno, Tamaku. Products added later by the owner still follow them.
update public.products as p
set created_at = base.first_created + q.position * interval '1 second'
from (select min(created_at) as first_created from public.products
      where slug in ('faki', 'supari', 'mitho-mavo', 'water', 'chuno', 'tamaku')) as base,
     (values ('faki', 0), ('supari', 1), ('mitho-mavo', 2), ('water', 3), ('chuno', 4), ('tamaku', 5)) as q(slug, position)
where p.slug = q.slug;
