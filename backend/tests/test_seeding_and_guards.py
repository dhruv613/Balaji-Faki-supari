"""WP3 regression checks: no request-time seeding, explicit dev seed rules, PIN parsing, fail-closed signing."""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import func, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as db_session
from app.core import storage
from app.core.config import settings
from app.db.models import Product, ProductVariant, StoreSettings
from app.db.seed import seed_development_data
from app.main import _assert_ordering_open, _serviceable_pins, create_checkout_quote, get_public_store_profile, list_public_products
from app.schemas import CheckoutQuoteRequestSchema


def _count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


class NoRequestTimeSeedingTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)

    def test_public_reads_on_empty_database_create_nothing(self) -> None:
        with db_session.SessionLocal() as db:
            self.assertEqual(list_public_products(db), [])
            with self.assertRaises(HTTPException) as quote_error:
                create_checkout_quote(
                    CheckoutQuoteRequestSchema(product="faki", packSize="1kg", quantity=1, pinCode="360005"), db
                )
            self.assertEqual(quote_error.exception.status_code, 503)  # store settings not initialised
            with self.assertRaises(HTTPException) as store_error:
                get_public_store_profile(db)
            self.assertEqual(store_error.exception.status_code, 503)
            self.assertEqual(_count(db, Product), 0)
            self.assertEqual(_count(db, ProductVariant), 0)
            self.assertEqual(_count(db, StoreSettings), 0)

    def test_dev_seed_marks_only_faki_1kg_as_confirmed_and_never_restores_prices(self) -> None:
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            confirmed = {
                v.sku: v.price_confirmed for v in db.scalars(select(ProductVariant)).all()
            }
            self.assertEqual([sku for sku, ok in confirmed.items() if ok], ["BFP-FAKI-1KG"])
            faki_1kg = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-1KG"))
            self.assertEqual(faki_1kg.price_paise, 100000)

            # Admin clears a price and changes stock; re-running the seed must not restore either.
            other = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-250G"))
            other.price_paise = None
            other.total_stock = 3
            db.commit()
            seed_development_data(db)
            db.refresh(other)
            self.assertIsNone(other.price_paise)
            self.assertEqual(other.total_stock, 3)

            # Payment details are explicit LOCAL TEST values, not a real receiving account.
            store = db.get(StoreSettings, 1)
            self.assertIn("LOCAL TEST", store.upi_payee_name)
            self.assertIsNone(store.support_email)
            self.assertIsNone(store.business_settings_confirmed_at)


class GuardTests(unittest.TestCase):
    def test_pin_codes_accept_list_and_legacy_text(self) -> None:
        store = StoreSettings(serviceable_pin_codes=["360005", 360001])
        self.assertEqual(_serviceable_pins(store), ["360005", "360001"])
        store.serviceable_pin_codes = '["360002"]'
        self.assertEqual(_serviceable_pins(store), ["360002"])
        store.serviceable_pin_codes = "not json"
        self.assertEqual(_serviceable_pins(store), [])

    def test_ordering_guard_applies_outside_local_mode_only(self) -> None:
        variant = ProductVariant(pack_size="1kg", sku="X", price_paise=100000, price_confirmed=False)
        store = StoreSettings(business_settings_confirmed_at=None)
        # Local mode (tests run with BFP_ENV=local or default production): evaluate both explicitly.
        import app.main as main_module

        original = main_module.settings
        try:
            main_module.settings = replace(original, app_env="local")
            _assert_ordering_open(variant, store)  # allowed locally
            main_module.settings = replace(original, app_env="production")
            with self.assertRaises(HTTPException) as blocked:
                _assert_ordering_open(variant, store)
            self.assertEqual(blocked.exception.status_code, 503)
        finally:
            main_module.settings = original

    def test_signing_secret_never_falls_back_to_a_fixed_string(self) -> None:
        empty = replace(
            settings, proof_signing_secret="", supabase_jwt_secret="", supabase_secret_key="", app_env="production"
        )
        with self.assertRaises(storage.PrivateImageStorageError):
            storage.create_signed_proof_query("pay-1", "u/o/p.png", app_settings=empty)

        local = replace(empty, app_env="local")
        sig, exp = storage.create_signed_proof_query("pay-1", "u/o/p.png", app_settings=local)
        self.assertTrue(storage.verify_signed_proof_query("pay-1", "u/o/p.png", sig=sig, exp=exp, app_settings=local))
        self.assertFalse(storage.verify_signed_proof_query("pay-2", "u/o/p.png", sig=sig, exp=exp, app_settings=local))

        configured = replace(empty, proof_signing_secret="a-dedicated-test-secret-0123456789")
        sig2, exp2 = storage.create_signed_proof_query("pay-1", "u/o/p.png", app_settings=configured)
        self.assertTrue(
            storage.verify_signed_proof_query("pay-1", "u/o/p.png", sig=sig2, exp=exp2, app_settings=configured)
        )
        self.assertFalse(
            storage.verify_signed_proof_query("pay-1", "u/o/p.png", sig=sig, exp=exp, app_settings=configured)
        )


if __name__ == "__main__":
    unittest.main()
