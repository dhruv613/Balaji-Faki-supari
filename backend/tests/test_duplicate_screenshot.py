"""Exact-file duplicate screenshot warning (SHA-256): information for the admin only, never a decision."""

from __future__ import annotations

import hashlib
import os
import sys
import unittest
from pathlib import Path

from sqlalchemy import event, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session
import app.routes.admin_payments as admin_payments_module
from app.core.security import AuthenticatedPrincipal
from app.db.models import Customer, Order, PaymentAttempt, UserProfile
from app.schemas import ApprovePaymentRequestSchema

MIGRATION = BACKEND_ROOT / "migrations" / "neon" / "006_payment_screenshot_hash.sql"


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class DuplicateScreenshotTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        with db_session.SessionLocal() as db:
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            buyer = UserProfile(email="buyer@example.test", full_name="Buyer")
            db.add_all([owner, buyer])
            db.flush()
            db.add(Customer(user_id=buyer.id, full_name="Buyer", phone="+919876543210"))
            db.commit()
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)
            self.buyer_id = buyer.id
            self.counter = 0

    def attempt(self, db, digest: str | None, *, order: Order | None = None, status: str = "UNDER_REVIEW") -> PaymentAttempt:
        self.counter += 1
        if order is None:
            customer = db.scalar(select(Customer))
            order = Order(
                order_number=f"#BFP-{self.counter}", user_id=self.buyer_id, customer_id=customer.id,
                status="PAYMENT_REVIEW", payment_status="UNDER_REVIEW", total_paise=100000, subtotal_paise=100000,
                delivery_fee_paise=0, shipping_name="Buyer", shipping_phone="+919876543210",
                shipping_address="Rajkot", shipping_area="Rajkot", shipping_pin_code="360001",
            )
            db.add(order)
            db.flush()
        row = PaymentAttempt(
            order_id=order.id, user_id=self.buyer_id, expected_amount_paise=100000,
            screenshot_storage_path=f"p{self.counter}", screenshot_sha256=digest, status=status,
        )
        db.add(row)
        db.commit()
        return row

    def info(self, db, *rows):
        return admin_payments_module._duplicate_screenshot_info(db, list(rows))

    def test_same_file_on_another_order_is_reported_both_ways_without_customer_details(self) -> None:
        with db_session.SessionLocal() as db:
            first = self.attempt(db, sha("a"), status="REJECTED")
            second = self.attempt(db, sha("a"))
            found = self.info(db, first, second)
            self.assertEqual(found[second.id]["count"], 1)
            match = found[second.id]["matches"][0]
            self.assertEqual(match["paymentId"], first.id)
            self.assertEqual(match["orderNumber"], "#BFP-1")
            self.assertEqual(match["paymentStatus"], "REJECTED")
            self.assertFalse(match["sameOrder"])
            self.assertEqual(found[first.id]["matches"][0]["paymentId"], second.id)
            self.assertEqual(set(match), {"paymentId", "orderNumber", "orderStatus", "paymentStatus", "submittedAt", "sameOrder"})

    def test_same_order_resubmission_is_labelled_as_such(self) -> None:
        with db_session.SessionLocal() as db:
            first = self.attempt(db, sha("a"), status="REJECTED")
            again = self.attempt(db, sha("a"), order=db.get(Order, first.order_id))
            self.assertTrue(self.info(db, again)[again.id]["matches"][0]["sameOrder"])

    def test_different_bytes_and_unknown_hashes_never_match(self) -> None:
        with db_session.SessionLocal() as db:
            a = self.attempt(db, sha("a"))
            b = self.attempt(db, sha("b"))
            old_one = self.attempt(db, None)
            old_two = self.attempt(db, None)
            self.assertEqual(self.info(db, a, b, old_one, old_two), {})
            payload = admin_payments_module._serialize_admin_payment(db, old_one)
            self.assertEqual(payload["duplicateScreenshot"], {"count": 0, "matches": []})

    def test_at_most_ten_matches_are_listed_but_all_are_counted(self) -> None:
        with db_session.SessionLocal() as db:
            rows = [self.attempt(db, sha("same")) for _ in range(13)]
            found = self.info(db, rows[-1])[rows[-1].id]
            self.assertEqual(found["count"], 12)
            self.assertEqual(len(found["matches"]), admin_payments_module.MAX_DUPLICATE_MATCHES)

    def test_a_list_of_payments_costs_one_query_for_matches(self) -> None:
        with db_session.SessionLocal() as db:
            rows = [self.attempt(db, sha(str(i % 3))) for i in range(12)]
            statements: list[str] = []

            def record(conn, cursor, statement, *args):  # noqa: ANN001
                statements.append(statement)

            event.listen(db_session.engine, "before_cursor_execute", record)
            try:
                found = self.info(db, *rows)
            finally:
                event.remove(db_session.engine, "before_cursor_execute", record)
            self.assertEqual(len(statements), 1)
            self.assertEqual(len(found), 12)

    def test_many_distinct_files_are_looked_up_in_chunks(self) -> None:
        with db_session.SessionLocal() as db:
            rows = [self.attempt(db, sha(str(i // 2))) for i in range(10)]  # five files, each sent twice
            expected = self.info(db, *rows)
            original = admin_payments_module.HASH_QUERY_CHUNK
            admin_payments_module.HASH_QUERY_CHUNK = 2
            statements: list[str] = []

            def record(conn, cursor, statement, *args):  # noqa: ANN001
                statements.append(statement)

            event.listen(db_session.engine, "before_cursor_execute", record)
            try:
                chunked = self.info(db, *rows)
            finally:
                event.remove(db_session.engine, "before_cursor_execute", record)
                admin_payments_module.HASH_QUERY_CHUNK = original
            self.assertEqual(len(statements), 3)  # five hashes, two per query
            self.assertEqual(chunked, expected)
            self.assertEqual(len(chunked), 10)

    def test_a_match_does_not_change_approval(self) -> None:
        with db_session.SessionLocal() as db:
            self.attempt(db, sha("a"), status="REJECTED")
            target = self.attempt(db, sha("a"))
            result = admin_payments_module.approve_admin_payment(
                target.id, ApprovePaymentRequestSchema.model_validate({"notes": "Checked"}), None, self.admin, db
            )
            self.assertEqual(result["paymentStatus"], "VERIFIED")
            self.assertEqual(result["orderStatus"], "AWAITING_CONFIRMATION")
            self.assertEqual(result["duplicateScreenshot"]["count"], 1)

    def test_the_index_and_migration_are_additive_and_not_unique(self) -> None:
        index = next(i for i in PaymentAttempt.__table__.indexes if i.name == "payment_attempts_screenshot_sha256_idx")
        self.assertFalse(index.unique)
        self.assertTrue(PaymentAttempt.__table__.c.screenshot_sha256.nullable)
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        code = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
        self.assertIn("add column if not exists screenshot_sha256", code)
        self.assertIn("create index if not exists payment_attempts_screenshot_sha256_idx", code)
        for forbidden in ("unique", "drop ", "delete ", "update ", "truncate", "not null"):
            self.assertNotIn(forbidden, code, forbidden)


if __name__ == "__main__":
    unittest.main()
