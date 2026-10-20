-- Typed amounts: weight products can be ordered in any amount from 100 g to 10 kg (steps of 50 g) at a per-kg price
-- the owner sets. They are not stocked packs, so their order lines have no variant and reserve/deduct no stock.
alter table public.products
  add column if not exists price_per_kg_paise bigint check (price_per_kg_paise is null or price_per_kg_paise > 0),
  add column if not exists cost_per_kg_paise bigint check (cost_per_kg_paise is null or cost_per_kg_paise >= 0);

alter table public.order_items alter column variant_id drop not null;
