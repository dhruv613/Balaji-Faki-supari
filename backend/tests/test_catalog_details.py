"""Focused checks for public catalog details and temporary local prices."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from sqlalchemy import select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as db_session
from app.db.models import Customer, Order, OrderItem, Product, ProductVariant, StoreSettings, UserProfile
from app.db.seed import seed_development_data
from app.main import _serialize_customer_order, _serialize_store_profile, list_public_products


class CatalogDetailsTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)

    def test_public_catalog_keeps_admin_product_details_and_temporary_prices(self) -> None:
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            faki = db.scalar(select(Product).where(Product.slug == "faki"))
            assert faki is not None
            faki.description = "Store-confirmed packaging information."
            faki.ingredients = "Test-confirmed ingredients."
            faki.production_packaging = "Test-confirmed packaging."
            faki.safety_storage = "Test-confirmed storage guidance."
            db.commit()

            products = {product["type"]: product for product in list_public_products(db)}

        self.assertEqual(products["faki"]["prices"]["1kg"], 1000)
        self.assertEqual(products["supari"]["prices"]["1kg"], 800)
        self.assertEqual(products["faki"]["description"], "Store-confirmed packaging information.")
        self.assertEqual(products["faki"]["imageUrl"], "/images/hero-product.jpg")
        self.assertEqual(products["faki"]["information"]["ingredients"], "Test-confirmed ingredients.")
        self.assertEqual(products["faki"]["information"]["productionPackaging"], "Test-confirmed packaging.")
        self.assertEqual(products["faki"]["information"]["safetyStorage"], "Test-confirmed storage guidance.")
        self.assertEqual(products["faki"]["information"]["providerManufacturer"], "")

    def test_order_details_include_the_current_product_image(self) -> None:
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            product = db.scalar(select(Product).where(Product.slug == "faki"))
            variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-250G"))
            assert product is not None and variant is not None
            customer_user = UserProfile(email="customer@example.test", full_name="Customer")
            db.add(customer_user)
            db.flush()
            customer = Customer(user_id=customer_user.id, full_name="Customer", phone="+919876543210")
            db.add(customer)
            db.flush()
            order = Order(
                order_number="#BFP-IMAGE-TEST",
                user_id=customer_user.id,
                customer_id=customer.id,
                subtotal_paise=25000,
                delivery_fee_paise=0,
                total_paise=25000,
                shipping_name="Customer",
                shipping_phone="+919876543210",
                shipping_address="Rajkot, Gujarat",
                shipping_pin_code="360001",
            )
            db.add(order)
            db.flush()
            db.add(
                OrderItem(
                    order_id=order.id,
                    product_id=product.id,
                    variant_id=variant.id,
                    product_slug="faki",
                    product_name="Faki",
                    pack_size="250g",
                    quantity=1,
                    unit_price_paise=25000,
                    line_total_paise=25000,
                )
            )
            db.commit()

            payload = _serialize_customer_order(db, order, db.get(StoreSettings, 1))

        self.assertEqual(payload["productImageUrl"], "/images/hero-product.jpg")

    def test_public_store_profile_uses_settings_without_exposing_payment_destination(self) -> None:
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            store = db.get(StoreSettings, 1)
            assert store is not None
            store.store_name = "Confirmed Test Store"
            store.store_address = "Confirmed Test Address"
            store.upi_id = "private-payment-destination"
            db.commit()

            profile = _serialize_store_profile(store)

        self.assertEqual(profile["storeName"], "Confirmed Test Store")
        self.assertEqual(profile["storeAddress"], "Confirmed Test Address")
        self.assertNotIn("upiId", profile)
        self.assertNotIn("qrImageUrl", profile)


if __name__ == "__main__":
    unittest.main()
