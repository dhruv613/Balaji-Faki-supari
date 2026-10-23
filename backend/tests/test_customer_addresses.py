"""Saved addresses include a customer's earlier deliveries without leaking another account's data."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.db.session as db_session  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.models import Base, Customer, Order, UserProfile  # noqa: E402
from app.routes.account import list_my_addresses, save_my_address  # noqa: E402
from app.schemas import SaveAddressRequestSchema  # noqa: E402


class CustomerAddressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        db_session.configure_database("sqlite:///:memory:")

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=db_session.engine)
        Base.metadata.create_all(bind=db_session.engine)

    def test_older_order_addresses_and_new_saved_address_are_scoped_to_owner(self) -> None:
        with db_session.SessionLocal() as db:
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="CUSTOMER")
            other = UserProfile(email="other@example.test", full_name="Other", role="CUSTOMER")
            db.add_all([owner, other])
            db.flush()
            customer = Customer(user_id=owner.id, full_name="Owner", phone="+919876543210",
                                address="Current House, Rajkot", pin_code="360002")
            db.add(customer)
            db.flush()
            db.add(Order(order_number="#BFP-ADDRESS-1", user_id=owner.id, customer_id=customer.id,
                         status="DELIVERED", payment_status="VERIFIED", subtotal_paise=10000,
                         delivery_fee_paise=1000, total_paise=11000, shipping_name="Owner",
                         shipping_phone="+919876543210", shipping_address="Old House, Rajkot",
                         shipping_pin_code="360001"))
            db.commit()
            own = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "CUSTOMER", True)
            stranger = AuthenticatedPrincipal(other.id, other.email, other.full_name, "", "CUSTOMER", True)

            saved = save_my_address(SaveAddressRequestSchema(address="New Apartment, Rajkot", pinCode="360003"), own, db)
            self.assertEqual(saved["pinCode"], "360003")
            save_my_address(SaveAddressRequestSchema(address="New Apartment, Rajkot", pinCode="360003"), own, db)
            addresses = list_my_addresses(own, db)["items"]
            self.assertEqual({item["address"] for item in addresses},
                             {"Current House, Rajkot", "Old House, Rajkot", "New Apartment, Rajkot"})
            self.assertEqual(list_my_addresses(stranger, db), {"items": []})

    def test_rejects_blank_or_invalid_saved_address(self) -> None:
        with db_session.SessionLocal() as db:
            user = UserProfile(email="buyer@example.test", full_name="Buyer", role="CUSTOMER")
            db.add(user)
            db.commit()
            principal = AuthenticatedPrincipal(user.id, user.email, user.full_name, "", "CUSTOMER", True)
            with self.assertRaises(HTTPException) as rejected:
                save_my_address(SaveAddressRequestSchema(address=" " * 10, pinCode="000000"), principal, db)
            self.assertEqual(rejected.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
