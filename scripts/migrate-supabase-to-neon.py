"""Back up and migrate the linked app's public records and uploaded files without changing Supabase.

Default is export-only. Stop writes to the old app before adding --apply --source-is-quiesced.
Backups contain customer data and belong only in the gitignored .migration-backups directory.
"""

from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import httpx
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PROJECT = "zyzkoolgwbczvvetjnwf"
TARGET_PROJECT = "spring-mode-09495880"
TABLES = (
    "user_profiles", "customers", "products", "product_variants", "orders", "order_items",
    "payment_attempts", "bank_credits", "order_status_history", "inventory_movements", "shipments",
    "delivery_events", "reviews", "cancellation_requests", "refunds", "notifications", "store_settings",
    "admin_audit_logs", "review_photos", "product_images", "store_photos",
)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def write_backup(path: Path, value: object) -> str:
    data = canonical(value)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    return hashlib.sha256(data).hexdigest()


def supabase_command() -> list[str]:
    executable = shutil.which("supabase")
    if executable and Path(executable).suffix.lower() not in {".cmd", ".bat", ".ps1"}:
        return [executable]
    cache = Path(os.environ.get("LOCALAPPDATA", "")) / "npm-cache/_npx"
    candidates = list(cache.glob("*/node_modules/supabase/dist/supabase.js")) if cache.is_dir() else []
    if not candidates:
        raise ValueError("Install and authenticate the Supabase CLI before exporting.")
    return [shutil.which("node") or "node", str(max(candidates, key=lambda p: p.stat().st_mtime))]


