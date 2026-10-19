"""Admin order list: one response with items and payment details, server-side search, filters and paging."""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session
import app.main as main_module
from app.core.security import AuthenticatedPrincipal
from app.db.models import Customer, Order, OrderItem, ProductVariant, UserProfile
from app.db.seed import seed_development_data


class AdminOrdersListTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer")
            db.add_all([owner, buyer])
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
            db.add(customer)
            db.flush()
            variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-1KG"))
            for index, (name, status, day) in enumerate(
                [("Hetal Patel", "PAYMENT_REVIEW", 17), ("Rahul Mehta", "DELIVERED", 18), ("Priya Shah", "PAYMENT_REVIEW", 19)]
            ):
                order = Order(
                    order_number=f"#BFP-{2000 + index}", user_id=buyer.id, customer_id=customer.id, status=status,
                    payment_status="UNDER_REVIEW" if status == "PAYMENT_REVIEW" else "VERIFIED",
                    total_paise=100000, subtotal_paise=100000, delivery_fee_paise=0, shipping_name=name,
                    shipping_phone="+919825000000", shipping_address="Rajkot", shipping_area="Rajkot", shipping_pin_code="360005",
                    created_at=datetime(2026, 10, day, 9, 0, tzinfo=timezone.utc),
                )
                db.add(order)
                db.flush()
                db.add(OrderItem(
                    order_id=order.id, product_id=variant.product_id, variant_id=variant.id, product_slug="faki",
                    product_name="Faki", pack_size="1kg", quantity=1, unit_price_paise=100000, line_total_paise=100000,
                ))
            db.commit()
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)

    def listing(self, db, **kwargs):
        args = dict(status=None, payment_status=None, search=None, date_from=None, date_to=None, page=1, page_size=50)
        args.update(kwargs)
        return main_module.list_admin_orders(_admin=self.admin, db=db, **args)

    def test_each_row_carries_items_payment_and_timeline_in_one_response(self) -> None:
        with db_session.SessionLocal() as db:
            result = self.listing(db)
            self.assertEqual(result["total"], 3)
            self.assertEqual([o["orderNumber"] for o in result["items"]], ["#BFP-2002", "#BFP-2001", "#BFP-2000"])  # newest first
            first = result["items"][0]
            for key in ("items", "paymentDetails", "timeline", "address", "orderStatus", "paymentStatus", "itemsSummary"):
                self.assertIn(key, first)
            self.assertEqual(first["items"][0]["quantity"], 1)

    def test_filters_search_dates_and_paging_run_on_the_server(self) -> None:
        with db_session.SessionLocal() as db:
            self.assertEqual(self.listing(db, status="PAYMENT_REVIEW")["total"], 2)
            self.assertEqual(self.listing(db, payment_status="VERIFIED")["total"], 1)
            self.assertEqual(self.listing(db, search="rahul")["items"][0]["customerName"], "Rahul Mehta")
            self.assertEqual(self.listing(db, search="#bfp-2002")["total"], 1)
            self.assertEqual(self.listing(db, search="nobody")["total"], 0)
            self.assertEqual(self.listing(db, date_from="2026-10-18", date_to="2026-10-18")["total"], 1)
            self.assertEqual(self.listing(db, date_from="2026-10-18")["total"], 2)
            paged = self.listing(db, page=2, page_size=2)
            self.assertEqual((paged["total"], len(paged["items"]), paged["totalPages"]), (3, 1, 2))
            self.assertEqual(paged["items"][0]["orderNumber"], "#BFP-2000")


if __name__ == "__main__":
    unittest.main()
