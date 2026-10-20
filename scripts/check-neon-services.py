"""Exercise the running app against Neon, then remove only this check's test data."""

from __future__ import annotations

import argparse
import base64
import os
from pathlib import Path
import sys
from urllib.parse import urlparse
import uuid

import httpx
from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.core.config import settings
from app.core.storage import CatalogImageStorageError, delete_storage_objects, get_storage_object, put_storage_object, validate_catalog_image
from app.db.models import StorePhoto
from app.db.session import SessionLocal


def check(api: str, frontend: str) -> None:
    assert (urlparse(settings.database_url).hostname or "").endswith(".neon.tech"), "The app must target Neon."
    endpoint = os.environ["AWS_ENDPOINT_URL_S3"].rstrip("/")
    photo_id = str(uuid.uuid4())
    path = f"verification/{photo_id}.png"
    image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJuQAAAAASUVORK5CYII=")
    validate_catalog_image(image, "image/png")
    with httpx.Client(timeout=30) as client:
        response = client.get(frontend)
        assert response.status_code == 200 and 'id="root"' in response.text
        print("PASS frontend: HTTP 200")
        health = client.get(f"{api}/health")
        assert health.status_code == 200 and health.json()["status"] == "ok"
        print("PASS API health: HTTP 200")
        products = client.get(f"{api}/products", headers={"Origin": frontend})
        products.raise_for_status()
        assert products.headers.get("access-control-allow-origin") == frontend
        assert len(products.json()) >= 6
        print(f"PASS Postgres through API: HTTP 200, {len(products.json())} products")
        try:
            put_storage_object(settings.store_photos_bucket, path, image, "image/png")
            try:
                put_storage_object(settings.store_photos_bucket, path, image + b"different", "image/png")
            except CatalogImageStorageError as exc:
                cause = exc.__cause__
                assert getattr(cause, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode") == 412, "Expected conditional-write rejection."
            else:
                raise AssertionError("Storage allowed an existing image to be overwritten.")
            assert get_storage_object(settings.store_photos_bucket, path) == (image, "image/png")
            print("PASS Object Storage: upload/read matched; duplicate write rejected (412)")
            private_read = client.get(f"{endpoint}/assets/{settings.store_photos_bucket}/{path}")
            assert private_read.status_code in (401, 403)
            print(f"PASS private bucket: unsigned download rejected ({private_read.status_code})")
            with SessionLocal() as db:
                taken = set(db.scalars(select(StorePhoto.position)).all())
                position = next(slot for slot in range(20) if slot not in taken)
                db.add(StorePhoto(id=photo_id, storage_path=path, caption="Neon verification", position=position))
                db.commit()
            store = client.get(f"{api}/store")
            store.raise_for_status()
            photo = next(item for item in store.json()["photos"] if item["id"] == photo_id)
            assert urlparse(photo["url"]).hostname == urlparse(endpoint).hostname
            downloaded = client.get(photo["url"])
            assert downloaded.status_code == 200 and downloaded.content == image
            assert downloaded.headers["content-type"].startswith("image/png")
            print("PASS end to end: app API read Neon row and returned a working signed image URL (HTTP 200)")
        finally:
            with SessionLocal() as db:
                db.execute(delete(StorePhoto).where(StorePhoto.id == photo_id))
                db.commit()
            delete_storage_objects(settings.store_photos_bucket, [path])
            with SessionLocal() as db:
                assert db.get(StorePhoto, photo_id) is None
            try:
                get_storage_object(settings.store_photos_bucket, path)
            except FileNotFoundError:
                pass
            else:
                raise AssertionError("Verification image was not removed.")
            print("PASS cleanup: verification row and object removed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8010/api")
    parser.add_argument("--frontend", default="http://127.0.0.1:5180")
    args = parser.parse_args()
    try:
        check(args.api.rstrip("/"), args.frontend)
    except Exception as exc:
        # HTTP/driver exceptions can include credential-bearing URLs.
        print(f"Neon verification FAILED: {type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