def cli_json(arguments: list[str]) -> object:
    result = subprocess.run(
        supabase_command() + arguments, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    if result.returncode:
        raise ValueError(f"Supabase read-only command failed (exit {result.returncode}); output suppressed to protect records and secrets.")
    # CLI status text may precede JSON; database result strings remain untrusted data.
    output = result.stdout.strip()
    starts = [index for index in (output.find("{"), output.find("[")) if index >= 0]
    if not starts:
        raise ValueError("Supabase CLI returned no JSON; output suppressed.")
    try:
        return json.loads(output[min(starts):])
    except json.JSONDecodeError:
        raise ValueError("Supabase CLI returned invalid JSON; output suppressed.") from None


def snapshot_sql(*, storage: bool) -> str:
    table_values = ",".join(f"'{table}',coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.{table} t),'[]'::jsonb)" for table in TABLES)
    names = ",".join(f"'{table}'" for table in TABLES)
    objects = "coalesce((select jsonb_agg(to_jsonb(o) order by bucket_id,name) from storage.objects o),'[]'::jsonb)" if storage else "'[]'::jsonb"
    return f"""select jsonb_build_object(
      'tables',jsonb_build_object({table_values}),
      'columns',(select jsonb_agg(jsonb_build_object('table',table_name,'name',column_name,'type',data_type,
        'generated',is_generated,'nullable',is_nullable,'default',column_default) order by table_name,ordinal_position)
        from information_schema.columns where table_schema='public' and table_name in ({names})),
      'public_tables',(select jsonb_agg(table_name order by table_name) from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE'),
      'objects',{objects}) as snapshot"""


def source_snapshot() -> dict:
    result = cli_json(["db", "query", "--linked", "--project-ref", SOURCE_PROJECT, "--output", "json", snapshot_sql(storage=True)])
    try:
        snapshot = result["rows"][0]["snapshot"]
    except (KeyError, IndexError, TypeError):
        raise ValueError("Unexpected Supabase snapshot format; raw records suppressed.") from None
    if set(snapshot["public_tables"]) != set(TABLES):
        raise ValueError("Source public tables differ from the reviewed 21-table inventory; review before exporting.")
    if any("password" in column["name"].lower() for column in snapshot["columns"]):
        raise ValueError("A password column exists in the public schema; refusing to export it.")
    return snapshot


def target_snapshot(cursor) -> dict:
    cursor.execute(snapshot_sql(storage=False))
    snapshot = cursor.fetchone()[0]
    if set(snapshot["public_tables"]) != set(TABLES):
        raise ValueError("Target public tables differ from the reviewed 21-table schema.")
    return snapshot


def source_columns(snapshot: dict, table: str) -> list[dict]:
    return [column for column in snapshot["columns"] if column["table"] == table and column["generated"] == "NEVER"]


def canonical_rows(snapshot: dict, table: str, columns: list[dict]) -> list[dict]:
    result = []
    for row in snapshot["tables"][table]:
        values = {}
        for column in columns:
            value = row[column["name"]]
            if value is not None and column["type"].startswith("timestamp"):
                instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if instant.tzinfo is not None:
                    instant = instant.astimezone(timezone.utc)
                value = instant.isoformat(timespec="microseconds")
            values[column["name"]] = value
        result.append(values)
    return sorted(result, key=lambda row: str(row["id"]))


def table_hashes(snapshot: dict, reference: dict) -> dict[str, str]:
    return {table: digest(canonical_rows(snapshot, table, source_columns(reference, table))) for table in TABLES}


def validate_columns(source: dict, target: dict) -> None:
    for table in TABLES:
        source_names = {column["name"] for column in source_columns(source, table)}
        target_columns = {column["name"]: column for column in source_columns(target, table)}
        missing = source_names - set(target_columns)
        if missing:
            raise ValueError(f"Target lacks source columns in {table}: {', '.join(sorted(missing))}; nothing discarded.")
        required = {name for name, column in target_columns.items() if column["nullable"] == "NO" and column["default"] is None}
        if required - source_names:
            raise ValueError(f"Target has required extra columns in {table}; review before import.")


def assert_bootstrap(snapshot: dict) -> None:
    """Only the exact six-product bootstrap may be replaced; never overwrite customer or owner changes."""
    sys.path.insert(0, str(ROOT / "backend"))
    from app.db.seed import INITIAL_PRODUCTS

    tables = snapshot["tables"]
    for table in TABLES:
        if table not in {"products", "product_variants", "product_images", "store_settings"} and tables[table]:
            raise ValueError(f"Target {table} contains existing records; refusing to replace a non-bootstrap database.")
    expected = {product["slug"]: product for product in INITIAL_PRODUCTS}
    products = {row["id"]: row for row in tables["products"]}
    if len(products) != len(expected) or {row["slug"] for row in products.values()} != set(expected):
        raise ValueError("Target catalogue differs from the six-product bootstrap.")
    facts = ("ingredients", "popularity", "characteristics", "production_packaging", "provider_manufacturer", "safety_storage", "shelf_life", "packaging", "safety_disclosures")
    for row in products.values():
        baseline = expected[row["slug"]]
        if any(row[key] != baseline[key] for key in ("name", "name_gu", "category", "description", "image_url")) or not row["is_active"] or any(row[key] is not None for key in facts):
            raise ValueError("Target product was customized; no records replaced.")
    variants = {(product["slug"], pack, sku) for product in INITIAL_PRODUCTS for pack, sku, *_ in product["variants"]}
    actual_variants = {(products[row["product_id"]]["slug"], row["pack_size"], row["sku"]) for row in tables["product_variants"]}
    if actual_variants != variants or len(tables["product_variants"]) != len(variants):
        raise ValueError("Target variants differ from the bootstrap.")
    for row in tables["product_variants"]:
        if row["price_paise"] is not None or row["cost_price_paise"] is not None or row["price_confirmed"] or not row["is_available"] or row["total_stock"] != 0 or row["reserved_stock"] != 0 or row["low_stock_threshold"] != 10:
            raise ValueError("Target prices or stock were configured; no records replaced.")
    images = {(product["slug"], path, alt, position) for product in INITIAL_PRODUCTS for position, (path, alt) in enumerate(product["images"])}
    actual_images = {(products[row["product_id"]]["slug"], row["storage_path"], row["alt_text"], row["position"]) for row in tables["product_images"]}
    if actual_images != images or len(tables["product_images"]) != len(images):
        raise ValueError("Target image gallery differs from the bootstrap.")
    baseline_store = {
        "id": 1, "store_name": "Balaji Faki Point", "store_name_gu": "બાલાજી ફાકી પોઈન્ટ",
        "tagline": "Freshly Prepared Faki & Supari", "support_phone": "+91 80009 61030", "support_whatsapp": "918000961030",
        "support_email": None, "store_address": "Rajkot, Gujarat", "opening_hours": "Call the store to confirm opening hours",
        "upi_payee_name": None, "upi_id": None, "qr_code_storage_path": None, "delivery_charge_paise": None,
        "free_delivery_threshold_paise": None, "serviceable_pin_codes": ["360001", "360002", "360004", "360005", "360007"],
        "low_stock_default_threshold": 10, "stock_reservation_expiry_minutes": 30, "updated_by": None,
        "shop_intro": None, "production_info": None, "provider_manufacturer": None, "packaging_info": None,
        "business_settings_confirmed_at": None, "business_settings_confirmed_by": None,
    }
    if len(tables["store_settings"]) != 1 or {key: value for key, value in tables["store_settings"][0].items() if key != "updated_at"} != baseline_store:
        raise ValueError("Target store settings were customized; no records replaced.")


def source_storage_key() -> str:
    payload = cli_json(["projects", "api-keys", "--project-ref", SOURCE_PROJECT, "--reveal", "--output", "json"])
    entries = payload if isinstance(payload, list) else payload.get("data", payload.get("api_keys", []))
    for entry in entries:
        if entry.get("name") == "service_role" and entry.get("api_key"):
            return entry["api_key"]
    raise ValueError("Source server-only storage key unavailable; no objects copied.")


def backup_objects(snapshot: dict, directory: Path) -> list[dict]:
    objects = snapshot["objects"]
    if not objects:
        return []
    secret = source_storage_key()
    (directory / "objects").mkdir()
    receipts = []
    seen = set()
    with httpx.Client(timeout=60, follow_redirects=False, headers={"Authorization": f"Bearer {secret}", "apikey": secret}) as client:
        for index, item in enumerate(objects):
            bucket, name = item["bucket_id"], item["name"]
            if not name or name.startswith("/") or not bucket or "/" in bucket:
                raise ValueError("Unsupported source object key; no files silently renamed.")
            key = f"{bucket}/{name}"
            if key in seen:
                raise ValueError("Duplicate source object key; no files overwritten.")
            seen.add(key)
            url = f"https://{SOURCE_PROJECT}.supabase.co/storage/v1/object/{quote(bucket, safe='')}/{quote(name, safe='/')}"
            response = client.get(url)
            if response.status_code != 200:
                raise ValueError(f"Source object download failed (HTTP {response.status_code}); object identifiers suppressed.")
            relative = f"objects/{index:08d}.bin"
            path = directory / relative
            temporary = path.with_suffix(".tmp")
            temporary.write_bytes(response.content)
            temporary.replace(path)
            receipts.append({"key": key, "file": relative, "bytes": len(response.content), "sha256": hashlib.sha256(response.content).hexdigest(), "content_type": response.headers.get("content-type", "application/octet-stream")})
    return receipts


def copy_objects(receipts: list[dict], directory: Path) -> None:
    if not receipts:
        return
    with closing(boto3.client("s3", endpoint_url=os.environ["AWS_ENDPOINT_URL_S3"], region_name=os.environ.get("AWS_REGION"), config=Config(signature_version="s3v4", s3={"addressing_style": "path"}, request_checksum_calculation="when_required", response_checksum_validation="when_required"))) as client:
        for receipt in receipts:
            body = (directory / receipt["file"]).read_bytes()
            if hashlib.sha256(body).hexdigest() != receipt["sha256"]:
                raise ValueError("A backed-up object changed; refusing to copy.")
            try:
                client.put_object(Bucket="assets", Key=receipt["key"], Body=body, ContentType=receipt["content_type"], IfNoneMatch="*")
            except ClientError as exc:
                if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 412:
                    raise
            result = client.get_object(Bucket="assets", Key=receipt["key"])
            with closing(result["Body"]) as stream:
                restored = stream.read()
            if hashlib.sha256(restored).hexdigest() != receipt["sha256"]:
                raise ValueError("An existing Neon object differs from its source; no overwrite attempted.")
            receipt["verified"] = True
            write_backup(directory / "objects-receipt.json", receipts)


def import_records(connection, source: dict, backed_up_target: dict) -> None:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("set local lock_timeout = '10s'")
            cursor.execute("set local statement_timeout = '120s'")
            cursor.execute(sql.SQL("lock table {} in share row exclusive mode").format(sql.SQL(",").join(sql.Identifier("public", table) for table in TABLES)))
            current = target_snapshot(cursor)
            if digest(current) != digest(backed_up_target):
                raise ValueError("Target changed after its backup; no records imported.")
            validate_columns(source, current)
            expected_hashes = table_hashes(source, source)
            if table_hashes(current, source) == expected_hashes:
                print("Target already matches the source snapshot; no database rows changed.")
                return
            assert_bootstrap(current)
            for table in reversed(TABLES):
                if current["tables"][table]:
                    cursor.execute(sql.SQL("delete from {}").format(sql.Identifier("public", table)))
            for table in TABLES:
                rows = source["tables"][table]
                if not rows:
                    continue
                columns = source_columns(source, table)
                names = sql.SQL(",").join(sql.Identifier(column["name"]) for column in columns)
                # Generated available_stock is deliberately omitted; PostgreSQL recomputes it.
                query = sql.SQL("insert into {table} ({columns}) select {columns} from jsonb_populate_recordset(null::{table}, %s::jsonb)").format(table=sql.Identifier("public", table), columns=names)
                cursor.execute(query, (Jsonb(rows),))
            restored = target_snapshot(cursor)
            if table_hashes(restored, source) != expected_hashes:
                raise ValueError("Imported row checksums differ from the source; the entire transaction is rolled back.")
    print("All 21 public tables committed; source row counts and canonical SHA-256 hashes match.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source-is-quiesced", action="store_true", help="Confirm writes to the old app have been stopped for the cutover.")
    args = parser.parse_args()
    if args.apply and not args.source_is_quiesced:
        raise ValueError("Stop writes to the old app, then use --apply --source-is-quiesced.")
    linked = json.loads((ROOT / ".neon").read_text(encoding="utf-8"))
    if linked.get("projectId") != TARGET_PROJECT or linked.get("branch") != "production":
        raise ValueError("The .neon link must point at the reviewed project production branch.")
    if subprocess.run(["git", "check-ignore", "--quiet", ".migration-backups/probe"], cwd=ROOT, capture_output=True).returncode != 0:
        raise ValueError("Add .migration-backups/ to .gitignore before exporting customer records.")
    spec = importlib.util.spec_from_file_location("neon_setup", ROOT / "scripts/setup-neon-db.py")
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    setup._load_dotenv_file(ROOT / ".env.local")
    setup._load_dotenv_file(ROOT / ".env")
    url = setup.direct_neon_url(os.environ.get("DATABASE_URL_UNPOOLED", ""))
    source = source_snapshot()
    directory = ROOT / ".migration-backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    directory.mkdir(parents=True)
    manifest = {"source_project": SOURCE_PROJECT, "target_project": TARGET_PROJECT, "target_branch": "production", "source_sha256": write_backup(directory / "source-public.json", source), "counts": {table: len(source["tables"][table]) for table in TABLES}}
    with psycopg.connect(url, autocommit=True, prepare_threshold=None, connect_timeout=20) as connection:
        with connection.cursor() as cursor:
            target = target_snapshot(cursor)
        manifest["target_backup_sha256"] = write_backup(directory / "target-public.json", target)
        validate_columns(source, target)
        manifest["source_table_hashes"] = table_hashes(source, source)
        objects = backup_objects(source, directory)
        write_backup(directory / "objects-receipt.json", objects)
        manifest["objects"] = len(objects)
        write_backup(directory / "manifest.json", manifest)
        print("Source counts: " + json.dumps(manifest["counts"], sort_keys=True))
        print(f"Source snapshot SHA-256: {manifest['source_sha256']}")
        print(f"Target backup SHA-256: {manifest['target_backup_sha256']}")
        print(f"Uploaded-file backups: {len(objects)}; backup directory: {directory.relative_to(ROOT)}")
        if not args.apply:
            print("Export-only completed. No Supabase or Neon records or objects changed.")
            return 0
        copy_objects(objects, directory)
        latest_source = source_snapshot()
        if table_hashes(latest_source, source) != manifest["source_table_hashes"] or digest(latest_source["objects"]) != digest(source["objects"]):
            raise ValueError("Source changed after export; no database import committed. Keep old-app writes stopped and retry.")
        import_records(connection, source, target)
        manifest["database_verified"] = True
        manifest["objects_verified"] = all(item.get("verified") for item in objects)
        write_backup(directory / "manifest.json", manifest)
    print(f"Migration verified: 21 tables, {len(objects)} uploaded files. Supabase remains untouched.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Raw database/HTTP/CLI exceptions may contain credentials, emails or object names.
        detail = str(exc) if type(exc) is ValueError else f"{type(exc).__name__}; sensitive details suppressed"
        print(f"Migration stopped: {detail}", file=sys.stderr)
        raise SystemExit(1)
