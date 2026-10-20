"""Typed amounts: weight products ordered in any amount from 100 g to 10 kg (50 g steps), priced per kg, no stock."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.models import Order, OrderItem, Product, ProductVariant, UserProfile  # noqa: E402
from app.db.seed import seed_development_data  # noqa: E402
from app.routes.admin_catalog import update_admin_product  # noqa: E402
from app.routes.admin_orders import confirm_admin_order  # noqa: E402
from app.routes.common import _per_kg_price_paise  # noqa: E402
from app.routes.orders import cancel_customer_order, create_customer_order  # noqa: E402
from app.routes.public import create_checkout_quote, get_public_product  # noqa: E402
from app.schemas import (  # noqa: E402
    CancelOrderRequestSchema, CheckoutQuoteRequestSchema, ConfirmOrderRequestSchema, CreateOrderRequestSchema,
    UpdateAdminProductRequestSchema,
)

PIN = "360005"


class TypedAmountTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer", role="CUSTOMER")
            db.add_all([owner, buyer])
            db.commit()
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)
            self.buyer = AuthenticatedPrincipal(buyer.id, buyer.email, buyer.full_name, "", "CUSTOMER", True)

    def set_per_kg(self, db, slug: str, **body):
        return update_admin_product(slug, UpdateAdminProductRequestSchema.model_validate(body), self.admin, db)

    def quote(self, db, amount: str, product: str = "faki", quantity: int = 1):
        body = {"product": product, "packSize": amount, "customAmount": True, "quantity": quantity, "pinCode": PIN}
        return create_checkout_quote(CheckoutQuoteRequestSchema.model_validate(body), db)

    def test_price_is_amount_times_rate_rounded_half_up_to_a_rupee(self) -> None:
        self.assertEqual(_per_kg_price_paise(80_000, 750), 60_000)       # Rs 800/kg x 750 g = Rs 600
        self.assertEqual(_per_kg_price_paise(33_300, 150), 5_000)        # Rs 49.95 -> Rs 50
        self.assertEqual(_per_kg_price_paise(33_000, 150), 5_000)        # Rs 49.50 -> Rs 50 (half up)
        self.assertEqual(_per_kg_price_paise(32_900, 150), 4_900)        # Rs 49.35 -> Rs 49

    def test_typed_amounts_need_a_per_kg_price_and_a_weight_product(self) -> None:
        with db_session.SessionLocal() as db:
            with self.assertRaises(HTTPException) as refused:
                self.quote(db, "750g")
            self.assertEqual(refused.exception.status_code, 400)
            self.assertIsNone(get_public_product("faki", db)["pricePerKg"])
            with self.assertRaises(HTTPException) as water:
                self.set_per_kg(db, "water", pricePerKg=20)
            self.assertEqual(water.exception.status_code, 422, "water is sold in fixed bottles, not by weight")
            admin_view = self.set_per_kg(db, "faki", pricePerKg=800, costPerKg=560)
            self.assertEqual((admin_view["pricePerKg"], admin_view["costPerKg"], admin_view["soldByWeight"]), (800, 560, True))
            self.assertEqual(get_public_product("faki", db)["pricePerKg"], 800)
            self.set_per_kg(db, "faki", pricePerKg=None)
            self.assertIsNone(get_public_product("faki", db)["pricePerKg"], "null switches typed amounts off")

    def test_amount_limits_and_quote(self) -> None:
        with db_session.SessionLocal() as db:
            self.set_per_kg(db, "faki", pricePerKg=800)
            self.assertEqual(self.quote(db, "750g")["subtotal"], 600)
            self.assertEqual(self.quote(db, "2500g", quantity=2)["subtotal"], 4000)
            self.assertEqual(self.quote(db, "10kg")["subtotal"], 8000)
            self.assertEqual(self.quote(db, "100g")["subtotal"], 80)
            for amount in ("50g", "125g", "11kg", "0g"):
                with self.subTest(amount=amount):
                    with self.assertRaises(HTTPException) as bad:
                        self.quote(db, amount)
                    self.assertEqual(bad.exception.status_code, 422)
            with self.assertRaises(ValidationError):  # more than 4 digits never reaches the handler (HTTP 422)
                self.quote(db, "10050g")

    def test_typed_order_holds_no_stock_and_confirms_and_cancels_cleanly(self) -> None:
        with db_session.SessionLocal() as db:
            self.set_per_kg(db, "faki", pricePerKg=800, costPerKg=560)
            stock_before = {(v.pack_size, v.total_stock, v.reserved_stock) for v in db.scalars(select(ProductVariant))}
            body = {"product": "faki", "packSize": "1kg", "customAmount": True, "quantity": 1, "fullName": "Buyer Name",
                    "phone": "9876543210", "address": "12 Test Society, University Road, Rajkot", "pinCode": PIN}
            order = create_customer_order(CreateOrderRequestSchema.model_validate(body), None, self.buyer, db)
            self.assertEqual(order["subtotal"], 800, "a typed 1 kg uses the per-kg rate, not the 1 kg pack price")
            item = db.scalar(select(OrderItem).where(OrderItem.order_id == order["id"]))
            self.assertEqual((item.variant_id, item.pack_size, item.unit_price_paise, item.unit_cost_paise), (None, "1kg", 80_000, 56_000))
            self.assertEqual({(v.pack_size, v.total_stock, v.reserved_stock) for v in db.scalars(select(ProductVariant))}, stock_before)

            stored = db.get(Order, order["id"])
            stored.payment_status = "VERIFIED"
            stored.status = "AWAITING_CONFIRMATION"
            db.commit()
            confirm_admin_order(order["id"], ConfirmOrderRequestSchema.model_validate({}), None, self.admin, db)
            db.expire_all()
            self.assertEqual(db.get(Order, order["id"]).status, "CONFIRMED")
            self.assertEqual({(v.pack_size, v.total_stock, v.reserved_stock) for v in db.scalars(select(ProductVariant))}, stock_before)

            second = create_customer_order(CreateOrderRequestSchema.model_validate({**body, "packSize": "750g"}), None, self.buyer, db)
            cancelled = cancel_customer_order(second["id"], CancelOrderRequestSchema(reason="Changed my mind"), self.buyer, db)
            self.assertEqual(cancelled["status"], "CANCELLED")
            self.assertEqual({(v.pack_size, v.total_stock, v.reserved_stock) for v in db.scalars(select(ProductVariant))}, stock_before)

    def test_packs_still_use_their_own_price_and_stock(self) -> None:
        with db_session.SessionLocal() as db:
            self.set_per_kg(db, "faki", pricePerKg=800)
            pack = db.scalar(select(ProductVariant).join(Product).where(Product.slug == "faki", ProductVariant.pack_size == "1kg"))
            body = {"product": "faki", "packSize": "1kg", "quantity": 1, "pinCode": PIN}
            quote = create_checkout_quote(CheckoutQuoteRequestSchema.model_validate(body), db)
            self.assertEqual(quote["subtotal"] * 100, pack.price_paise)


if __name__ == "__main__":
    unittest.main()
