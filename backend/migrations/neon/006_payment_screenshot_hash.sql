-- 006: SHA-256 of each uploaded payment screenshot, used only to warn the admin about an identical file.
-- Additive and re-runnable. Nullable on purpose: attempts made before this migration stay NULL ("not recorded"),
-- which is never treated as a match. The index is deliberately NOT unique: the same file may legitimately be
-- sent again (for example after a rejection), and a match is a warning, never a block.
alter table public.payment_attempts
  add column if not exists screenshot_sha256 text
  check (screenshot_sha256 is null or screenshot_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists payment_attempts_screenshot_sha256_idx
  on public.payment_attempts (screenshot_sha256);
