"""The exact JSON the admin frontend sends must be accepted over HTTP (schemas refuse unknown fields)."""

from __future__ import annotations

import os
import sys
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import jwt as pyjwt
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TMP = Path(tempfile.mkdtemp(prefix="bfp_contract_test_"))
DB_URL = f"sqlite:///{(TMP / 'contract.sqlite3').as_posix()}"
os.environ["DATABASE_URL"] = DB_URL
os.environ["BFP_ENV"] = "local"

from auth_support import mint_token, start_auth  # noqa: E402

import app.db.session as db_session  # noqa: E402
from app.db.models import Customer, Order, OrderItem, ProductVariant, Review, StoreSettings, UserProfile, utcnow  # noqa: E402
from app.db.seed import seed_development_data  # noqa: E402
from app.main import app  # noqa: E402
from sqlalchemy import select  # noqa: E402

ADMIN_ID = "55555555-5555-4555-8555-555555555555"
PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def token(user_id: str) -> str:
    return mint_token(user_id, "owner-contract@example.test")



class AdminHttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        start_auth(cls)
        db_session.configure_database(DB_URL)
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            db.add(UserProfile(id=ADMIN_ID, auth_subject=ADMIN_ID, email="owner-contract@example.test", full_name="Owner", role="OWNER_ADMIN"))
            buyer = UserProfile(email="buyer-contract@example.test", full_name="Buyer")
            db.add(buyer)
            db.flush()
            customer = Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210")
            db.add(customer)
            db.flush()
            variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-1KG"))
            order = Order(
                order_number="#BFP-3001", user_id=buyer.id, customer_id=customer.id, status="DELIVERED", payment_status="VERIFIED",
                total_paise=100000, subtotal_paise=100000, delivery_fee_paise=0, shipping_name="Buyer", shipping_phone="+919876543210",
                shipping_address="Rajkot", shipping_area="Rajkot", shipping_pin_code="360005",
            )
            db.add(order)
            db.flush()
            db.add(OrderItem(order_id=order.id, product_id=variant.product_id, variant_id=variant.id, product_slug="faki",
                             product_name="Faki", pack_size="1kg", quantity=1, unit_price_paise=100000, line_total_paise=100000))
            db.flush()
            db.add(Review(order_id=order.id, customer_id=customer.id, user_id=buyer.id, product_id=variant.product_id,
                          rating=1, review_text="Terrible experience with this order.", moderation_status="PUBLISHED"))
            db.commit()
            cls.variant_id = variant.id
        cls.client = TestClient(app)
        cls.headers = {"Authorization": f"Bearer {token(ADMIN_ID)}"}
        cls.storage = {}

    def test_inventory_adjustment_payload(self) -> None:
        response = self.client.post(
            "/api/admin/inventory/adjustments", headers=self.headers,
            json={"inventoryItemId": self.variant_id, "adjustmentType": "ADD", "quantity": 5, "reason": "Fresh batch received"},
        )
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["quantityDelta"], 5)
        listing = self.client.get("/api/admin/inventory", headers=self.headers).json()
        self.assertEqual(next(i for i in listing["items"] if i["id"] == self.variant_id)["totalStock"], 55)

    def test_product_and_variant_patch_payloads(self) -> None:
        body = {"description": "Owner text", "information": {"ingredients": "Confirmed list", "shelfLife": "6 months"},
                "variants": [{"packSize": "500g", "price": 520, "priceConfirmed": True, "isAvailable": True, "costPrice": 190}]}
        response = self.client.patch("/api/admin/products/faki", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        variant = next(v for v in response.json()["variants"] if v["packSize"] == "500g")
        self.assertEqual((variant["price"], variant["costPrice"], variant["priceConfirmed"]), (520, 190, True))
        self.assertEqual(response.json()["information"]["shelfLife"], "6 months")
        unknown = self.client.patch("/api/admin/products/faki", headers=self.headers, json={"imageUrl": "/x.png"})
        self.assertEqual(unknown.status_code, 422)  # free-text image URLs are no longer accepted

    def test_saved_price_approval_stock_and_order_snapshots_survive_restart(self) -> None:
        import app.routes.common as common

        with db_session.SessionLocal() as db:
            variant = db.get(ProductVariant, self.variant_id)
            variant.total_stock, variant.reserved_stock = 0, 0
            store = db.get(StoreSettings, 1)
            store.business_settings_confirmed_at = utcnow()
            buyer = db.scalar(select(UserProfile).where(UserProfile.email == "buyer-contract@example.test"))
            buyer.auth_subject = buyer.id
            buyer_id = buyer.id
            old_item = db.scalar(select(OrderItem).where(OrderItem.variant_id == self.variant_id))
            old_item_id, old_order_id = old_item.id, old_item.order_id
            old_unit_price, old_total = old_item.unit_price_paise, db.get(Order, old_item.order_id).total_paise
            db.commit()

        buyer_headers = {"Authorization": f"Bearer {mint_token(buyer_id, 'buyer-contract@example.test')}"}
        change = {"variants": [{"packSize": "1kg", "price": 1125}]}
        self.assertEqual(self.client.patch("/api/admin/products/faki", json=change).status_code, 401)
        self.assertEqual(self.client.patch("/api/admin/products/faki", headers=buyer_headers, json=change).status_code, 403)
        quote = {"product": "faki", "packSize": "1kg", "quantity": 1, "pinCode": "360005"}

        with patch.object(common, "settings", replace(common.settings, app_env="production")):
            saved = self.client.patch("/api/admin/products/faki", headers=self.headers, json=change)
            self.assertEqual(saved.status_code, 200, saved.text)
            pack = next(v for v in saved.json()["variants"] if v["packSize"] == "1kg")
            self.assertEqual((pack["price"], pack["priceConfirmed"]), (1125, False))
            self.assertEqual(self.client.post("/api/checkout/quote", json=quote).status_code, 503)

            approved = self.client.patch("/api/admin/products/faki", headers=self.headers,
                                         json={"variants": [{"packSize": "1kg", "priceConfirmed": True}]})
            self.assertEqual(approved.status_code, 200, approved.text)
            self.assertEqual(self.client.post("/api/checkout/quote", json=quote).status_code, 409)
            public = self.client.get("/api/products/faki")
            self.assertEqual((public.json()["prices"]["1kg"], public.json()["inStock"]["1kg"]), (1125, False))

            adjustment = {"inventoryItemId": self.variant_id, "adjustmentType": "ADD", "quantity": 5,
                          "reason": "Fresh batch received"}
            self.assertEqual(self.client.post("/api/admin/inventory/adjustments", headers=buyer_headers, json=adjustment).status_code, 403)
            added = self.client.post("/api/admin/inventory/adjustments", headers=self.headers, json=adjustment)
            self.assertEqual(added.status_code, 201, added.text)
            self.assertEqual(self.client.get("/api/products/faki").json()["inStock"]["1kg"], True)
            self.assertEqual(self.client.post("/api/checkout/quote", json=quote).json()["subtotal"], 1125)

            order = self.client.post("/api/orders", headers=buyer_headers, json={**quote, "fullName": "Buyer Name",
                                     "phone": "9876543210", "address": "12 Test Society, University Road, Rajkot"})
            self.assertEqual(order.status_code, 200, order.text)
            self.assertEqual(order.json()["subtotal"], 1125)

            db_session.configure_database(DB_URL)  # reopen the same file, as a fresh backend process would
            for path in ("/api/products", "/products"):
                listing = self.client.get(path)
                self.assertEqual(listing.status_code, 200, listing.text)
                self.assertIn("no-store", listing.headers.get("cache-control", ""))
                faki = next(p for p in listing.json() if p["type"] == "faki")
                self.assertEqual((faki["prices"]["1kg"], faki["priceConfirmed"]["1kg"], faki["inStock"]["1kg"]), (1125, True, True))
            self.assertIn("no-store", self.client.get("/api/products/faki").headers.get("cache-control", ""))
            inventory = self.client.get("/api/admin/inventory", headers=self.headers).json()
            stock = next(i for i in inventory["items"] if i["id"] == self.variant_id)
            self.assertEqual((stock["totalStock"], stock["availableStock"], stock["reservedStock"]), (5, 4, 1))
            with db_session.SessionLocal() as db:
                self.assertEqual(db.get(OrderItem, old_item_id).unit_price_paise, old_unit_price)
                self.assertEqual(db.get(Order, old_order_id).total_paise, old_total)
                new_item = db.scalar(select(OrderItem).where(OrderItem.order_id == order.json()["id"]))
                self.assertEqual(new_item.unit_price_paise, 112500)

            revoked = self.client.patch("/api/admin/products/faki", headers=self.headers,
                                        json={"variants": [{"packSize": "1kg", "priceConfirmed": False}]})
            self.assertEqual(revoked.status_code, 200, revoked.text)
            self.assertFalse(self.client.get("/api/products/faki").json()["priceConfirmed"]["1kg"])
            self.assertEqual(self.client.post("/api/checkout/quote", json=quote).status_code, 503)

    def test_settings_payloads_and_qr_upload(self) -> None:
        patch_body = {"shopIntro": "Owner written", "deliveryCharges": 30, "freeDeliveryThreshold": 1500,
                      "serviceablePinCodes": ["360005", "360001"], "lowStockThreshold": 12, "supportEmail": ""}
        response = self.client.patch("/api/admin/settings", headers=self.headers, json=patch_body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["deliveryCharges"], 30)
        self.assertEqual(response.json()["freeDeliveryThreshold"], 1500)
        public = self.client.get("/api/store").json()
        self.assertEqual(public["shopIntro"], "Owner written")
        self.assertNotIn("officialUpiId", public)
        self.assertNotIn("upiId", public)

        def put(bucket, path, content, mime, **_):
            self.storage[(bucket, path)] = content

        with patch("app.routes.admin.put_storage_object", side_effect=put):
            qr = self.client.post("/api/admin/settings/qr", headers=self.headers, files={"qr": ("qr.png", PNG, "image/png")})
        self.assertEqual(qr.status_code, 200, qr.text)
        self.assertTrue(qr.json()["officialUpiQrImageUrl"].startswith("/api/admin/settings/qr?sig="))
        confirm = self.client.post("/api/admin/settings/confirm", headers=self.headers, json={"confirm": True})
        self.assertEqual(confirm.status_code, 422)  # still the LOCAL TEST UPI id
        self.assertIn("LOCAL TEST", confirm.json()["detail"])

    def test_review_moderation_payload_requires_a_reason_to_hide(self) -> None:
        review_id = self.client.get("/api/admin/reviews", headers=self.headers).json()["items"][0]["id"]
        refused = self.client.patch(f"/api/admin/reviews/{review_id}", headers=self.headers, json={"moderationStatus": "HIDDEN"})
        self.assertEqual(refused.status_code, 422)
        reply = self.client.patch(f"/api/admin/reviews/{review_id}", headers=self.headers, json={"adminReply": "We are sorry to hear this."})
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertEqual(reply.json()["moderationStatus"], "PUBLISHED")  # a reply never changes visibility
        public = self.client.get("/api/reviews?sort=lowest").json()
        self.assertEqual(public["items"][0]["rating"], 1)  # a harsh genuine review stays public
        hidden = self.client.patch(
            f"/api/admin/reviews/{review_id}", headers=self.headers,
            json={"moderationStatus": "HIDDEN", "moderationReason": "Spam: advertising a competitor"},
        )
        self.assertEqual(hidden.status_code, 200, hidden.text)
        self.assertEqual(self.client.get("/api/reviews").json()["summary"]["count"], 0)
        self.assertEqual(self.client.get("/api/admin/reviews", headers=self.headers).json()["total"], 1)

    def test_dashboard_and_customers_endpoints(self) -> None:
        dashboard = self.client.get("/api/admin/dashboard", headers=self.headers).json()
        self.assertEqual(set(dashboard), {"productsSold", "netProfit", "pendingPaymentConfirmations"})
        customers = self.client.get("/api/admin/customers?status=all&page=1&pageSize=20&search=buyer", headers=self.headers)
        self.assertEqual(customers.status_code, 200, customers.text)
        self.assertEqual(customers.json()["total"], 1)
        orders = self.client.get("/api/admin/orders?pageSize=200&status=ALL&paymentStatus=ALL", headers=self.headers)
        self.assertEqual(orders.status_code, 200, orders.text)
        self.assertIn("items", orders.json()["items"][0])


if __name__ == "__main__":
    unittest.main()
