"""Apply the standalone baseline to the linked Neon database; never import Supabase data.

Usage: python scripts/setup-neon-db.py --project-id spring-mode-09495880 --branch production
Reads the direct DATABASE_URL_UNPOOLED from Neon CLI's root environment file.
Another branch: neon env pull --branch dev --file .env.neon-dev, then add --branch dev --env-file .env.neon-dev
(only that file is read, and its NEON_BRANCH must equal --branch).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.core.config import _load_dotenv_file


def read_env_file(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def direct_neon_url(value: str) -> str:
    parsed = urlparse(value)
    hostname = parsed.hostname or ""
    if parsed.scheme not in {"postgres", "postgresql"} or not hostname.endswith(".neon.tech"):
        raise ValueError("DATABASE_URL_UNPOOLED must be a Neon PostgreSQL connection string.")
    if "-pooler." in hostname:
        raise ValueError("Migrations require the direct DATABASE_URL_UNPOOLED, not a pooler.")
    if not parsed.password or not parsed.path.strip("/"):
        raise ValueError("DATABASE_URL_UNPOOLED must include credentials and a database name.")
    return value


def apply_migrations(url: str) -> None:
    with psycopg.connect(url, prepare_threshold=None, connect_timeout=15) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set local lock_timeout = '10s'")
            cursor.execute("set local statement_timeout = '60s'")
            cursor.execute("select pg_advisory_xact_lock(hashtext('balaji-neon-migrations'))")
            cursor.execute("select to_regclass('private.neon_schema_migrations')")
            if cursor.fetchone()[0] is None:
                cursor.execute(
                    "select table_name from information_schema.tables "
                    "where table_schema = 'public' and table_type = 'BASE TABLE' limit 1"
                )
                if cursor.fetchone():
                    raise ValueError("Refusing to baseline an existing untracked database. No changes applied.")
                cursor.execute("create schema if not exists private")
                cursor.execute("revoke all on schema private from public")
                cursor.execute(
                    "create table private.neon_schema_migrations ("
                    "name text primary key, sha256 text not null, "
                    "applied_at timestamptz not null default now())"
                )
                cursor.execute("revoke all on table private.neon_schema_migrations from public")
            for path in sorted((ROOT / "backend/migrations/neon").glob("[0-9]*.sql")):
                sql = path.read_text(encoding="utf-8")
                # read_text() turns CRLF into LF, so the fingerprint is the same on Windows and Linux checkouts.
                digest = hashlib.sha256(sql.encode("utf-8")).hexdigest()
                cursor.execute("select sha256 from private.neon_schema_migrations where name = %s", (path.name,))
                applied = cursor.fetchone()
                if applied:
                    if applied[0] != digest:
                        raise ValueError(f"Applied migration {path.name} changed; restore it and add a new migration.")
                    print(f"Already applied: {path.name}")
                    continue
                cursor.execute(sql, prepare=False)
                cursor.execute(
                    "insert into private.neon_schema_migrations (name, sha256) values (%s, %s)",
                    (path.name, digest),
                )
                print(f"Applied: {path.name}")
    print("Neon schema and public catalogue committed successfully.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--branch", required=True)
    parser.add_argument("--env-file", help="read the connection only from this file (from `neon env pull --file`)")
    args = parser.parse_args()
    if args.env_file:
        # Parsed directly: os.environ already holds the linked branch's settings from the backend config import.
        values = read_env_file(ROOT / args.env_file)
        if values.get("NEON_BRANCH") != args.branch:
            raise ValueError("The env file's NEON_BRANCH does not match --branch. No changes applied.")
        apply_migrations(direct_neon_url(values.get("DATABASE_URL_UNPOOLED", "")))
        return 0
    linked = json.loads((ROOT / ".neon").read_text(encoding="utf-8"))
    if linked.get("projectId") != args.project_id or linked.get("branch") != args.branch:
        raise ValueError("The linked .neon target does not match the requested project and branch.")
    _load_dotenv_file(ROOT / ".env.local")
    _load_dotenv_file(ROOT / ".env")
    apply_migrations(direct_neon_url(os.environ.get("DATABASE_URL_UNPOOLED", "")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, psycopg.Error) as exc:
        # Connection errors may contain credentials, so never echo their raw message.
        detail = str(exc) if isinstance(exc, ValueError) else f"{type(exc).__name__} (SQLSTATE {getattr(exc, 'sqlstate', None) or 'unavailable'})"
        print(f"Neon setup failed: {detail}", file=sys.stderr)
        raise SystemExit(1)
