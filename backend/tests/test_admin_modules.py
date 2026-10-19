"""Admin inventory, customers (read-only), settings, catalogue images and the shop payment QR."""

from __future__ import annotations

import io
import os
import sys
import unittest
from dataclasses import replace
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

import app.db.session as db_session
import app.main as main_module
from app.core.security import AuthenticatedPrincipal
from app.db.models import AdminAuditLog, Customer, InventoryMovement, Order, ProductVariant, StoreSettings, UserProfile
from app.db.seed import seed_development_data
from app.schemas import (
    ConfirmBusinessSettingsRequestSchema,
    StockAdjustmentRequestSchema,
    UpdateAdminSettingsRequestSchema,
)

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)
OBJECTS: dict[tuple[str, str], bytes] = {}


def _put(bucket: str, path: str, content: bytes, mime_type: str, **_: object) -> None:
    OBJECTS[(bucket, path)] = content


def _get(bucket: str, path: str, **_: object) -> tuple[bytes, str]:
    return OBJECTS[(bucket, path)], "image/png"


def _delete(bucket: str, paths: list[str], **_: object) -> None:
    for path in paths:
        OBJECTS.pop((bucket, path), None)


def upload(name: str = "x.png", data: bytes = PNG, content_type: str = "image/png") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=name, headers=Headers({"content-type": content_type}))


def settings_patch(**body) -> UpdateAdminSettingsRequestSchema:
    return UpdateAdminSettingsRequestSchema.model_validate(body)


class AdminModuleTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        OBJECTS.clear()
        for target, fake in (
            ("app.main.put_storage_object", _put),
            ("app.main.get_storage_object", _get),
            ("app.main.delete_storage_objects", _delete),
        ):
            p = patch(target, side_effect=fake)
            p.start()
            self.addCleanup(p.stop)
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            db.add(owner)
            db.commit()
            self.admin = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)

    # ---------------------------------------------------------------- inventory
    def test_inventory_lists_stock_and_adjustments_respect_reservations(self) -> None:
        with db_session.SessionLocal() as db:
            variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-250G"))
            variant.reserved_stock = 45
            db.commit()

            inventory = main_module.get_admin_inventory(self.admin, db)
            self.assertEqual(len(inventory["items"]), 6)
            item = next(i for i in inventory["items"] if i["sku"] == "BFP-FAKI-250G")
            self.assertEqual((item["totalStock"], item["reservedStock"], item["availableStock"]), (50, 45, 5))
            self.assertTrue(item["isLowStock"])  # 5 <= threshold 10
            self.assertEqual(inventory["summary"]["lowStockAlertsCount"], 1)

            with self.assertRaises(HTTPException) as too_many:
                main_module.create_admin_stock_adjustment(
                    StockAdjustmentRequestSchema(inventoryItemId=variant.id, adjustmentType="DEDUCT", quantity=6, reason="Damaged stock"),
                    self.admin,
                    db,
                )
            self.assertEqual(too_many.exception.status_code, 409)

            movement = main_module.create_admin_stock_adjustment(
                StockAdjustmentRequestSchema(inventoryItemId=variant.id, adjustmentType="ADD", quantity=20, reason="New batch received"),
                self.admin,
                db,
            )
            self.assertEqual((movement["movementType"], movement["quantityDelta"]), ("MANUAL_ADD", 20))
            self.assertEqual((movement["previousAvailable"], movement["newAvailable"]), (5, 25))
            main_module.create_admin_stock_adjustment(
                StockAdjustmentRequestSchema(inventoryItemId=variant.id, adjustmentType="DEDUCT", quantity=25, reason="Spoilage write-off"),
                self.admin,
                db,
            )
            db.refresh(variant)
            self.assertEqual((variant.total_stock, variant.reserved_stock), (45, 45))
            self.assertEqual(db.scalars(select(InventoryMovement)).all().__len__(), 2)
            self.assertEqual(len(db.scalars(select(AdminAuditLog).where(AdminAuditLog.action == "STOCK_ADJUSTED")).all()), 2)
            with self.assertRaises(HTTPException) as unknown:
                main_module.create_admin_stock_adjustment(
                    StockAdjustmentRequestSchema(inventoryItemId="nope", adjustmentType="ADD", quantity=1, reason="No such item"),
                    self.admin,
                    db,
                )
            self.assertEqual(unknown.exception.status_code, 404)

    # ---------------------------------------------------------------- customers
    def test_customers_are_read_only_searchable_and_filterable(self) -> None:
        with db_session.SessionLocal() as db:
            buyer = UserProfile(email="rahul@example.test", full_name="Rahul Mehta")
            db.add(buyer)
            db.flush()
            repeat = Customer(user_id=buyer.id, full_name="Rahul Mehta", phone="+919825011223", email="rahul@example.test", area="Rajkot", order_count=3, total_spent_paise=250000)
            fresh = Customer(full_name="Priya Shah", phone="+919825099887", area="Morbi", order_count=0)
            waiting = Customer(full_name="Hetal Patel", phone="+919825055555", area="Rajkot", order_count=1, total_spent_paise=50000)
            db.add_all([repeat, fresh, waiting])
            db.flush()
            db.add(Order(
                order_number="#BFP-9001", user_id=buyer.id, customer_id=waiting.id, status="PAYMENT_REVIEW",
                payment_status="SUBMITTED", total_paise=50000, subtotal_paise=50000, delivery_fee_paise=0,
                shipping_name="Hetal", shipping_phone="+919825055555", shipping_address="Rajkot",
                shipping_area="Rajkot", shipping_pin_code="360001",
            ))
            db.commit()

            everyone = main_module.list_admin_customers(None, None, None, 1, 20, self.admin, db)
            self.assertEqual(everyone["total"], 3)
            by_name = {row["name"]: row for row in everyone["items"]}
            self.assertEqual(by_name["Rahul Mehta"]["status"], "Repeat")
            self.assertEqual(by_name["Rahul Mehta"]["totalSpent"], 2500)
            self.assertEqual(by_name["Priya Shah"]["status"], "New")
            self.assertEqual(by_name["Hetal Patel"]["status"], "Pending payment")
            self.assertEqual(by_name["Rahul Mehta"]["initials"], "RM")

            self.assertEqual(main_module.list_admin_customers("priya", None, None, 1, 20, self.admin, db)["total"], 1)
            self.assertEqual(main_module.list_admin_customers("982505", None, None, 1, 20, self.admin, db)["total"], 1)
            self.assertEqual(main_module.list_admin_customers(None, "rajkot", None, 1, 20, self.admin, db)["total"], 2)
            self.assertEqual(main_module.list_admin_customers(None, None, "pending", 1, 20, self.admin, db)["total"], 1)
            paged = main_module.list_admin_customers(None, None, None, 2, 2, self.admin, db)
            self.assertEqual((paged["total"], len(paged["items"]), paged["totalPages"]), (3, 1, 2))

            detail = main_module.get_admin_customer(waiting.id, self.admin, db)
            self.assertEqual(detail["orderHistory"][0]["orderNumber"], "#BFP-9001")
            with self.assertRaises(HTTPException) as missing:
                main_module.get_admin_customer("nope", self.admin, db)
            self.assertEqual(missing.exception.status_code, 404)

    # ---------------------------------------------------------------- settings
    def test_settings_partial_update_and_business_confirmation_lifecycle(self) -> None:
        with db_session.SessionLocal() as db:
            current = main_module.get_admin_settings(self.admin, db)
            self.assertTrue(current["paymentIsLocalTest"])
            self.assertIsNone(current["businessSettingsConfirmedAt"])
            self.assertEqual(current["supportEmail"], "")

            # LOCAL TEST payment details cannot be confirmed.
            with self.assertRaises(HTTPException) as local_test:
                main_module.confirm_business_settings(ConfirmBusinessSettingsRequestSchema(confirm=True), self.admin, db)
            self.assertEqual(local_test.exception.status_code, 422)

            for bad in ({"officialUpiId": "not a upi"}, {"serviceablePinCodes": ["123"]}, {"serviceablePinCodes": ["360001", "360001"]}, {"supportEmail": "nope"}, {"supportWhatsapp": "12"}):
                with self.assertRaises(HTTPException, msg=str(bad)) as invalid:
                    main_module.update_admin_settings(settings_patch(**bad), self.admin, db)
                self.assertEqual(invalid.exception.status_code, 422)
            with self.assertRaises(HTTPException) as empty:
                main_module.update_admin_settings(settings_patch(), self.admin, db)
            self.assertEqual(empty.exception.status_code, 400)

            updated = main_module.update_admin_settings(
                settings_patch(shopIntro="  Owner written introduction.  ", supportEmail="shop@example.test", productionInfo=""), self.admin, db
            )
            self.assertEqual(updated["shopIntro"], "Owner written introduction.")
            self.assertEqual(updated["supportEmail"], "shop@example.test")
            self.assertEqual(updated["storeName"], "Balaji Faki Point")  # untouched

            main_module.update_admin_settings(
                settings_patch(officialUpiId="shopname@examplebank", officialPayeeName="Shop Name", deliveryCharges=40, serviceablePinCodes=["360005", "360001"]),
                self.admin,
                db,
            )
            with self.assertRaises(HTTPException) as no_qr:
                main_module.confirm_business_settings(ConfirmBusinessSettingsRequestSchema(confirm=True), self.admin, db)
            self.assertIn("QR", no_qr.exception.detail)

            with_qr = main_module.upload_payment_qr(upload(), self.admin, db)
            self.assertTrue(with_qr["officialUpiQrImageUrl"].startswith("/api/admin/settings/qr?sig="))
            self.assertEqual(len(OBJECTS), 1)
            confirmed = main_module.confirm_business_settings(ConfirmBusinessSettingsRequestSchema(confirm=True, note="Checked with bank"), self.admin, db)
            self.assertIsNotNone(confirmed["businessSettingsConfirmedAt"])
            self.assertFalse(confirmed["paymentIsLocalTest"])

            # Non-payment edits keep the confirmation; payment/delivery/PIN edits withdraw it.
            kept = main_module.update_admin_settings(settings_patch(tagline="Fresh daily"), self.admin, db)
            self.assertIsNotNone(kept["businessSettingsConfirmedAt"])
            withdrawn = main_module.update_admin_settings(settings_patch(deliveryCharges=50), self.admin, db)
            self.assertIsNone(withdrawn["businessSettingsConfirmedAt"])
            self.assertEqual(withdrawn["deliveryCharges"], 50)
            main_module.confirm_business_settings(ConfirmBusinessSettingsRequestSchema(confirm=True), self.admin, db)
            replaced = main_module.update_admin_settings(settings_patch(serviceablePinCodes=["360005"]), self.admin, db)
            self.assertIsNone(replaced["businessSettingsConfirmedAt"])

            # Replacing the QR removes the old object and withdraws confirmation.
            main_module.confirm_business_settings(ConfirmBusinessSettingsRequestSchema(confirm=True), self.admin, db)
            main_module.upload_payment_qr(upload("second.png"), self.admin, db)
            self.assertEqual(len(OBJECTS), 1)
            self.assertIsNone(main_module.get_admin_settings(self.admin, db)["businessSettingsConfirmedAt"])

            actions = {row.action for row in db.scalars(select(AdminAuditLog)).all()}
            self.assertTrue({"SETTINGS_UPDATED", "BUSINESS_SETTINGS_CONFIRMED", "PAYMENT_QR_REPLACED"} <= actions)
            with self.assertRaises(HTTPException) as bad_qr:
                main_module.upload_payment_qr(upload("bad.png", b"not an image"), self.admin, db)
            self.assertEqual(bad_qr.exception.status_code, 422)

    def test_ordering_opens_outside_local_mode_only_after_confirmation(self) -> None:
        with db_session.SessionLocal() as db:
            store = db.get(StoreSettings, 1)
            confirmed_variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-1KG"))
            dev_variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == "BFP-FAKI-500G"))
            original = main_module.settings
            try:
                main_module.settings = replace(original, app_env="production")
                with self.assertRaises(HTTPException):
                    main_module._assert_ordering_open(confirmed_variant, store)  # prices ok, shop settings unconfirmed
                store.business_settings_confirmed_at = main_module.utcnow()
                main_module._assert_ordering_open(confirmed_variant, store)
                with self.assertRaises(HTTPException):
                    main_module._assert_ordering_open(dev_variant, store)  # development price not approved
            finally:
                main_module.settings = original

    # ---------------------------------------------------------------- QR + images
    def test_order_payment_qr_is_only_available_through_a_signed_link(self) -> None:
        with db_session.SessionLocal() as db:
            main_module.upload_payment_qr(upload(), self.admin, db)
            store = db.get(StoreSettings, 1)
            link = main_module._signed_payment_qr_path("order-1", store)
            query = dict(part.split("=") for part in link.split("?", 1)[1].split("&"))
            ok = main_module.get_order_payment_qr("order-1", sig=query["sig"], exp=int(query["exp"]), db=db)
            self.assertEqual(ok.body, PNG)
            self.assertIn("no-store", ok.headers["cache-control"])
            for other_order, sig in (("order-2", query["sig"]), ("order-1", "0" * 64), ("order-1", None)):
                with self.assertRaises(HTTPException) as denied:
                    main_module.get_order_payment_qr(other_order, sig=sig, exp=int(query["exp"]), db=db)
                self.assertEqual(denied.exception.status_code, 401)

    def test_product_and_shop_images(self) -> None:
        with db_session.SessionLocal() as db:
            product = main_module.add_admin_product_image("faki", upload(), "Front of the pack", self.admin, db)
            self.assertEqual(len(product["images"]), 1)
            self.assertEqual(product["images"][0]["alt"], "Front of the pack")
            image_id = product["images"][0]["id"]
            self.assertEqual(len([key for key in OBJECTS if key[0] == "product-images"]), 1)

            with self.assertRaises(HTTPException) as bad:
                main_module.add_admin_product_image("faki", upload("a.txt", b"hello", "text/plain"), "", self.admin, db)
            self.assertEqual(bad.exception.status_code, 422)
            for _ in range(9):
                main_module.add_admin_product_image("faki", upload(), "", self.admin, db)
            with self.assertRaises(HTTPException) as full:
                main_module.add_admin_product_image("faki", upload(), "", self.admin, db)
            self.assertEqual(full.exception.status_code, 409)

            removed = main_module.delete_admin_product_image("faki", image_id, self.admin, db)
            self.assertEqual(len(removed["images"]), 9)
            self.assertEqual(len([key for key in OBJECTS if key[0] == "product-images"]), 9)
            with self.assertRaises(HTTPException) as missing:
                main_module.delete_admin_product_image("faki", image_id, self.admin, db)
            self.assertEqual(missing.exception.status_code, 404)

            settings_after = main_module.add_admin_store_photo(upload(), "Shop front", self.admin, db)
            self.assertEqual(settings_after["photos"][0]["caption"], "Shop front")
            self.assertEqual(main_module.get_public_store_profile(db)["photos"][0]["caption"], "Shop front")
            photo_id = settings_after["photos"][0]["id"]
            self.assertEqual(main_module.delete_admin_store_photo(photo_id, self.admin, db)["photos"], [])


if __name__ == "__main__":
    unittest.main()
