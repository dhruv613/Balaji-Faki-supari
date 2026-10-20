"""Reviews: eligibility, auto-publish, photos, public summary/sort, moderation and secure photo access."""

from __future__ import annotations

import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import select
from starlette.datastructures import Headers, UploadFile

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session  # noqa: E402
from app.core.security import AuthenticatedPrincipal  # noqa: E402
from app.db.models import (  # noqa: E402
    AdminAuditLog,
    Customer,
    Order,
    OrderItem,
    Product,
    ProductVariant,
    Review,
    UserProfile,
)
from app.routes.admin import get_admin_review_photo, list_admin_reviews, update_admin_review  # noqa: E402
from app.routes.reviews import get_public_review_photo, list_published_reviews, submit_customer_review  # noqa: E402
from app.schemas import UpdateAdminReviewRequestSchema  # noqa: E402

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)
OBJECTS: dict[str, bytes] = {}


def _store(*, user_id: str, review_id: str, photo_id: str, content: bytes, mime_type: str, **_: object) -> str:
    path = f"{user_id}/{review_id}/{photo_id}.png"
    OBJECTS[path] = content
    return path


def _read(storage_path: str, **_: object) -> tuple[bytes, str]:
    return OBJECTS[storage_path], "image/png"


def _delete(storage_paths: list[str], **_: object) -> None:
    for path in storage_paths:
        OBJECTS.pop(path, None)


def upload(name: str = "photo.png", data: bytes = PNG, content_type: str = "image/png") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


class ReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        db_session.configure_database("sqlite:///:memory:")

    def setUp(self) -> None:
        from app.db.models import Base

        OBJECTS.clear()
        Base.metadata.drop_all(bind=db_session.engine)
        Base.metadata.create_all(bind=db_session.engine)
        patches = [
            patch("app.routes.reviews.store_private_review_photo", side_effect=_store),
            patch("app.routes.common.read_private_review_photo", side_effect=_read),
            patch("app.routes.reviews.delete_private_review_photos", side_effect=_delete),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _world(self, db, *, status: str = "DELIVERED", n_orders: int = 1):
        admin = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
        buyer = UserProfile(email="buyer@example.test", full_name="Hetal Patel", role="CUSTOMER")
        stranger = UserProfile(email="stranger@example.test", full_name="Other", role="CUSTOMER")
        product = Product(slug="faki", name="Faki", category="Faki")
        db.add_all([admin, buyer, stranger, product])
        db.flush()
        customer = Customer(user_id=buyer.id, full_name="Hetal Patel", phone="+919876543210")
        variant = ProductVariant(product_id=product.id, pack_size="500g", sku="FAKI-REVIEW-TEST", price_paise=50000)
        db.add_all([customer, variant])
        db.flush()
        orders = []
        for index in range(n_orders):
            order = Order(
                order_number=f"#BFP-REVIEW-{index}",
                user_id=buyer.id,
                customer_id=customer.id,
                status=status,
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
                order_id=order.id, product_id=product.id, variant_id=variant.id, product_slug="faki",
                product_name="Faki", pack_size="500g", quantity=1, unit_price_paise=50000, line_total_paise=50000,
            ))
            orders.append(order)
        db.commit()

        def principal(user: UserProfile, role: str = "CUSTOMER") -> AuthenticatedPrincipal:
            return AuthenticatedPrincipal(user.id, user.email, user.full_name, "", role, True)

        return orders, principal(buyer), principal(stranger), principal(admin, "OWNER_ADMIN")

    def test_delivered_order_review_is_auto_published_with_private_photos(self) -> None:
        with db_session.SessionLocal() as db:
            (order,), buyer, stranger, _admin = self._world(db)
            with self.assertRaises(HTTPException) as foreign:
                submit_customer_review(order.id, 5, "Fresh packing and quick delivery.", [], stranger, db)
            self.assertEqual(foreign.exception.status_code, 403)

            submitted = submit_customer_review(
                order.id, 5, "  Fresh packing and a smooth delivery experience.  ", [upload("a.png"), upload("b.png")], buyer, db
            )
            self.assertTrue(submitted["verifiedPurchase"])
            self.assertEqual(len(submitted["photoUrls"]), 2)
            self.assertTrue(all(url.startswith("/api/reviews/photos/") for url in submitted["photoUrls"]))
            self.assertEqual(len(OBJECTS), 2)  # stored in (mock) private storage
            review = db.scalar(select(Review))
            self.assertEqual(review.moderation_status, "PUBLISHED")
            self.assertEqual(review.review_text, "Fresh packing and a smooth delivery experience.")
            self.assertEqual(
                db.scalar(select(AdminAuditLog).where(AdminAuditLog.action == "REVIEW_SUBMITTED")).actor_id, buyer.id
            )

            listing = list_published_reviews(db=db, sort="newest")
            self.assertEqual(listing["total"], 1)
            self.assertEqual(listing["items"][0]["customerName"], "Hetal P.")
            self.assertEqual(listing["summary"], {"average": 5.0, "count": 1, "distribution": {"1": 0, "2": 0, "3": 0, "4": 0, "5": 1}})

            with self.assertRaises(HTTPException) as duplicate:
                submit_customer_review(order.id, 4, "Another review for the same delivered order.", [], buyer, db)
            self.assertEqual(duplicate.exception.status_code, 409)

    def test_validation_and_eligibility(self) -> None:
        with db_session.SessionLocal() as db:
            (order,), buyer, _stranger, _admin = self._world(db, status="SHIPPED")
            with self.assertRaises(HTTPException) as early:
                submit_customer_review(order.id, 5, "Not delivered yet but writing already.", [], buyer, db)
            self.assertEqual(early.exception.status_code, 409)
            order.status = "DELIVERED"
            db.commit()
            for bad_rating in (0, 6):
                with self.assertRaises(HTTPException) as rating_error:
                    submit_customer_review(order.id, bad_rating, "A perfectly long enough review.", [], buyer, db)
                self.assertEqual(rating_error.exception.status_code, 422)
            with self.assertRaises(HTTPException) as short:
                submit_customer_review(order.id, 5, "too short", [], buyer, db)
            self.assertEqual(short.exception.status_code, 422)
            with self.assertRaises(HTTPException) as padded:  # trimmed before the length check
                submit_customer_review(order.id, 5, "   short   ", [], buyer, db)
            self.assertEqual(padded.exception.status_code, 422)
            with self.assertRaises(HTTPException) as too_many:
                submit_customer_review(order.id, 5, "A perfectly long enough review.", [upload() for _ in range(6)], buyer, db)
            self.assertEqual(too_many.exception.status_code, 422)
            big = PNG + b"\x00" * int(2.5 * 1024 * 1024)  # each photo is under the limit, together they exceed 4 MB (the host's request cap)
            with self.assertRaises(HTTPException) as too_big_together:
                submit_customer_review(order.id, 5, "A perfectly long enough review.", [upload("a.png", big), upload("b.png", big)], buyer, db)
            self.assertEqual(too_big_together.exception.status_code, 422)
            self.assertIn("together", too_big_together.exception.detail)
            with self.assertRaises(HTTPException) as not_image:
                submit_customer_review(
                    order.id, 5, "A perfectly long enough review.", [upload("x.png", b"not an image")], buyer, db
                )
            self.assertEqual(not_image.exception.status_code, 422)
            self.assertIsNone(db.scalar(select(Review)))
            self.assertEqual(OBJECTS, {})

    def test_hidden_reviews_leave_public_numbers_but_stay_in_admin_and_audit(self) -> None:
        with db_session.SessionLocal() as db:
            orders, buyer, _stranger, admin = self._world(db, n_orders=3)
            ratings = (1, 3, 5)
            for order, stars in zip(orders, ratings):
                submit_customer_review(order.id, stars, f"Genuine {stars}-star feedback text.", [upload()] if stars == 1 else [], buyer, db)

            public = list_published_reviews(db=db, sort="lowest")
            self.assertEqual([item["rating"] for item in public["items"]], [1, 3, 5])  # negative reviews stay visible
            self.assertEqual(public["summary"]["average"], 3.0)
            self.assertEqual([item["rating"] for item in list_published_reviews(db=db, sort="highest")["items"]], [5, 3, 1])

            spam_id = db.scalar(select(Review.id).where(Review.rating == 3))
            with self.assertRaises(HTTPException) as no_reason:
                update_admin_review(spam_id, UpdateAdminReviewRequestSchema(moderationStatus="HIDDEN"), admin, db)
            self.assertEqual(no_reason.exception.status_code, 422)
            hidden = update_admin_review(
                spam_id,
                UpdateAdminReviewRequestSchema(moderationStatus="HIDDEN", moderationReason="Contains a phone number"),
                admin,
                db,
            )
            self.assertEqual(hidden["moderationStatus"], "HIDDEN")
            self.assertEqual(hidden["moderationReason"], "Contains a phone number")

            public = list_published_reviews(db=db, sort="newest")
            self.assertEqual(public["total"], 2)
            self.assertEqual(public["summary"]["count"], 2)
            self.assertEqual(public["summary"]["average"], 3.0)  # (1 + 5) / 2: the hidden 3-star no longer counts
            self.assertEqual(list_admin_reviews(admin, db)["total"], 3)  # preserved for admin
            audit = db.scalars(select(AdminAuditLog).where(AdminAuditLog.action == "REVIEW_MODERATED")).all()
            self.assertEqual(len(audit), 1)
            self.assertIn("Contains a phone number", audit[0].new_state)

            restored = update_admin_review(spam_id, UpdateAdminReviewRequestSchema(moderationStatus="PUBLISHED"), admin, db)
            self.assertIsNone(restored["moderationReason"])
            self.assertEqual(list_published_reviews(db=db, sort="newest")["total"], 3)

    def test_photo_access_public_only_while_published_admin_via_signed_url(self) -> None:
        with db_session.SessionLocal() as db:
            (order,), buyer, _stranger, admin = self._world(db)
            review = submit_customer_review(order.id, 2, "Packaging was damaged on arrival.", [upload()], buyer, db)
            photo_id = review["photoUrls"][0].rsplit("/", 1)[1]

            response = get_public_review_photo(photo_id, db)
            self.assertEqual(response.body, PNG)
            self.assertIn("public", response.headers["cache-control"])

            update_admin_review(
                review["id"],
                UpdateAdminReviewRequestSchema(moderationStatus="HIDDEN", moderationReason="Private information"),
                admin,
                db,
            )
            with self.assertRaises(HTTPException) as hidden_public:
                get_public_review_photo(photo_id, db)
            self.assertEqual(hidden_public.exception.status_code, 404)

            admin_view = next(item for item in list_admin_reviews(admin, db)["items"])
            signed = admin_view["photoUrls"][0]
            self.assertIn("/api/admin/reviews/photos/", signed)
            query = dict(part.split("=") for part in signed.split("?", 1)[1].split("&"))
            ok = get_admin_review_photo(photo_id, sig=query["sig"], exp=int(query["exp"]), authorization=None, db=db)
            self.assertEqual(ok.body, PNG)
            self.assertIn("no-store", ok.headers["cache-control"])
            with self.assertRaises(HTTPException) as tampered:
                get_admin_review_photo(photo_id, sig="0" * 64, exp=int(query["exp"]), authorization=None, db=db)
            self.assertEqual(tampered.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
