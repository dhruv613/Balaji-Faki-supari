"""Focused persistence checks for delivery-failure state transitions."""

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
from app.db.models import Customer, DeliveryEvent, Order, OrderStatusHistory, Shipment, UserProfile  # noqa: E402
from app.main import update_admin_order_status  # noqa: E402
from app.schemas import UpdateOrderStatusRequestSchema  # noqa: E402


class DeliveryStateServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        db_session.configure_database("sqlite:///:memory:")

    def setUp(self) -> None:
        from app.db.models import Base

        Base.metadata.drop_all(bind=db_session.engine)
        Base.metadata.create_all(bind=db_session.engine)

    def test_delivery_failure_requires_reason_and_keeps_history(self) -> None:
        with db_session.SessionLocal() as db:
            admin = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer", role="CUSTOMER")
            db.add_all([admin, buyer])
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
            db.add(customer)
            db.flush()
            order = Order(
                order_number="#BFP-DELIVERY-TEST",
                user_id=buyer.id,
                customer_id=customer.id,
                status="PICKED_UP",
                payment_status="VERIFIED",
                delivery_status="PICKED_UP",
                subtotal_paise=25000,
                delivery_fee_paise=0,
                total_paise=25000,
                shipping_name="Buyer",
                shipping_phone="+919876543210",
                shipping_address="Rajkot, Gujarat",
                shipping_pin_code="360001",
                stock_deducted=True,
            )
            db.add(order)
            db.flush()
            shipment = Shipment(order_id=order.id, delivery_status="PICKED_UP")
            db.add(shipment)
            db.commit()

            admin_principal = AuthenticatedPrincipal(
                admin.id, admin.email, admin.full_name, "", "OWNER_ADMIN", True
            )
            with self.assertRaises(HTTPException) as missing_reason:
                update_admin_order_status(
                    order.id,
                    UpdateOrderStatusRequestSchema(status="DELIVERY_FAILED"),
                    admin_principal,
                    db,
                )
            self.assertEqual(missing_reason.exception.status_code, 422)
            db.refresh(order)
            db.refresh(shipment)
            self.assertEqual(order.status, "PICKED_UP")
            self.assertIsNone(shipment.failure_reason)

            result = update_admin_order_status(
                order.id,
                UpdateOrderStatusRequestSchema(
                    status="DELIVERY_FAILED",
                    failureReason="Customer was unavailable at the delivery address.",
                ),
                admin_principal,
                db,
            )

            db.refresh(order)
            db.refresh(shipment)
            self.assertEqual(result["orderStatus"], "DELIVERY_FAILED")
            self.assertEqual(order.status, "DELIVERY_FAILED")
            self.assertEqual(shipment.failure_reason, "Customer was unavailable at the delivery address.")
            self.assertEqual(
                db.scalar(select(OrderStatusHistory.to_status).where(OrderStatusHistory.order_id == order.id)),
                "DELIVERY_FAILED",
            )
            self.assertEqual(
                db.scalar(select(DeliveryEvent.status).where(DeliveryEvent.order_id == order.id)),
                "DELIVERY_FAILED",
            )

    def test_delivered_transition_records_the_actual_delivery_timestamp(self) -> None:
        with db_session.SessionLocal() as db:
            admin = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer", role="CUSTOMER")
            db.add_all([admin, buyer])
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
            db.add(customer)
            db.flush()
            order = Order(
                order_number="#BFP-DELIVERED-TEST",
                user_id=buyer.id,
                customer_id=customer.id,
                status="OUT_FOR_DELIVERY",
                payment_status="VERIFIED",
                delivery_status="OUT_FOR_DELIVERY",
                subtotal_paise=25000,
                delivery_fee_paise=0,
                total_paise=25000,
                shipping_name="Buyer",
                shipping_phone="+919876543210",
                shipping_address="Rajkot, Gujarat",
                shipping_pin_code="360001",
                stock_deducted=True,
            )
            db.add(order)
            db.flush()
            shipment = Shipment(order_id=order.id, delivery_status="OUT_FOR_DELIVERY")
            db.add(shipment)
            db.commit()

            admin_principal = AuthenticatedPrincipal(
                admin.id, admin.email, admin.full_name, "", "OWNER_ADMIN", True
            )
            result = update_admin_order_status(
                order.id,
                UpdateOrderStatusRequestSchema(status="DELIVERED", notes="Delivered to the customer."),
                admin_principal,
                db,
            )

            db.refresh(order)
            db.refresh(shipment)
            self.assertEqual(result["orderStatus"], "DELIVERED")
            self.assertEqual(order.status, "DELIVERED")
            self.assertEqual(shipment.delivery_status, "DELIVERED")
            self.assertIsNotNone(shipment.delivered_date)
            self.assertEqual(
                db.scalar(select(OrderStatusHistory.to_status).where(OrderStatusHistory.order_id == order.id)),
                "DELIVERED",
            )
            self.assertEqual(
                db.scalar(select(DeliveryEvent.status).where(DeliveryEvent.order_id == order.id)),
                "DELIVERED",
            )


if __name__ == "__main__":
    unittest.main()
