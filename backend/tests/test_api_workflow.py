"""End-to-end integration tests for the Balaji Faki Point FastAPI backend (Phases 3–6)."""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import jwt as pyjwt
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

TEST_JWT_SECRET = "test-supabase-hs256-secret-for-integration-suite-32bytes"
TEST_TMP_DIR = Path(tempfile.mkdtemp(prefix="bfp_api_test_"))
TEST_DB_URL = f"sqlite:///{(TEST_TMP_DIR / 'test_bfp.sqlite3').as_posix()}"
TEST_SUPABASE_URL = "http://127.0.0.1:54321"
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["BFP_ENV"] = "local"
os.environ["SUPABASE_URL"] = TEST_SUPABASE_URL
os.environ["SUPABASE_JWT_SECRET"] = TEST_JWT_SECRET

import app.db.session as db_session  # noqa: E402
from app.db.models import UserProfile  # noqa: E402
from app.db.seed import seed_development_data  # noqa: E402
from app.main import app  # noqa: E402

# Minimal valid PNG header + IHDR + IEND (67 bytes)
VALID_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)

TEST_PROOF_OBJECTS: dict[str, tuple[bytes, str]] = {}


def _store_test_payment_proof(*, user_id: str, order_id: str, payment_id: str, content: bytes, mime_type: str) -> str:
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime_type]
    storage_path = f"{user_id}/{order_id}/{payment_id}{extension}"
    TEST_PROOF_OBJECTS[storage_path] = (content, mime_type)
    return storage_path


def _read_test_payment_proof(storage_path: str) -> tuple[bytes, str]:
    try:
        return TEST_PROOF_OBJECTS[storage_path]
    except KeyError as exc:
        raise FileNotFoundError("Payment proof object not found in private storage.") from exc


def _mint_jwt(
    *,
    user_id: str,
    email: str,
    full_name: str = "Customer User",
    phone: str = "+919876543210",
    metadata_role: str = "CUSTOMER",
) -> str:
    claims = {
        "sub": user_id,
        "aud": "authenticated",
        "role": "authenticated",
        "email": email,
        "iss": f"{TEST_SUPABASE_URL}/auth/v1",
        "exp": int(time.time()) + 3600,
        "user_metadata": {
            "fullName": full_name,
            "phone": phone,
            "role": metadata_role,
        },
    }
    return pyjwt.encode(claims, TEST_JWT_SECRET, algorithm="HS256")


class FastApiWorkflowIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        os.environ["SUPABASE_JWT_SECRET"] = TEST_JWT_SECRET
        db_session.configure_database(TEST_DB_URL)
        cls._store_proof_patch = patch("app.main.store_private_payment_proof", side_effect=_store_test_payment_proof)
        cls._read_proof_patch = patch("app.main.read_private_payment_proof", side_effect=_read_test_payment_proof)
        cls._store_proof_patch.start()
        cls._read_proof_patch.start()
        cls.client = TestClient(app)

        cls.admin_id = "11111111-1111-4111-8111-111111111111"
        cls.customer1_id = "22222222-2222-4222-8222-222222222222"
        cls.customer2_id = "33333333-3333-4333-8333-333333333333"

        cls.admin_token = _mint_jwt(
            user_id=cls.admin_id,
            email="dp334218@gmail.com",
            full_name="Dhruv Admin",
            phone="+918160628688",
        )
        # Customer 1 attempts to spoof OWNER_ADMIN in user_metadata; server must enforce CUSTOMER
        cls.customer1_token = _mint_jwt(
            user_id=cls.customer1_id,
            email="rahul@example.com",
            full_name="Rahul Mehta",
            phone="+919825011223",
            metadata_role="OWNER_ADMIN",
        )
        cls.customer2_token = _mint_jwt(
            user_id=cls.customer2_id,
            email="priya@example.com",
            full_name="Priya Shah",
            phone="+919825099887",
        )

        with db_session.SessionLocal() as db:
            seed_development_data(db)  # explicit development data; request handlers never seed
            db.add(
                UserProfile(
                    id=cls.admin_id,
                    email="dp334218@gmail.com",
                    full_name="Dhruv Admin",
                    phone="+918160628688",
                    role="OWNER_ADMIN",
                    is_active=True,
                )
            )
            db.commit()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        cls._read_proof_patch.stop()
        cls._store_proof_patch.stop()
        db_session.engine.dispose()
        shutil.rmtree(TEST_TMP_DIR, ignore_errors=True)

    def test_full_checkout_payment_admin_and_delivery_lifecycle(self) -> None:
        c1_headers = {"Authorization": f"Bearer {self.customer1_token}"}
        c2_headers = {"Authorization": f"Bearer {self.customer2_token}"}
        admin_headers = {"Authorization": f"Bearer {self.admin_token}"}

        # 1. Health check
        health_res = self.client.get("/api/health")
        self.assertEqual(health_res.status_code, 200)
        self.assertEqual(health_res.json()["status"], "ok")

        # 2. Auth & RBAC verification
        unauth_res = self.client.get("/api/me")
        self.assertEqual(unauth_res.status_code, 401)

        me_c1 = self.client.get("/api/me", headers=c1_headers)
        self.assertEqual(me_c1.status_code, 200)
        self.assertEqual(me_c1.json()["role"], "CUSTOMER")

        forbidden_admin = self.client.get("/api/admin/dashboard", headers=c1_headers)
        self.assertEqual(forbidden_admin.status_code, 403)

        me_admin = self.client.get("/api/me", headers=admin_headers)
        self.assertEqual(me_admin.status_code, 200)
        self.assertEqual(me_admin.json()["role"], "OWNER_ADMIN")

        # 3. Products & Admin Price Configuration
        products_res = self.client.get("/api/products")
        self.assertEqual(products_res.status_code, 200)
        products = products_res.json()
        self.assertEqual({p["type"] for p in products}, {"faki", "supari"})

        # Admin configures selling & cost prices for Faki and Supari variants
        update_faki = self.client.patch(
            "/api/admin/products/faki",
            headers=admin_headers,
            json={
                "information": {
                    "ingredients": "Test-confirmed ingredients.",
                    "productionPackaging": "Test-confirmed packaging.",
                    "safetyStorage": "Test-confirmed storage guidance.",
                },
                "variants": [
                    {"packSize": "250g", "costPrice": 90, "price": 140, "availableQuantity": 50, "isAvailable": True},
                    {"packSize": "500g", "costPrice": 170, "price": 260, "availableQuantity": 50, "isAvailable": True},
                    {"packSize": "1kg", "costPrice": 320, "price": 500, "availableQuantity": 50, "isAvailable": True},
                ]
            },
        )
        self.assertEqual(update_faki.status_code, 200)
        self.assertEqual(update_faki.json()["information"]["ingredients"], "Test-confirmed ingredients.")
        self.assertEqual(update_faki.json()["information"]["productionPackaging"], "Test-confirmed packaging.")

        update_supari = self.client.patch(
            "/api/admin/products/supari",
            headers=admin_headers,
            json={
                "variants": [
                    {"packSize": "250g", "costPrice": 110, "price": 180, "availableQuantity": 50, "isAvailable": True},
                    {"packSize": "500g", "costPrice": 210, "price": 340, "availableQuantity": 50, "isAvailable": True},
                    {"packSize": "1kg", "costPrice": 400, "price": 650, "availableQuantity": 50, "isAvailable": True},
                ]
            },
        )
        self.assertEqual(update_supari.status_code, 200)

        # 4. Server-calculated Checkout Quote
        quote_res = self.client.post(
            "/api/checkout/quote",
            json={"product": "faki", "packSize": "500g", "quantity": 2, "pinCode": "360005"},
        )
        self.assertEqual(quote_res.status_code, 200)
        quote = quote_res.json()
        self.assertEqual(quote["subtotal"], 520)
        self.assertEqual(quote["deliveryFee"], 0)
        self.assertEqual(quote["total"], 520)
        self.assertEqual(quote["currency"], "INR")

        # 5. Customer Order Creation + Idempotency
        order_payload = {
            "product": "faki",
            "packSize": "500g",
            "quantity": 2,
            "fullName": "Rahul Mehta",
            "phone": "9825011223",
            "address": "42, Swastik Society, Kalawad Road, Rajkot",
            "pinCode": "360005",
        }
        create_res = self.client.post(
            "/api/orders",
            headers={**c1_headers, "Idempotency-Key": "order-idem-key-001"},
            json=order_payload,
        )
        self.assertEqual(create_res.status_code, 200)
        order = create_res.json()
        order_id = order["id"]
        self.assertEqual(order["status"], "PENDING_PAYMENT")
        self.assertEqual(order["paymentStatus"], "PENDING")
        self.assertEqual(order["total"], 520)
        self.assertEqual(order["payment"]["amount"], 520)
        self.assertIsNone(order["payment"]["qrImageUrl"])

        # Duplicate retry with same Idempotency-Key returns same order without double reservation
        retry_res = self.client.post(
            "/api/orders",
            headers={**c1_headers, "Idempotency-Key": "order-idem-key-001"},
            json=order_payload,
        )
        self.assertEqual(retry_res.status_code, 200)
        self.assertEqual(retry_res.json()["id"], order_id)

        # Customer 2 cannot read Customer 1's order
        other_customer_read = self.client.get(f"/api/orders/{order_id}", headers=c2_headers)
        self.assertEqual(other_customer_read.status_code, 403)

        # 6. Payment Proof Submission (Multipart UTR + Private Screenshot)
        # Reject invalid UTR
        bad_utr_res = self.client.post(
            f"/api/payments/{order_id}/submit",
            headers=c1_headers,
            data={"utr": "12345"},
            files={"screenshot": ("proof.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(bad_utr_res.status_code, 422)

        # Reject fake image content
        bad_img_res = self.client.post(
            f"/api/payments/{order_id}/submit",
            headers=c1_headers,
            data={"utr": "412345678901"},
            files={"screenshot": ("proof.png", b"not-a-valid-image-header-at-all", "image/png")},
        )
        self.assertEqual(bad_img_res.status_code, 422)

        # Valid multipart payment submission
        submit_res = self.client.post(
            f"/api/payments/{order_id}/submit",
            headers={**c1_headers, "Idempotency-Key": "pay-idem-001"},
            data={"utr": "412345678901"},
            files={"screenshot": ("proof.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(submit_res.status_code, 200)
        submitted = submit_res.json()
        payment_id = submitted["paymentId"]
        self.assertEqual(submitted["paymentStatus"], "SUBMITTED")
        self.assertEqual(submitted["orderStatus"], "PAYMENT_REVIEW")
        self.assertEqual(
            submitted["message"],
            "Payment proof submitted successfully. Waiting for admin verification.",
        )

        # Idempotent retry of payment proof returns same paymentId without error
        submit_retry = self.client.post(
            f"/api/payments/{order_id}/submit",
            headers={**c1_headers, "Idempotency-Key": "pay-idem-001"},
            data={"utr": "412345678901"},
            files={"screenshot": ("proof.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(submit_retry.status_code, 200)
        self.assertEqual(submit_retry.json()["paymentId"], payment_id)

        # Customer checks payment status
        pay_status_res = self.client.get(f"/api/payments/{order_id}/status", headers=c1_headers)
        self.assertEqual(pay_status_res.status_code, 200)
        self.assertEqual(pay_status_res.json()["status"], "SUBMITTED")
        self.assertEqual(pay_status_res.json()["orderStatus"], "PAYMENT_REVIEW")

        # 7. Admin Dashboard & Payment Review Queue
        dash_before = self.client.get("/api/admin/dashboard", headers=admin_headers)
        self.assertEqual(dash_before.status_code, 200)
        self.assertEqual(len(dash_before.json()["pendingPaymentConfirmations"]), 1)
        self.assertEqual(dash_before.json()["productsSold"], 0)

        # Admin fetches short-lived signed proof URL and raw screenshot bytes
        proof_meta_res = self.client.get(
            f"/api/admin/payments/{payment_id}/proof",
            headers=admin_headers,
        )
        self.assertEqual(proof_meta_res.status_code, 200)
        signed_url = proof_meta_res.json()["signedUrl"]
        self.assertIn("sig=", signed_url)

        raw_proof_res = self.client.get(signed_url)
        self.assertEqual(raw_proof_res.status_code, 200)
        self.assertEqual(raw_proof_res.headers["content-type"], "image/png")
        self.assertEqual(raw_proof_res.content, VALID_PNG_BYTES)

        # Tampered signature on signed proof URL must be rejected (401)
        tampered_url = signed_url.replace("sig=", "sig=forged_")
        tampered_res = self.client.get(tampered_url)
        self.assertEqual(tampered_res.status_code, 401)

        # Expired signature on signed proof URL must be rejected (401)
        url_prefix, _, url_exp = signed_url.partition("&exp=")
        exp_val = url_exp.split("&")[0]
        expired_url = signed_url.replace(f"exp={exp_val}", f"exp={int(time.time()) - 300}")
        expired_res = self.client.get(expired_url)
        self.assertEqual(expired_res.status_code, 401)

        # Order confirmation BEFORE payment verification must be blocked (409)
        premature_confirm = self.client.post(
            f"/api/admin/orders/{order_id}/confirm",
            headers=admin_headers,
            json={"notes": "Trying to confirm before payment verification"},
        )
        self.assertEqual(premature_confirm.status_code, 409)

        # Direct approval must be blocked until an Owner Admin starts independent bank review.
        direct_approve = self.client.post(
            f"/api/admin/payments/{payment_id}/approve",
            headers=admin_headers,
            json={
                "receivingBankAccount": "Axis Bank · 8000961030@okbizaxis",
                "verifiedAmount": 500,
                "verifiedUtr": "412345678901",
                "transactionStatus": "CREDITED",
                "bankCreditReference": "AXIS-CR-20261018-0001",
            },
        )
        self.assertEqual(direct_approve.status_code, 409)

        # Only an Owner Admin can move SUBMITTED -> UNDER_REVIEW.
        forbidden_review = self.client.post(
            f"/api/admin/payments/{payment_id}/review",
            headers=c1_headers,
            json={"notes": "Customer cannot review their own payment."},
        )
        self.assertEqual(forbidden_review.status_code, 403)
        review_res = self.client.post(
            f"/api/admin/payments/{payment_id}/review",
            headers=admin_headers,
            json={"notes": "Checking the independent bank credit entry."},
        )
        self.assertEqual(review_res.status_code, 200)
        self.assertEqual(review_res.json()["paymentStatus"], "UNDER_REVIEW")
        self.assertEqual(review_res.json()["orderStatus"], "PAYMENT_REVIEW")

        # Under review still blocks a mismatched bank amount.
        mismatch_approve = self.client.post(
            f"/api/admin/payments/{payment_id}/approve",
            headers=admin_headers,
            json={
                "receivingBankAccount": "Axis Bank · 8000961030@okbizaxis",
                "verifiedAmount": 500,
                "verifiedUtr": "412345678901",
                "transactionStatus": "CREDITED",
                "bankCreditReference": "AXIS-CR-20261018-0001",
            },
        )
        self.assertEqual(mismatch_approve.status_code, 400)

        # Valid Admin Payment Approval -> Payment = VERIFIED, Order = AWAITING_CONFIRMATION
        approval_headers = {**admin_headers, "Idempotency-Key": "approve-payment-001"}
        approve_res = self.client.post(
            f"/api/admin/payments/{payment_id}/approve",
            headers=approval_headers,
            json={
                "receivingBankAccount": "Axis Bank · 8000961030@okbizaxis",
                "verifiedAmount": 520,
                "verifiedUtr": "412345678901",
                "transactionStatus": "CREDITED",
                "bankCreditReference": "AXIS-CR-20261018-0001",
                "notes": "Matched Axis Bank credit statement entry",
            },
        )
        self.assertEqual(approve_res.status_code, 200)
        approved_payment = approve_res.json()
        self.assertEqual(approved_payment["paymentStatus"], "VERIFIED")
        self.assertEqual(approved_payment["orderStatus"], "AWAITING_CONFIRMATION")

        approval_retry = self.client.post(
            f"/api/admin/payments/{payment_id}/approve",
            headers=approval_headers,
            json={
                "receivingBankAccount": "Axis Bank · 8000961030@okbizaxis",
                "verifiedAmount": 520,
                "verifiedUtr": "412345678901",
                "transactionStatus": "CREDITED",
                "bankCreditReference": "AXIS-CR-20261018-0001",
            },
        )
        self.assertEqual(approval_retry.status_code, 200)
        self.assertEqual(approval_retry.json()["orderStatus"], "AWAITING_CONFIRMATION")

        # 8. Separate Admin Order Confirmation -> Order = CONFIRMED
        confirmation_headers = {**admin_headers, "Idempotency-Key": "confirm-order-001"}
        confirm_res = self.client.post(
            f"/api/admin/orders/{order_id}/confirm",
            headers=confirmation_headers,
            json={"notes": "Confirmed after bank verification"},
        )
        self.assertEqual(confirm_res.status_code, 200)
        confirmed_order = confirm_res.json()
        self.assertEqual(confirmed_order["orderStatus"], "CONFIRMED")
        self.assertEqual(confirmed_order["paymentStatus"], "VERIFIED")

        confirm_retry = self.client.post(
            f"/api/admin/orders/{order_id}/confirm",
            headers=confirmation_headers,
            json={"notes": "Confirmed after bank verification"},
        )
        self.assertEqual(confirm_retry.status_code, 200)
        self.assertEqual(confirm_retry.json()["orderStatus"], "CONFIRMED")

        # 9. Delivery Management & Step-by-Step Fulfillment
        deliveries_res = self.client.get("/api/admin/deliveries", headers=admin_headers)
        self.assertEqual(deliveries_res.status_code, 200)
        deliveries = deliveries_res.json()["items"]
        self.assertEqual(len(deliveries), 1)
        delivery_id = deliveries[0]["id"]
        self.assertEqual(deliveries[0]["status"], "CONFIRMED")

        # Save delivery assignment metadata WITHOUT changing order status
        assign_res = self.client.patch(
            f"/api/admin/deliveries/{delivery_id}",
            headers=admin_headers,
            json={
                "assignedDeliveryPerson": "Bharatbhai Parmar",
                "deliveryPhone": "+91 98250 77889",
                "courierTrackingReference": "RAJKOT-LOCAL-101",
                "estimatedDeliveryDate": "18 Oct 2026",
                "deliveryNotes": "Call customer at gate",
            },
        )
        self.assertEqual(assign_res.status_code, 200)
        self.assertEqual(assign_res.json()["status"], "CONFIRMED")
        self.assertEqual(assign_res.json()["assignedDeliveryPerson"], "Bharatbhai Parmar")

        # Skipping delivery stage (CONFIRMED -> SHIPPED) must be blocked (409)
        skip_stage_res = self.client.patch(
            f"/api/admin/deliveries/{delivery_id}",
            headers=admin_headers,
            json={"status": "SHIPPED"},
        )
        self.assertEqual(skip_stage_res.status_code, 409)

        # Advance step-by-step through the canonical fulfillment state machine
        for next_stage in ("PACKING", "PACKED", "PICKED_UP", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"):
            step_res = self.client.patch(
                f"/api/admin/deliveries/{delivery_id}",
                headers=admin_headers,
                json={"status": next_stage, "deliveryNotes": f"Stage updated to {next_stage}"},
            )
            self.assertEqual(step_res.status_code, 200)
            self.assertEqual(step_res.json()["status"], next_stage)

        # 10. Customer Tracking & Final Dashboard Metrics
        tracking_res = self.client.get(f"/api/orders/{order_id}/tracking", headers=c1_headers)
        self.assertEqual(tracking_res.status_code, 200)
        tracking_events = tracking_res.json()["events"]
        recorded_statuses = [e["status"] for e in tracking_events]
        self.assertIn("PENDING_PAYMENT", recorded_statuses)
        self.assertIn("PAYMENT_REVIEW", recorded_statuses)
        self.assertIn("AWAITING_CONFIRMATION", recorded_statuses)
        self.assertIn("CONFIRMED", recorded_statuses)
        self.assertIn("DELIVERED", recorded_statuses)

        dash_after = self.client.get("/api/admin/dashboard", headers=admin_headers)
        self.assertEqual(dash_after.status_code, 200)
        dashboard_after = dash_after.json()
        self.assertEqual(dashboard_after["productsSold"], 2)
        self.assertEqual(dashboard_after["pendingPaymentConfirmations"], [])
        # Net Profit = 520 item revenue - (170 * 2 cost) = 180 INR
        self.assertEqual(dashboard_after["netProfit"]["status"], "OK")
        self.assertEqual(dashboard_after["netProfit"]["amount"], 180)

        # 11. Second Order: Test Duplicate UTR Rejection, Payment Rejection, and Cancellation Stock Release
        order2_res = self.client.post(
            "/api/orders",
            headers={**c2_headers, "Idempotency-Key": "order-idem-key-002"},
            json={
                "product": "supari",
                "packSize": "250g",
                "quantity": 1,
                "fullName": "Priya Shah",
                "phone": "9825099887",
                "address": "10, Race Course Ring Road, Rajkot",
                "pinCode": "360001",
            },
        )
        self.assertEqual(order2_res.status_code, 200)
        order2_id = order2_res.json()["id"]

        # Reusing a UTR that is already VERIFIED on Order 1 must be rejected (409)
        dup_utr_res = self.client.post(
            f"/api/payments/{order2_id}/submit",
            headers=c2_headers,
            data={"utr": "412345678901"},
            files={"screenshot": ("proof2.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(dup_utr_res.status_code, 409)

        # Submit with a distinct UTR
        sub2_res = self.client.post(
            f"/api/payments/{order2_id}/submit",
            headers=c2_headers,
            data={"utr": "499988887777"},
            files={"screenshot": ("proof2.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(sub2_res.status_code, 200)
        payment2_id = sub2_res.json()["paymentId"]

        # Admin rejects payment proof and returns the order to PENDING_PAYMENT for a new attempt.
        reject_res = self.client.post(
            f"/api/admin/payments/{payment2_id}/reject",
            headers=admin_headers,
            json={
                "reason": "Screenshot is blurry and UTR 499988887777 is not settled in Axis statement.",
                "requestCorrectedProof": True,
            },
        )
        self.assertEqual(reject_res.status_code, 200)
        self.assertEqual(reject_res.json()["paymentStatus"], "REJECTED")
        self.assertEqual(reject_res.json()["orderStatus"], "PENDING_PAYMENT")

        retry_res = self.client.post(
            f"/api/payments/{order2_id}/submit",
            headers={**c2_headers, "Idempotency-Key": "pay-idem-002-retry"},
            data={"utr": "488877776666"},
            files={"screenshot": ("proof3.png", VALID_PNG_BYTES, "image/png")},
        )
        self.assertEqual(retry_res.status_code, 200)
        self.assertNotEqual(retry_res.json()["paymentId"], payment2_id)
        self.assertEqual(retry_res.json()["paymentStatus"], "SUBMITTED")
        self.assertEqual(retry_res.json()["orderStatus"], "PAYMENT_REVIEW")

        # A unique UTR is still insufficient: a reused bank-credit reference is blocked.
        payment2_retry_id = retry_res.json()["paymentId"]
        review_retry_res = self.client.post(
            f"/api/admin/payments/{payment2_retry_id}/review",
            headers=admin_headers,
            json={"notes": "Checking the new UTR against the bank statement."},
        )
        self.assertEqual(review_retry_res.status_code, 200)
        duplicate_credit_ref = self.client.post(
            f"/api/admin/payments/{payment2_retry_id}/approve",
            headers=admin_headers,
            json={
                "receivingBankAccount": "Axis Bank · 8000961030@okbizaxis",
                "verifiedAmount": 180,
                "verifiedUtr": "488877776666",
                "transactionStatus": "CREDITED",
                "bankCreditReference": "AXIS-CR-20261018-0001",
            },
        )
        self.assertEqual(duplicate_credit_ref.status_code, 409)

        # Admin cancels the unpaid order via PATCH /api/admin/orders/{id}/status
        cancel_res = self.client.patch(
            f"/api/admin/orders/{order2_id}/status",
            headers=admin_headers,
            json={
                "status": "CANCELLED",
                "cancellationReason": "Customer requested cancellation after payment failure.",
            },
        )
        self.assertEqual(cancel_res.status_code, 200)
        self.assertEqual(cancel_res.json()["orderStatus"], "CANCELLED")

        # A fresh database engine sees the persisted terminal delivery state after restart.
        db_session.engine.dispose()
        db_session.configure_database(TEST_DB_URL)
        restarted_client = TestClient(app)
        try:
            persisted_order = restarted_client.get(f"/api/orders/{order_id}", headers=c1_headers)
            self.assertEqual(persisted_order.status_code, 200)
            self.assertEqual(persisted_order.json()["status"], "DELIVERED")
            self.assertEqual(persisted_order.json()["paymentStatus"], "VERIFIED")
        finally:
            restarted_client.close()


if __name__ == "__main__":
    unittest.main()
