"""Safety checks for the explicit Neon provisioning command and standalone baseline."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = spec_from_file_location("setup_neon_db", ROOT / "scripts/setup-neon-db.py")
setup = module_from_spec(spec)
spec.loader.exec_module(setup)


class NeonSchemaTests(unittest.TestCase):
    def test_migrations_require_a_direct_neon_database(self):
        valid = "postgresql://app:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require"
        self.assertEqual(setup.direct_neon_url(valid), valid)
        for value in ("", "sqlite:///:memory:", valid.replace("ep-example.", "ep-example-pooler."), valid.replace("neon.tech", "example.com"), valid.replace(":secret", "")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                setup.direct_neon_url(value)

    def test_baseline_preserves_business_guards_without_supabase_services(self):
        sql = (ROOT / "backend/migrations/neon/001_schema.sql").read_text(encoding="utf-8")
        for guard in ("orders_confirmed_requires_verified_payment", "product_variants_non_negative_available", "refunds_completed_requires_bank_verification", "payment_attempts_verified_utr_unique_idx", "reviews_hidden_requires_reason", "private.set_updated_at()", "review_photos", "product_images", "business_settings_confirmed_at", "'ORDER_CANCELLED'", "'REFUND_COMPLETED'"):
            self.assertIn(guard, sql)
        for forbidden in ("references auth.", "auth.uid()", "storage.buckets", "password_hash", "grant all", "bypassrls"):
            self.assertNotIn(forbidden, sql.lower())
        self.assertEqual(sql.count("enable row level security"), 21)

    def test_catalogue_does_not_invent_prices_stock_or_accounts(self):
        sql = (ROOT / "backend/migrations/neon/002_catalog.sql").read_text(encoding="utf-8")
        self.assertEqual(sql.count("insert into public.products "), 6)
        self.assertNotIn("price_paise", sql)
        self.assertNotIn("total_stock", sql)
        self.assertNotIn("user_profiles", sql)
        self.assertNotIn("upi_id", sql)

    def test_saved_addresses_are_private_and_additive(self):
        sql = (ROOT / "backend/migrations/neon/007_customer_addresses.sql").read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists public.customer_addresses", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("revoke all on table public.customer_addresses from public", sql)
        self.assertNotIn("delete from", sql)


if __name__ == "__main__":
    unittest.main()
