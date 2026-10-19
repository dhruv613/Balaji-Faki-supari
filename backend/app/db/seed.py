"""Idempotent catalog and store settings seed matching 20261017000000_balaji_faki_point_schema.sql."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Product, ProductVariant, StoreSettings

INITIAL_PRODUCTS = (
    {
        "slug": "faki",
        "name": "Faki",
        "name_gu": "ફાકી",
        "category": "Faki",
        "description": "",
        "image_url": "/images/hero-product.jpg",
        "variants": (
            ("250g", "BFP-FAKI-250G", 10000, 25000, 50),
            ("500g", "BFP-FAKI-500G", 18000, 50000, 50),
            ("1kg", "BFP-FAKI-1KG", 35000, 100000, 50),
        ),
    },
    {
        "slug": "supari",
        "name": "Supari",
        "name_gu": "સુપારી",
        "category": "Supari",
        "description": "",
        "image_url": "/images/supari-reference.png",
        "variants": (
            ("250g", "BFP-SUPARI-250G", 9000, 20000, 50),
            ("500g", "BFP-SUPARI-500G", 18000, 40000, 50),
            ("1kg", "BFP-SUPARI-1KG", 36000, 80000, 50),
        ),
    },
)


def ensure_catalog_seeded(db: Session, *, with_default_prices: bool = True) -> None:
    """Ensures `faki` and `supari` products, pack variants, and singleton `store_settings` exist."""
    settings_row = db.get(StoreSettings, 1)
    if settings_row is None:
        settings_row = StoreSettings(
            id=1,
            store_name="Balaji Faki Point",
            store_name_gu="બાલાજી ફાકી પોઈન્ટ",
            store_address="Riddhi Siddhi Complex, University Rd., nr. Bhagat Singh Garden, Rajkot, Gujarat 360005",
            opening_hours="Call the store to confirm opening hours",
            upi_payee_name="Balaji Faki Point",
            upi_id="8000961030@okbizaxis",
            qr_code_storage_path=None,
            delivery_charge_paise=0,
            free_delivery_threshold_paise=0,
            serviceable_pin_codes_json='["360001","360002","360003","360004","360005","360006","360007"]',
            low_stock_default_threshold=10,
            stock_reservation_expiry_minutes=30,
        )
        db.add(settings_row)
        db.flush()
    else:
        # Move the existing public page's confirmed location into the canonical settings row.
        if settings_row.store_address == "Rajkot, Gujarat":
            settings_row.store_address = "Riddhi Siddhi Complex, University Rd., nr. Bhagat Singh Garden, Rajkot, Gujarat 360005"
        if settings_row.opening_hours == "9:00 AM – 9:00 PM":
            settings_row.opening_hours = "Call the store to confirm opening hours"

    for p_spec in INITIAL_PRODUCTS:
        product = db.scalar(select(Product).where(Product.slug == p_spec["slug"]))
        if product is None:
            product = Product(
                slug=p_spec["slug"],
                name=p_spec["name"],
                name_gu=p_spec["name_gu"],
                category=p_spec["category"],
                description=p_spec["description"],
                image_url=p_spec["image_url"],
                is_active=True,
            )
            db.add(product)
            db.flush()
        elif (
            (p_spec["slug"] == "faki" and product.description == "Signature freshly blended Kathiyawadi Faki prepared with traditional spices.")
            or (p_spec["slug"] == "supari" and product.description == "Cleaned, aromatic roasted Supari cut and packed for consistent freshness.")
        ):
            # Replace only the old bundled copy; store-authored product data remains untouched.
            product.name = p_spec["name"]
            product.name_gu = p_spec["name_gu"]
            product.category = p_spec["category"]
            product.description = p_spec["description"]

        for pack_size, sku, cost_paise, price_paise, stock in p_spec["variants"]:
            variant = db.scalar(select(ProductVariant).where(ProductVariant.sku == sku))
            if variant is None:
                variant = ProductVariant(
                    product_id=product.id,
                    pack_size=pack_size,
                    sku=sku,
                    cost_price_paise=cost_paise if with_default_prices else None,
                    price_paise=price_paise if with_default_prices else None,
                    is_available=True,
                    total_stock=stock,
                    reserved_stock=0,
                    low_stock_threshold=10,
                )
                db.add(variant)
            elif with_default_prices and variant.price_paise is None:
                # Temporary local prices fill only missing values; Owner Admin edits remain authoritative.
                variant.cost_price_paise = cost_paise
                variant.price_paise = price_paise
                variant.is_available = True

    db.commit()
