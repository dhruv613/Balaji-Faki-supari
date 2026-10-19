"""Explicit DEVELOPMENT data initialisation. Request handlers must never import or call this module.

Usage (local stack only):
    python -m app.db.seed --dev                # store settings row + Faki/Supari products and variants
    python -m app.db.seed --dev --dev-admin    # additionally create a local Owner Admin in local Supabase Auth

Rules:
* Only Faki 1 kg = Rs 1,000 is an owner-confirmed price. Every other price below is DEVELOPMENT DATA
  (`price_confirmed = false`) until the owner approves it in Price Management.
* Existing rows are never overwritten: an admin-cleared price stays cleared.
* Payment details are LOCAL TEST values, not a real receiving account.
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Product, ProductImage, ProductVariant, StoreSettings

LOCAL_TEST_UPI_ID = "local-test@upi"
LOCAL_TEST_PAYEE = "LOCAL TEST - do not pay"
DEV_SERVICEABLE_PINS = ["360001", "360002", "360003", "360004", "360005", "360006", "360007"]

# (pack_size, sku, cost_paise, price_paise, stock, price_confirmed)
INITIAL_PRODUCTS = (
    {
        "slug": "faki",
        "name": "Faki",
        "name_gu": "ફાકી",
        "category": "Faki",
        "description": "",
        "image_url": "/images/products/balaji-faki-packet-front.webp",
        # Bundled gallery (front, back). Alt text only describes the photo: no weight, ingredients or claims.
        "images": (
            ("/images/products/balaji-faki-packet-front.webp", "Faki packet, front"),
            ("/images/products/balaji-faki-packet-back.webp", "Faki packet, back"),
        ),
        "variants": (
            ("250g", "BFP-FAKI-250G", 10000, 25000, 50, False),
            ("500g", "BFP-FAKI-500G", 18000, 50000, 50, False),
            ("1kg", "BFP-FAKI-1KG", 35000, 100000, 50, True),
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
            ("250g", "BFP-SUPARI-250G", 9000, 20000, 50, False),
            ("500g", "BFP-SUPARI-500G", 18000, 40000, 50, False),
            ("1kg", "BFP-SUPARI-1KG", 36000, 80000, 50, False),
        ),
    },
)


def seed_development_data(db: Session, *, with_default_prices: bool = True) -> None:
    """Creates MISSING store settings, products and variants. Never updates or restores existing rows."""
    if db.get(StoreSettings, 1) is None:
        db.add(
            StoreSettings(
                id=1,
                store_name="Balaji Faki Point",
                store_name_gu="બાલાજી ફાકી પોઈન્ટ",
                store_address="Riddhi Siddhi Complex, University Rd., nr. Bhagat Singh Garden, Rajkot, Gujarat 360005",
                opening_hours="Call the store to confirm opening hours",
                upi_payee_name=LOCAL_TEST_PAYEE,
                upi_id=LOCAL_TEST_UPI_ID,
                qr_code_storage_path=None,
                delivery_charge_paise=0,
                free_delivery_threshold_paise=0,
                serviceable_pin_codes=list(DEV_SERVICEABLE_PINS),
                low_stock_default_threshold=10,
                stock_reservation_expiry_minutes=30,
            )
        )
        db.flush()

    store = db.get(StoreSettings, 1)
    if store is not None and not store.upi_id and not store.upi_payee_name:
        # The migration creates the settings row without a payment destination: give it explicit LOCAL TEST values.
        store.upi_id = LOCAL_TEST_UPI_ID
        store.upi_payee_name = LOCAL_TEST_PAYEE
        if not store.serviceable_pin_codes or store.serviceable_pin_codes == []:
            store.serviceable_pin_codes = list(DEV_SERVICEABLE_PINS)
        if store.delivery_charge_paise is None:
            store.delivery_charge_paise = 0

    for spec in INITIAL_PRODUCTS:
        product = db.scalar(select(Product).where(Product.slug == spec["slug"]))
        if product is None:
            product = Product(
                slug=spec["slug"],
                name=spec["name"],
                name_gu=spec["name_gu"],
                category=spec["category"],
                description=spec["description"],
                image_url=spec["image_url"],
                is_active=True,
            )
            db.add(product)
            db.flush()
            for position, (path, alt) in enumerate(spec.get("images", ())):  # new products only: admin edits are never undone
                db.add(ProductImage(product_id=product.id, storage_path=path, alt_text=alt, position=position))
        for pack_size, sku, cost_paise, price_paise, stock, confirmed in spec["variants"]:
            existing = db.scalar(select(ProductVariant).where(ProductVariant.sku == sku))
            if existing is not None:
                # Rows created by the schema migration are pristine (no price, cost or stock). The explicit dev command may
                # give those development values; anything an admin has touched is never overwritten.
                pristine = (
                    existing.price_paise is None and existing.cost_price_paise is None
                    and int(existing.total_stock) == 0 and not existing.price_confirmed
                )
                if pristine and with_default_prices:
                    existing.cost_price_paise = cost_paise
                    existing.price_paise = price_paise
                    existing.price_confirmed = bool(confirmed)
                    existing.total_stock = stock
                continue
            db.add(
                ProductVariant(
                    product_id=product.id,
                    pack_size=pack_size,
                    sku=sku,
                    cost_price_paise=cost_paise if with_default_prices else None,
                    price_paise=price_paise if with_default_prices else None,
                    price_confirmed=bool(confirmed and with_default_prices),
                    is_available=True,
                    total_stock=stock,
                    reserved_stock=0,
                    low_stock_threshold=10,
                )
            )
    db.commit()


# --------------------------------------------------------------------------------------------------
# CLI (local only)
# --------------------------------------------------------------------------------------------------
_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def _require_local(url: str, label: str) -> None:
    host = urlparse(url.replace("postgresql+psycopg://", "postgresql://", 1)).hostname
    if url.startswith("sqlite"):
        return
    if host not in _LOCAL_HOSTS:
        raise SystemExit(f"REFUSED: {label} is not a local address; nothing was changed.")


def create_dev_admin(supabase_url: str, secret_key: str, db: Session) -> Path:
    """Creates (or reuses) a LOCAL Owner Admin through the local Supabase Auth admin API.

    Credentials are written to a gitignored file and never printed.
    """
    import httpx

    _require_local(supabase_url, "SUPABASE_URL")
    if not secret_key:
        raise SystemExit("BLOCKED: SUPABASE_SECRET_KEY (local) is not configured.")
    creds_path = Path(__file__).resolve().parents[3] / ".local-dev-credentials.json"
    email = "owner@local.test"
    password = secrets.token_urlsafe(18)
    response = httpx.post(
        f"{supabase_url.rstrip('/')}/auth/v1/admin/users",
        headers={"apikey": secret_key, "Authorization": f"Bearer {secret_key}"},
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "app_metadata": {"role": "OWNER_ADMIN"},
            "user_metadata": {"fullName": "Local Owner", "phone": "+919999900000"},
        },
        timeout=15,
    )
    if response.status_code not in (200, 201):
        raise SystemExit(f"Local Auth refused admin creation (HTTP {response.status_code}); it may already exist.")
    creds_path.write_text(json.dumps({"email": email, "password": password}), encoding="utf-8")
    return creds_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dev", action="store_true", required=True, help="acknowledge this writes development data")
    parser.add_argument("--dev-admin", action="store_true", help="also create a local Owner Admin in local Supabase Auth")
    args = parser.parse_args(argv)

    from ..core.config import settings
    from .session import SessionLocal, engine, init_db, resolve_database_url

    _require_local(resolve_database_url(), "DATABASE_URL")
    init_db(engine)
    with SessionLocal() as db:
        seed_development_data(db)
        print("Development catalogue and store settings are present (existing rows untouched).")
        if args.dev_admin:
            path = create_dev_admin(settings.supabase_url, settings.supabase_secret_key, db)
            print(f"Local Owner Admin created; credentials saved to {path.name} (gitignored, not printed).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
