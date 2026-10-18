"""Focused persistence checks for verified-purchase review submission and moderation."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as db_session  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.models import AdminAuditLog, Customer, Order, OrderItem, Product, ProductVariant, UserProfile  # noqa: E402
from app.main import list_published_reviews, submit_customer_review, update_admin_review  # noqa: E402
from app.schemas import SubmitReviewRequestSchema, UpdateAdminReviewRequestSchema  # noqa: E402


class ReviewServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        db_session.configure_database("sqlite:///:memory:")

    def setUp(self) -> None:
        from app.db.models import Base

        Base.metadata.drop_all(bind=db_session.engine)
        Base.metadata.create_all(bind=db_session.engine)

    def test_only_delivered_order_can_submit_then_owner_admin_can_publish(self) -> None:
        with db_session.SessionLocal() as db:
            admin = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Hetal Patel", role="CUSTOMER")
            product = Product(slug="faki-test", name="Faki", category="Faki")
            db.add_all([admin, buyer, product])
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Hetal Patel", phone="+919876543210")
            variant = ProductVariant(product_id=product.id, pack_size="500g", sku="FAKI-REVIEW-TEST", price_paise=50000)
            db.add_all([customer, variant])
            db.flush()
            order = Order(
                order_number="#BFP-REVIEW-TEST",
                user_id=buyer.id,
                customer_id=customer.id,
                status="DELIVERED",
                payment_status="VERIFIED",
                total_paise=50000,
                subtotal_paise=50000,
                delivery_fee_paise=0,
                shipping_name="Hetal Patel",
                shipping_phone="+919876543210",
                shipping_address="Rajkot, Gujarat",
                shipping_area="Rajkot",
                shipping_pin_code="360001",
            )
            db.add(order)
            db.flush()
            db.add(OrderItem(
                order_id=order.id,
                product_id=product.id,
                variant_id=variant.id,
                product_slug="faki",
                product_name="Faki",
                pack_size="500g",
                quantity=1,
                unit_price_paise=50000,
                line_total_paise=50000,
            ))
            db.commit()

            buyer_principal = AuthenticatedPrincipal(buyer.id, buyer.email, buyer.full_name, "", "CUSTOMER", True)
            submitted = submit_customer_review(
                order.id,
                SubmitReviewRequestSchema(rating=5, reviewText="Fresh packing and a smooth delivery experience."),
                buyer_principal,
                db,
            )
            self.assertTrue(submitted["verifiedPurchase"])
            self.assertEqual(db.scalar(select(AdminAuditLog).where(AdminAuditLog.action == "REVIEW_SUBMITTED")).actor_id, buyer.id)
            self.assertEqual(list_published_reviews(db=db)["total"], 0)

            admin_principal = AuthenticatedPrincipal(admin.id, admin.email, admin.full_name, "", "OWNER_ADMIN", True)
            published = update_admin_review(
                submitted["id"],
                UpdateAdminReviewRequestSchema(moderationStatus="PUBLISHED", adminReply="Thank you for your feedback."),
                admin_principal,
                db,
            )
            self.assertEqual(published["moderationStatus"], "PUBLISHED")
            self.assertEqual(published["adminReply"], "Thank you for your feedback.")
            self.assertEqual(list_published_reviews(db=db)["items"][0]["customerName"], "Hetal P.")

            with self.assertRaises(HTTPException) as duplicate:
                submit_customer_review(
                    order.id,
                    SubmitReviewRequestSchema(rating=4, reviewText="Another review for the same delivered order."),
                    buyer_principal,
                    db,
                )
            self.assertEqual(duplicate.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
