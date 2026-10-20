"""Neon storage keeps private namespaces, image checks, and conditional writes."""

from __future__ import annotations

import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError, EndpointConnectionError
from botocore.response import StreamingBody

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings
from app.core.storage import (
    CatalogImageStorageError,
    PaymentProofStorageError,
    ReviewPhotoStorageError,
    create_catalogue_image_url,
    delete_private_review_photos,
    delete_storage_objects,
    get_storage_object,
    put_storage_object,
    read_private_payment_proof,
    read_private_review_photo,
    store_private_payment_proof,
    store_private_review_photo,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"image-bytes"


class NeonStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        from app.core import storage as _storage
        _storage._cached_client.cache_clear()  # each test swaps boto3 for its own fake
        self.addCleanup(_storage._cached_client.cache_clear)
        env = patch.dict(os.environ, {
            "AWS_ENDPOINT_URL_S3": "https://branch.storage.neon.tech",
            "AWS_REGION": "us-east-1",
        })
        env.start()
        self.addCleanup(env.stop)
        self.client = MagicMock(spec=["put_object", "get_object", "delete_object", "generate_presigned_url", "close"])
        factory = patch("app.core.storage.boto3.client")
        self.factory = factory.start()
        self.factory.return_value = self.client
        self.addCleanup(factory.stop)
        self.settings = Settings()

    def test_namespaces_are_private_and_puts_cannot_overwrite(self) -> None:
        proof = store_private_payment_proof(
            user_id="user", order_id="order", payment_id="proof",
            content=PNG, mime_type="image/png", app_settings=self.settings,
        )
        self.assertEqual(proof, "user/order/proof.png")
        self.client.put_object.assert_called_with(
            Bucket="assets", Key="payment-proofs/user/order/proof.png",
            Body=PNG, ContentType="image/png", IfNoneMatch="*",
        )
        config = self.factory.call_args.kwargs["config"]
        self.assertEqual(config.signature_version, "s3v4")
        self.assertEqual(config.s3["addressing_style"], "path")

        photo = store_private_review_photo(
            user_id="user", review_id="review", photo_id="photo",
            content=PNG, mime_type="image/png", app_settings=self.settings,
        )
        self.assertEqual(photo, "user/review/photo.png")
        self.assertEqual(self.client.put_object.call_args.kwargs["Key"], "review-photos/" + photo)
        put_storage_object("product-images", "product/image.png", PNG, "image/png", app_settings=self.settings)
        self.assertEqual(self.client.put_object.call_args.kwargs["Key"], "product-images/product/image.png")
        self.assertEqual(self.factory.call_count, 1, "three uploads reuse one S3 client")
        self.client.close.assert_not_called()

    def test_read_checks_image_bytes_and_closes_stream(self) -> None:
        for read in (
            lambda: read_private_payment_proof("proof.png", app_settings=self.settings),
            lambda: read_private_review_photo("photo.png", app_settings=self.settings),
            lambda: get_storage_object("store-photos", "shop.png", app_settings=self.settings),
        ):
            body = io.BytesIO(PNG)
            self.client.get_object.return_value = {"Body": StreamingBody(body, len(PNG))}
            self.assertEqual(read(), (PNG, "image/png"))
            self.assertTrue(body.closed)
        self.client.get_object.return_value = {"Body": io.BytesIO(b"not an image")}
        with self.assertRaises(CatalogImageStorageError):
            get_storage_object("product-images", "bad.png", app_settings=self.settings)

    def test_missing_objects_are_404_but_service_errors_are_unavailable(self) -> None:
        self.client.get_object.side_effect = ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        with self.assertRaises(FileNotFoundError):
            read_private_payment_proof("missing.png", app_settings=self.settings)
        self.client.get_object.side_effect = ClientError({"Error": {"Code": "AccessDenied"}}, "GetObject")
        with self.assertRaises(PaymentProofStorageError):
            read_private_payment_proof("denied.png", app_settings=self.settings)
        self.client.put_object.side_effect = ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        with self.assertRaises(ReviewPhotoStorageError):
            store_private_review_photo(
                user_id="user", review_id="review", photo_id="photo",
                content=PNG, mime_type="image/png", app_settings=self.settings,
            )

    def test_cleanup_continues_after_storage_failure(self) -> None:
        self.client.delete_object.side_effect = [EndpointConnectionError(endpoint_url="https://unavailable"), {}]
        delete_private_review_photos(["first", "second"], app_settings=self.settings)
        self.assertEqual(self.client.delete_object.call_count, 2)
        self.client.delete_object.reset_mock(side_effect=True)
        delete_storage_objects("product-images", ["product/image.png"], app_settings=self.settings)
        self.client.delete_object.assert_called_once_with(Bucket="assets", Key="product-images/product/image.png")

    def test_only_catalogue_namespaces_can_be_presigned(self) -> None:
        self.client.generate_presigned_url.return_value = "https://storage/image?signature=example"
        self.assertEqual(
            create_catalogue_image_url("product-images", "product/image.png", app_settings=self.settings),
            "https://storage/image?signature=example",
        )
        self.client.generate_presigned_url.assert_called_once_with(
            "get_object", Params={"Bucket": "assets", "Key": "product-images/product/image.png"}, ExpiresIn=3600,
        )
        self.client.close.assert_not_called()  # one shared client per process, never closed per call
        with self.assertRaises(ValueError):
            create_catalogue_image_url("payment-proofs", "user/order/proof.png", app_settings=self.settings)

    def test_presigning_works_with_the_real_boto3_client_without_network(self) -> None:
        with patch.dict(os.environ, {"AWS_ACCESS_KEY_ID": "test-access", "AWS_SECRET_ACCESS_KEY": "test-secret"}):
            # Boto clients have close(), but do not implement the context manager protocol.
            import boto3
            with patch("app.core.storage.boto3.client", wraps=boto3.session.Session().client):
                url = create_catalogue_image_url("product-images", "product/image.png", app_settings=self.settings)
        self.assertTrue(url.startswith("https://branch.storage.neon.tech/assets/product-images/product/image.png?"))
        self.assertIn("X-Amz-Signature=", url)


if __name__ == "__main__":
    unittest.main()
