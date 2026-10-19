"""Executable security assertions for the LOCAL Supabase Postgres.

Run after `supabase db reset` (local): python scripts/check-db-security.py
Refuses to run unless DATABASE_URL points at 127.0.0.1/localhost. Everything runs inside one transaction
that is rolled back, so no data is left behind. Secret values are never printed.
Private-data protection and intended public access are reported as separate groups.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

import psycopg

ROOT = Path(__file__).resolve().parents[1]
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def load_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        for env_file in (ROOT / "backend" / ".env", ROOT / ".env"):
            if env_file.is_file():
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    if line.startswith("DATABASE_URL="):
                        url = line.split("=", 1)[1].strip().strip("'\"")
                        break
            if url:
                break
    if not url:
        sys.exit("BLOCKED: DATABASE_URL is not set (local Supabase not configured).")
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    host = urlparse(url).hostname
    if host not in LOCAL_HOSTS:
        sys.exit("REFUSED: DATABASE_URL is not a local database; nothing was executed.")
    return url


results: list[tuple[str, str, str]] = []


def record(group: str, name: str, ok: bool, detail: str = "") -> None:
    results.append((group, name, "PASS" if ok else "FAIL" + (f" ({detail})" if detail else "")))


def attempt(conn: psycopg.Connection, sql: str, params: tuple = ()) -> tuple[bool, list | str]:
    """Run one statement under a savepoint. Returns (succeeded, rows-or-error-class)."""
    with conn.cursor() as cur:
        cur.execute("savepoint t")
        try:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
            cur.execute("release savepoint t")
            return True, rows
        except psycopg.Error as exc:
            cur.execute("rollback to savepoint t")
            return False, type(exc).__name__


def as_role(conn: psycopg.Connection, role: str, uid: str | None) -> None:
    claims = {"role": role}
    if uid:
        claims["sub"] = uid
    with conn.cursor() as cur:
        cur.execute("reset role")
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid or "",))
        cur.execute(f"set local role {role}")


def as_postgres(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("reset role")


def make_user(conn: psycopg.Connection, email: str, app_role: str | None = None) -> str:
    uid = str(uuid.uuid4())
    app_meta = json.dumps({"role": app_role} if app_role else {})
    with conn.cursor() as cur:
        cur.execute(
            "insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, "
            "created_at, updated_at) values (%s, '00000000-0000-0000-0000-000000000000', 'authenticated', "
            "'authenticated', %s, %s::jsonb, %s::jsonb, now(), now())",
            (uid, email, app_meta, json.dumps({"fullName": "Test User", "phone": "+919999999999"})),
        )
    return uid


def main() -> int:
    url = load_database_url()
    with psycopg.connect(url, autocommit=False) as conn:
        try:
            run_checks(conn)
        finally:
            conn.rollback()
    width = max(len(g) for g, _, _ in results)
    failed = 0
    for group, name, outcome in results:
        failed += outcome.startswith("FAIL")
        print(f"{group:<{width}}  {outcome.split(' ')[0]:<4}  {name}" + (f"  {outcome[4:]}" if outcome.startswith("FAIL") else ""))
    print(f"\n{len(results) - failed} passed, {failed} failed (transaction rolled back)")
    return 1 if failed else 0


def run_checks(conn: psycopg.Connection) -> None:
    P, PUB = "private-data", "public-access"
    cust = make_user(conn, f"cust-{uuid.uuid4().hex[:8]}@local.test")
    other = make_user(conn, f"other-{uuid.uuid4().hex[:8]}@local.test")
    admin = make_user(conn, f"admin-{uuid.uuid4().hex[:8]}@local.test", app_role="OWNER_ADMIN")

    # --- structure -------------------------------------------------------------------------------
    ok, rows = attempt(conn, "select 1 from information_schema.columns where table_schema='public' "
                             "and table_name='user_profiles' and column_name='password_hash'")
    record("structure", "no password_hash column", ok and not rows)
    ok, rows = attempt(conn, "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                             "where n.nspname='public' and proname in ('simple_auth_login','simple_auth_update_profile')")
    record("structure", "legacy password RPCs removed", ok and not rows)
    ok, rows = attempt(conn, "select policyname from pg_policies where schemaname='public' and policyname like '%simple_auth%'")
    record("structure", "no simple_auth policies", ok and not rows)
    ok, rows = attempt(conn, "select id, public from storage.buckets where id in "
                             "('payment-proofs','review-photos','payment-qr','product-images','store-photos')")
    buckets = dict(rows) if ok else {}
    record("structure", "private buckets are private",
           all(buckets.get(b) is False for b in ("payment-proofs", "review-photos", "payment-qr")), str(buckets))
    record("structure", "catalogue buckets are public", all(buckets.get(b) is True for b in ("product-images", "store-photos")))
    ok, rows = attempt(conn, "select 1 from pg_policies where schemaname='storage' and tablename='objects' "
                             "and policyname='payment_proofs_customer_upload_own_folder'")
    record("structure", "no direct customer upload policy", ok and not rows)

    # profiles created by the auth trigger
    ok, rows = attempt(conn, "select id::text, role from public.user_profiles where id in (%s,%s,%s)", (cust, other, admin))
    roles = dict(rows) if ok else {}
    record("structure", "auth trigger creates CUSTOMER profile", roles.get(cust) == "CUSTOMER")
    record("structure", "app_metadata OWNER_ADMIN seeds admin profile", roles.get(admin) == "OWNER_ADMIN")

    # seed minimal public data as postgres
    as_postgres(conn)
    with conn.cursor() as cur:
        cur.execute("insert into public.products (slug, name, category) values ('faki','Faki','Faki') "
                    "on conflict (slug) do nothing")
        cur.execute("select id from public.products where slug='faki'")
        pid = cur.fetchone()[0]
        cur.execute("insert into public.product_variants (product_id, pack_size, sku, cost_price_paise, price_paise, total_stock) "
                    "values (%s,'1kg','CHK-FAKI-1KG',60000,100000,5) on conflict (sku) do nothing", (pid,))
        cur.execute("insert into public.customers (user_id, full_name, phone) values (%s,'Test User','+919999999999') "
                    "on conflict (user_id) do nothing", (cust,))
        cur.execute("insert into public.customers (user_id, full_name, phone) values (%s,'Other','+919999999998') "
                    "on conflict (user_id) do nothing", (other,))

    # --- private data: anonymous ------------------------------------------------------------------
    as_role(conn, "anon", None)
    for table in ("user_profiles", "customers", "orders", "order_items", "payment_attempts", "bank_credits",
                  "inventory_movements", "admin_audit_logs", "refunds", "notifications", "shipments", "review_photos"):
        ok, _ = attempt(conn, f"select 1 from public.{table} limit 1")
        record(P, f"anon cannot read {table}", not ok)
    ok, _ = attempt(conn, "select cost_price_paise from public.product_variants limit 1")
    record(P, "anon cannot read variant cost price", not ok)
    ok, _ = attempt(conn, "select total_stock from public.product_variants limit 1")
    record(P, "anon cannot read variant stock", not ok)
    ok, _ = attempt(conn, "select upi_id from public.store_settings limit 1")
    record(P, "anon cannot read UPI id", not ok)
    ok, _ = attempt(conn, "select user_id from public.reviews limit 1")
    record(P, "anon cannot read reviewer identity", not ok)
    ok, _ = attempt(conn, "select moderation_reason from public.reviews limit 1")
    record(P, "anon cannot read moderation notes", not ok)
    ok, _ = attempt(conn, "insert into public.products (slug,name,category) values ('supari','x','x')")
    record(P, "anon cannot write products", not ok)
    ok, _ = attempt(conn, "select public.sync_my_profile('Name Here','+919999999999')")
    record(P, "anon cannot call sync_my_profile", not ok)

    # --- public access (intended) -----------------------------------------------------------------
    ok, rows = attempt(conn, "select slug from public.products")
    record(PUB, "anon can read products", ok and any(r[0] == "faki" for r in rows))
    ok, rows = attempt(conn, "select price_paise from public.product_variants where sku='CHK-FAKI-1KG'")
    record(PUB, "anon can read variant selling price", ok and rows == [(100000,)])
    ok, _ = attempt(conn, "select store_name, shop_intro from public.store_settings")
    record(PUB, "anon can read public shop fields", ok)
    ok, _ = attempt(conn, "select id from public.product_images")
    record(PUB, "anon can read product images", ok)

    # --- private data: customer -------------------------------------------------------------------
    as_role(conn, "authenticated", cust)
    ok, rows = attempt(conn, "select id::text from public.user_profiles")
    record(P, "customer sees only own profile", ok and [r[0] for r in rows] == [cust])
    ok, _ = attempt(conn, "update public.user_profiles set role='OWNER_ADMIN' where id=%s", (cust,))
    record(P, "customer cannot self-promote", not ok)
    ok, _ = attempt(conn, "update public.user_profiles set is_active=false where id=%s", (cust,))
    record(P, "customer cannot change is_active", not ok)
    ok, _ = attempt(conn, "update public.user_profiles set role='OWNER_ADMIN' where id=%s", (other,))
    record(P, "customer cannot change another profile", not ok)
    ok, rows = attempt(conn, "select public.sync_my_profile('New Name','+919876543210')")
    record(P, "customer can update own contact via sync_my_profile", ok)
    ok, rows = attempt(conn, "select user_id::text from public.customers")
    record(P, "customer sees only own customer row", ok and [r[0] for r in rows] == [cust])
    ok, _ = attempt(conn, "update public.customers set order_count = 99 where user_id=%s", (cust,))
    record(P, "customer cannot edit order_count", not ok)
    ok, _ = attempt(conn, "update public.customers set total_spent_paise = 99 where user_id=%s", (cust,))
    record(P, "customer cannot edit total_spent", not ok)
    for table in ("orders", "payment_attempts", "bank_credits", "admin_audit_logs", "inventory_movements"):
        ok, _ = attempt(conn, f"select 1 from public.{table} limit 1")
        record(P, f"customer cannot read {table} directly", not ok)
    ok, _ = attempt(conn, "insert into public.reviews (order_id, customer_id, user_id, product_id, rating, review_text) "
                          "values (gen_random_uuid(), gen_random_uuid(), %s, gen_random_uuid(), 5, 'direct insert attempt')", (cust,))
    record(P, "customer cannot insert reviews directly", not ok)
    ok, _ = attempt(conn, "select public.admin_link_legacy_account(gen_random_uuid(), gen_random_uuid(), 'x')")
    record(P, "customer cannot use admin legacy-link RPC", not ok)
    # defence in depth: even if column privilege were granted, RLS + trigger must still stop role changes
    as_postgres(conn)
    attempt(conn, "grant update (role, is_active) on public.user_profiles to authenticated")
    as_role(conn, "authenticated", cust)
    ok, _ = attempt(conn, "update public.user_profiles set role='OWNER_ADMIN' where id=%s", (cust,))
    record(P, "role change blocked by RLS/trigger even with column grant", not ok)
    as_postgres(conn)
    attempt(conn, "revoke update (role, is_active) on public.user_profiles from authenticated")

    # --- admin function -----------------------------------------------------------------------------
    as_role(conn, "authenticated", admin)
    ok, rows = attempt(conn, "select private.is_owner_admin()")
    record(P, "owner admin recognised", ok and rows == [(True,)])
    as_role(conn, "authenticated", cust)
    ok, rows = attempt(conn, "select private.is_owner_admin()")
    record(P, "customer not recognised as admin", ok and rows == [(False,)])

    # --- notification enum ---------------------------------------------------------------------------
    as_postgres(conn)
    for event in ("ORDER_CANCELLED", "REFUND_COMPLETED"):
        ok, _ = attempt(conn, "insert into public.notifications (event_type, channel, recipient, subject, message_preview) "
                              "values (%s,'IN_APP','test','s','b')", (event,))
        record("structure", f"notification accepts {event}", ok)


if __name__ == "__main__":
    sys.exit(main())
