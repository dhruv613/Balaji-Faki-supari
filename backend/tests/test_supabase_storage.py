"""Focused checks for the private local Supabase Storage payment-proof adapter."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings
from app.core.storage import PaymentProofStorageError, read_private_payment_proof, store_private_payment_proof


VALID_PNG = b"\x89PNG\r\n\x1a\n" + b"test-image-bytes"


def storage_settings(secret: str = "local-test-service-key") -> Settings:
    return Settings(supabase_url="http://127.0.0.1:55321", supabase_secret_key=secret)


class SupabaseStorageTests(unittest.TestCase):
    def test_upload_uses_the_private_payment_proofs_bucket(self) -> None:
        request = httpx.Request("POST", "http://127.0.0.1:55321/storage/v1/object/payment-proofs/user/order/proof.png")
        with patch("app.core.storage.httpx.request", return_value=httpx.Response(200, request=request)) as send:
            storage_path = store_private_payment_proof(
                user_id="user",
                order_id="order",
                payment_id="proof",
                content=VALID_PNG,
                mime_type="image/png",
                app_settings=storage_settings(),
            )

        self.assertEqual(storage_path, "user/order/proof.png")
        method, url = send.call_args.args[:2]
        self.assertEqual(method, "POST")
        self.assertEqual(url, "http://127.0.0.1:55321/storage/v1/object/payment-proofs/user/order/proof.png")
        self.assertEqual(send.call_args.kwargs["headers"]["x-upsert"], "false")
        self.assertEqual(send.call_args.kwargs["headers"]["Authorization"], "Bearer local-test-service-key")

    def test_read_uses_the_private_bucket_and_detects_the_image_type(self) -> None:
        request = httpx.Request("GET", "http://127.0.0.1:55321/storage/v1/object/payment-proofs/user/order/proof.png")
        with patch("app.core.storage.httpx.request", return_value=httpx.Response(200, content=VALID_PNG, request=request)) as send:
            content, mime = read_private_payment_proof("user/order/proof.png", app_settings=storage_settings())

        self.assertEqual(content, VALID_PNG)
        self.assertEqual(mime, "image/png")
        self.assertEqual(send.call_args.args[:2], ("GET", "http://127.0.0.1:55321/storage/v1/object/payment-proofs/user/order/proof.png"))

    def test_missing_service_key_blocks_storage_access(self) -> None:
        with self.assertRaises(PaymentProofStorageError):
            store_private_payment_proof(
                user_id="user",
                order_id="order",
                payment_id="proof",
                content=VALID_PNG,
                mime_type="image/png",
                app_settings=storage_settings(""),
            )

    def test_missing_object_is_not_reported_as_a_success(self) -> None:
        request = httpx.Request("GET", "http://127.0.0.1:55321/storage/v1/object/payment-proofs/user/order/missing.png")
        with patch("app.core.storage.httpx.request", return_value=httpx.Response(404, request=request)):
            with self.assertRaises(FileNotFoundError):
                read_private_payment_proof("user/order/missing.png", app_settings=storage_settings())


if __name__ == "__main__":
    unittest.main()
