"""Neon Auth and Object Storage require server configuration."""

from __future__ import annotations

import os
import sys
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import app.routes.common as common
import app.routes.public as public


class NeonHealthTests(unittest.TestCase):
    def test_neon_checks_auth_aws_credentials_and_signing(self) -> None:
        configured = replace(
            public.settings, app_env="production", neon_auth_base_url="https://auth.neon.example/db/auth",
            neon_auth_jwks_url="https://auth.neon.example/db/auth/.well-known/jwks.json", proof_signing_secret="test-proof-secret",
        )
        with patch.object(public, "settings", configured), patch.dict(os.environ, {
            "AWS_ENDPOINT_URL_S3": "https://branch.storage.neon.tech",
            "AWS_ACCESS_KEY_ID": "test-access", "AWS_SECRET_ACCESS_KEY": "test-secret", "AWS_REGION": "us-east-1",
        }):
            self.assertEqual(public._missing_config(), [])
            with patch.dict(os.environ, {"AWS_SECRET_ACCESS_KEY": "", "AWS_REGION": ""}):
                self.assertEqual(public._missing_config(), ["AWS_SECRET_ACCESS_KEY", "AWS_REGION"])
            with patch.object(public, "settings", replace(configured, proof_signing_secret="")):
                self.assertEqual(public._missing_config(), ["PROOF_SIGNING_SECRET"])

    def test_catalogue_serializer_uses_presigned_url_and_preserves_bundled_images(self) -> None:
        with patch.dict(os.environ, {"AWS_ENDPOINT_URL_S3": "https://branch.storage.neon.tech"}):
            with patch.object(common, "create_catalogue_image_url", return_value="https://storage/image?signature=test") as presign:
                self.assertEqual(common._product_image_url("product/photo.png"), "https://storage/image?signature=test")
                presign.assert_called_once_with(common.settings.product_images_bucket, "product/photo.png")
                self.assertEqual(common._product_image_url("/images/bundled.png"), "/images/bundled.png")


if __name__ == "__main__":
    unittest.main()
