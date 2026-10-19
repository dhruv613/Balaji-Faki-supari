"""Mitho Mavo and Water are ordinary catalogue products: own pack sizes, own images, orderable like Faki and Supari."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["BFP_ENV"] = "local"

import app.db.session as db_session
from app.db.seed import seed_development_data
from app.main import _pack_sort_key, create_checkout_quote, get_public_product, list_public_products
from app.schemas import CheckoutQuoteRequestSchema


def quote(product: str, pack: str, db, quantity: int = 1):
    return create_checkout_quote(
        CheckoutQuoteRequestSchema(product=product, packSize=pack, quantity=quantity, pinCode="360005"), db
    )


class CatalogProductsTests(unittest.TestCase):
    def setUp(self) -> None:
        db_session.Base.metadata.drop_all(bind=db_session.engine)
        db_session.Base.metadata.create_all(bind=db_session.engine)

    def test_pack_sizes_sort_by_quantity_not_text(self) -> None:
        self.assertEqual(sorted(["1kg", "500g", "250g"], key=_pack_sort_key), ["250g", "500g", "1kg"])
        self.assertEqual(sorted(["1l", "500ml"], key=_pack_sort_key), ["500ml", "1l"])

    def test_each_product_exposes_only_its_own_pack_sizes_images_and_unconfirmed_prices(self) -> None:
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            products = {p["type"]: p for p in list_public_products(db)}
            self.assertEqual(list(products), ["faki", "supari", "mitho-mavo", "water", "chuno", "tamaku"])  # newest product last
            self.assertEqual(products["mitho-mavo"]["packSizes"], ["250g", "500g", "1kg"])
            self.assertEqual(products["water"]["packSizes"], ["1l"])
            self.assertEqual(list(products["water"]["prices"]), ["1l"])
            self.assertEqual(products["water"]["priceConfirmed"], {"1l": False})  # development placeholder, not owner-approved
            self.assertEqual(products["mitho-mavo"]["description"], "No Tobacco Faki (Sadi Faki)")
            self.assertEqual(products["mitho-mavo"]["imageUrl"], "/images/products/balaji-mitho-mavo-sachet.webp")
            self.assertEqual(
                [i["url"] for i in get_public_product("water", db)["images"]],
                ["/images/products/balaji-water-bottle.webp", "/images/products/balaji-water-label.jpg"],
            )
            # Faki: real photos (box first, banner last). Supari: its bowl photo first, then the arecanut packet photos.
            self.assertEqual([i["url"] for i in get_public_product("faki", db)["images"]], ["/images/products/balaji-faki-box.webp", "/images/products/balaji-faki-bundle.jpg", "/images/products/balaji-faki-banner.jpg"])
            self.assertEqual([i["url"] for i in get_public_product("supari", db)["images"]], ["/images/supari-reference.png", "/images/products/balaji-supari-packet-front.webp", "/images/products/balaji-supari-packet-back.webp"])
            # Faki and Supari keep their pack sizes.
            self.assertEqual(products["faki"]["packSizes"], ["250g", "500g", "1kg"])
            self.assertEqual(products["supari"]["imageUrl"], "/images/supari-reference.png")
            self.assertEqual(products["faki"]["information"]["ingredients"], "")  # nothing invented for any product
            self.assertEqual(products["water"]["information"]["ingredients"], "")
            self.assertEqual(products["chuno"]["packSizes"], ["250g", "500g", "1kg"])
            self.assertEqual(products["chuno"]["description"], "")  # nothing invented for Chuno either
            self.assertEqual(products["tamaku"]["category"], "Tobacco")
            self.assertEqual(products["tamaku"]["description"], "")
            self.assertEqual(products["tamaku"]["priceConfirmed"], {"250g": False, "500g": False, "1kg": False})
            self.assertEqual(
                [i["url"] for i in get_public_product("tamaku", db)["images"]],
                ["/images/products/balaji-tamaku-sachets.webp", "/images/products/balaji-tamaku-banner.jpg"],
            )
            self.assertEqual(products["chuno"]["information"]["ingredients"], "")
            self.assertEqual(products["chuno"]["priceConfirmed"], {"250g": False, "500g": False, "1kg": False})
            self.assertEqual(
                [i["url"] for i in get_public_product("chuno", db)["images"]],
                ["/images/products/balaji-chuno-sachets.webp", "/images/products/balaji-chuno-banner-parcel.jpg", "/images/products/balaji-chuno-banner-sachet.jpg"],
            )

    def test_new_products_are_orderable_and_unknown_combinations_are_refused(self) -> None:
        with db_session.SessionLocal() as db:
            seed_development_data(db)
            self.assertEqual(quote("water", "1l", db, quantity=3)["subtotal"], 60)
            self.assertEqual(quote("mitho-mavo", "500g", db)["subtotal"], 300)
            for product, pack in (("water", "250g"), ("mitho-mavo", "1l")):  # valid format, but not that product's pack
                with self.assertRaises(HTTPException) as refused:
                    quote(product, pack, db)
                self.assertEqual(refused.exception.status_code, 400)
            with self.assertRaises(HTTPException) as unknown:
                quote("juice", "1l", db)
            self.assertEqual(unknown.exception.status_code, 404)

    def test_malformed_slug_or_pack_size_is_rejected_by_the_schema(self) -> None:
        for product, pack in (("Water", "1l"), ("water", "1 L"), ("water", "one litre"), ("../x", "1l")):
            with self.assertRaises(ValidationError, msg=(product, pack)):
                CheckoutQuoteRequestSchema(product=product, packSize=pack, quantity=1, pinCode="360005")


if __name__ == "__main__":
    unittest.main()
