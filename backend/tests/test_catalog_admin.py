"""Product details and Price Management: partial updates must never clear prices or re-enable variants."""

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
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session
from app.core.security import AuthenticatedPrincipal
from app.db.models import AdminAuditLog, Product, ProductImage, ProductVariant, UserProfile
from app.db.seed import seed_development_data
from app.main import get_public_product, list_admin_products, list_public_products, update_admin_product
from app.schemas import UpdateAdminProductRequestSchema

ADMIN: AuthenticatedPrincipal


def patch_body(**body) -> UpdateAdminProductRequestSchema:
    return UpdateAdminProductRequestSchema.model_validate(body)


class CatalogAdminTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)
        global ADMIN
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            owner = UserProfile(email="owner@example.test", full_name="Owner", role="OWNER_ADMIN")
            db.add(owner)
            db.commit()
            ADMIN = AuthenticatedPrincipal(owner.id, owner.email, owner.full_name, "", "OWNER_ADMIN", True)

    def variant(self, db, sku: str) -> ProductVariant:
        return db.scalar(select(ProductVariant).where(ProductVariant.sku == sku))

    def test_public_product_details_include_facts_images_price_status_and_rating(self) -> None:
        with db_session.SessionLocal() as db:
            faki = db.scalar(select(Product).where(Product.slug == "faki"))
            faki.shelf_life = "Test-confirmed shelf life."
            faki.packaging = "Test-confirmed packaging."
            faki.safety_disclosures = "Test-confirmed disclosure."
            db.add(ProductImage(product_id=faki.id, storage_path="faki/front.png", alt_text="Front of pack", position=2))
            db.commit()

            detail = get_public_product("faki", db)
            self.assertEqual(detail["information"]["shelfLife"], "Test-confirmed shelf life.")
            self.assertEqual(detail["information"]["packaging"], "Test-confirmed packaging.")
            self.assertEqual(detail["information"]["safetyDisclosures"], "Test-confirmed disclosure.")
            self.assertEqual(detail["information"]["ingredients"], "")  # not supplied -> empty, never invented
            # Seeded Faki gallery: the two bundled packet photographs (front first), then a Storage-backed image.
            self.assertEqual([i["url"] for i in detail["images"][:2]], ["/images/products/balaji-faki-packet-front.webp", "/images/products/balaji-faki-packet-back.webp"])
            self.assertEqual([i["alt"] for i in detail["images"]], ["Faki packet, front", "Faki packet, back", "Front of pack"])
            self.assertTrue(detail["images"][2]["url"].endswith("/product-images/faki/front.png"))
            self.assertEqual(detail["priceConfirmed"], {"250g": False, "500g": False, "1kg": True})
            self.assertEqual(detail["prices"]["1kg"], 1000)
            self.assertIsNone(detail["averageRating"])
            self.assertEqual(detail["reviewCount"], 0)
            self.assertEqual([p["type"] for p in list_public_products(db)], ["faki", "supari", "mitho-mavo", "water"])
            with self.assertRaises(HTTPException) as missing:
                get_public_product("unknown", db)
            self.assertEqual(missing.exception.status_code, 404)

    def test_partial_update_never_clears_price_or_reenables_variant(self) -> None:
        with db_session.SessionLocal() as db:
            sold_out = self.variant(db, "BFP-FAKI-500G")
            sold_out.is_available = False
            db.commit()

            update_admin_product("faki", patch_body(variants=[{"packSize": "500g", "availableQuantity": 7}]), ADMIN, db)
            db.refresh(sold_out)
            self.assertEqual(sold_out.price_paise, 50000)  # omitted price unchanged
            self.assertEqual(sold_out.cost_price_paise, 18000)  # omitted cost unchanged
            self.assertFalse(sold_out.is_available)  # omitted availability unchanged
            self.assertEqual(sold_out.total_stock, 7)

            update_admin_product("faki", patch_body(description="Owner supplied copy."), ADMIN, db)
            self.assertEqual(self.variant(db, "BFP-FAKI-1KG").price_paise, 100000)
            self.assertTrue(self.variant(db, "BFP-FAKI-1KG").price_confirmed)

    def test_price_change_resets_approval_and_affects_only_future_orders(self) -> None:
        with db_session.SessionLocal() as db:
            update_admin_product("faki", patch_body(variants=[{"packSize": "1kg", "price": 1100}]), ADMIN, db)
            one_kg = self.variant(db, "BFP-FAKI-1KG")
            self.assertEqual(one_kg.price_paise, 110000)
            self.assertFalse(one_kg.price_confirmed)

            update_admin_product("faki", patch_body(variants=[{"packSize": "1kg", "priceConfirmed": True}]), ADMIN, db)
            self.assertTrue(self.variant(db, "BFP-FAKI-1KG").price_confirmed)

            # Re-sending the same price does not reset approval.
            update_admin_product("faki", patch_body(variants=[{"packSize": "1kg", "price": 1100}]), ADMIN, db)
            self.assertTrue(self.variant(db, "BFP-FAKI-1KG").price_confirmed)

            # Explicit null clears; confirming a missing price is refused.
            update_admin_product("faki", patch_body(variants=[{"packSize": "250g", "price": None}]), ADMIN, db)
            self.assertIsNone(self.variant(db, "BFP-FAKI-250G").price_paise)
            with self.assertRaises(HTTPException) as unpriced:
                update_admin_product("faki", patch_body(variants=[{"packSize": "250g", "priceConfirmed": True}]), ADMIN, db)
            self.assertEqual(unpriced.exception.status_code, 422)
            with self.assertRaises(HTTPException) as negative:
                update_admin_product("faki", patch_body(variants=[{"packSize": "500g", "price": -1}]), ADMIN, db)
            self.assertEqual(negative.exception.status_code, 422)

            audit = db.scalars(select(AdminAuditLog).where(AdminAuditLog.action == "PRODUCT_PRICES_UPDATED")).all()
            self.assertGreaterEqual(len(audit), 3)
            self.assertTrue(all(row.previous_state for row in audit))

    def test_information_fields_update_independently(self) -> None:
        with db_session.SessionLocal() as db:
            update_admin_product("supari", patch_body(information={"ingredients": " Test ingredients ", "shelfLife": "6 months"}), ADMIN, db)
            update_admin_product("supari", patch_body(information={"packaging": "Pouch"}), ADMIN, db)
            product = next(p for p in list_admin_products(ADMIN, db) if p["type"] == "supari")
            self.assertEqual(product["information"]["ingredients"], "Test ingredients")
            self.assertEqual(product["information"]["shelfLife"], "6 months")
            self.assertEqual(product["information"]["packaging"], "Pouch")
            update_admin_product("supari", patch_body(information={"ingredients": ""}), ADMIN, db)
            product = next(p for p in list_admin_products(ADMIN, db) if p["type"] == "supari")
            self.assertEqual(product["information"]["ingredients"], "")  # explicit blank clears one field only
            self.assertEqual(product["information"]["packaging"], "Pouch")


if __name__ == "__main__":
    unittest.main()
