-- Owner decision: a payment is approved from the customer's uploaded screenshot alone.
-- The customer no longer types a UTR and the owner no longer records bank-credit details, so the UTR columns become
-- optional. Existing rows, the bank_credits table and its policies are left untouched (historical data, no drops).

alter table public.payment_attempts alter column submitted_utr drop not null;
alter table public.refunds alter column original_payment_utr drop not null;
