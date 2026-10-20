"""End-to-end check of the whole app against a NEON DEV BRANCH (never production).

Real Neon Auth sign-up/sign-in and signed JWTs, the FastAPI API, Neon Postgres and Neon Object Storage.
Prerequisites:
  neon branches create --name dev --parent production
  neon env pull --branch dev --file .env.neon-dev
  python scripts/setup-neon-db.py --project-id <id> --branch dev --env-file .env.neon-dev
  the API running against that branch on http://127.0.0.1:8000 (its env loaded from .env.neon-dev)
Run: python scripts/e2e-neon-dev.py .env.neon-dev

Two throwaway accounts are created (random emails/passwords, never printed). Because nobody can read their inbox,
their emails are marked verified directly in the dev branch database, and one is made Owner Admin there.
Refuses to run unless the env file's NEON_BRANCH is "dev". Delete the branch afterwards.
"""

from __future__ import annotations

import base64
import json
import secrets
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import psycopg

API = "http://127.0.0.1:8000/api"
ORIGIN = "http://localhost:5173"  # Neon Auth trusts localhost origins by default
PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)
results: list[bool] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not ok else ""))
    if not ok:
        raise SystemExit(f"Stopped at the first failure ({len(results) - 1} checks passed before it).")
    return True


def read_env(path: str) -> dict[str, str]:
    values = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    if values.get("NEON_BRANCH") != "dev":
        raise SystemExit("REFUSED: the env file is not the Neon dev branch.")
    return values


def jwt_parts(token: str) -> tuple[dict, dict]:
    def part(seg: str) -> dict:
        return json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    head, body, _ = token.split(".")
    return part(head), part(body)


class Account:
    """One Neon Auth user driven through its REST API, like the browser SDK does."""

    def __init__(self, auth_url: str, label: str) -> None:
        self.auth = auth_url.rstrip("/")
        self.email = f"bfp-e2e-{label}-{uuid.uuid4().hex[:8]}@example.com"
        self.password = secrets.token_urlsafe(16)
        self.http = httpx.Client(timeout=30, headers={"Origin": ORIGIN})

    def post(self, path: str, body: dict) -> httpx.Response:
        return self.http.post(f"{self.auth}/{path}", json=body)

    def token(self) -> str | None:
        response = self.http.get(f"{self.auth}/token")
        if response.status_code == 200 and response.json().get("token"):
            return response.json()["token"]
        session = self.http.get(f"{self.auth}/get-session")
        return session.headers.get("set-auth-jwt")

    def headers(self) -> dict[str, str]:
        token = self.token()
        return {"Authorization": f"Bearer {token}"} if token else {}


def main() -> int:
    env = read_env(sys.argv[1] if len(sys.argv) > 1 else ".env.neon-dev")
    auth_url = env["NEON_AUTH_BASE_URL"]
    db = psycopg.connect(env["DATABASE_URL_UNPOOLED"], autocommit=True, connect_timeout=20)
    api = httpx.Client(timeout=30)

    def mark_verified(email: str) -> None:
        db.execute('update neon_auth."user" set "emailVerified" = true where email = %s', (email,))

    check("API is healthy on the dev branch", api.get(f"{API}/health").json().get("status") == "ok")

    # ---- sign-up: an unverified account gets no access --------------------------------------------------------------
    customer = Account(auth_url, "customer")
    signup = customer.post("sign-up/email", {"email": customer.email, "password": customer.password, "name": "E2E Customer"})
    check("Neon Auth sign-up accepted", signup.status_code == 200, f"HTTP {signup.status_code}")
    early = customer.post("sign-in/email", {"email": customer.email, "password": customer.password})
    early_headers = customer.headers() if early.status_code == 200 else {}
    early_me = api.get(f"{API}/me", headers=early_headers)
    check("an unverified email cannot use the API", early_me.status_code in (401, 403), f"sign-in HTTP {early.status_code}, /me HTTP {early_me.status_code}")

    mark_verified(customer.email)  # stands in for typing the emailed code
    wrong = customer.post("sign-in/email", {"email": customer.email, "password": "not-the-password"})
    check("wrong password is rejected", wrong.status_code in (400, 401, 403), f"HTTP {wrong.status_code}")
    login = customer.post("sign-in/email", {"email": customer.email, "password": customer.password})
    check("verified customer signs in", login.status_code == 200, f"HTTP {login.status_code}")
    token = customer.token()
    check("Neon Auth issues a JWT", bool(token))
    header, claims = jwt_parts(token)
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(auth_url))
    check("JWT is EdDSA-signed", header.get("alg") == "EdDSA", str(header.get("alg")))
    aud = claims.get("aud") if isinstance(claims.get("aud"), list) else [claims.get("aud")]
    check("JWT issuer and audience are the Neon Auth origin", claims.get("iss") == origin and origin in aud, f"iss={claims.get('iss')} aud={claims.get('aud')}")
    cust = {"Authorization": f"Bearer {token}"}
    me = api.get(f"{API}/me", headers=cust)
    check("API verifies the token; profile created as CUSTOMER", me.status_code == 200 and me.json().get("role") == "CUSTOMER", f"HTTP {me.status_code} {me.text[:120]}")
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    check("a tampered token is rejected", api.get(f"{API}/me", headers={"Authorization": f"Bearer {tampered}"}).status_code == 401)
    saved = api.patch(f"{API}/me", headers=cust, json={"fullName": "E2E Customer", "phone": "+919876501234"})
    check("customer saves name and phone", saved.status_code == 200 and saved.json().get("phone", "").endswith("9876501234"), saved.text[:120])
    check("customer cannot reach admin", api.get(f"{API}/admin/dashboard", headers=cust).status_code == 403)

    # ---- the owner: same sign-up, then made Owner Admin in the database (the only way to get the role) --------------
    owner = Account(auth_url, "owner")
    owner.post("sign-up/email", {"email": owner.email, "password": owner.password, "name": "E2E Owner"})
    mark_verified(owner.email)
    owner.post("sign-in/email", {"email": owner.email, "password": owner.password})
    check("owner starts as a customer", api.get(f"{API}/me", headers=owner.headers()).json().get("role") == "CUSTOMER")
    db.execute("update public.user_profiles set role = 'OWNER_ADMIN' where lower(email) = %s", (owner.email,))
    admin = owner.headers()
    check("Owner Admin role comes from the database", api.get(f"{API}/me", headers=admin).json().get("role") == "OWNER_ADMIN")
    check("admin dashboard opens", api.get(f"{API}/admin/dashboard", headers=admin).status_code == 200)

    # ---- owner opens the shop: price, stock, payment settings, QR (Neon Object Storage) -------------------------------
    price = api.patch(f"{API}/admin/products/faki", headers=admin, json={"variants": [
        {"packSize": "1kg", "price": 1000, "costPrice": 700, "availableQuantity": 20, "isAvailable": True, "priceConfirmed": True}]})
    check("owner sets the Faki 1 kg price and stock", price.status_code == 200, price.text[:160])
    settings = api.patch(f"{API}/admin/settings", headers=admin, json={
        "officialUpiId": "e2e-test@okaxis", "officialPayeeName": "E2E Test Payee", "deliveryCharges": 0, "serviceablePinCodes": ["360005"]})
    check("owner saves payment and delivery settings", settings.status_code == 200, settings.text[:160])
    qr = api.post(f"{API}/admin/settings/qr", headers=admin, files={"qr": ("qr.png", PNG, "image/png")})
    check("payment QR uploaded to Neon storage", qr.status_code in (200, 201), qr.text[:160])
    confirm = api.post(f"{API}/admin/settings/confirm", headers=admin, json={"confirm": True})
    check("owner confirms business settings (ordering opens)", confirm.status_code == 200, confirm.text[:160])
    image = api.post(f"{API}/admin/products/faki/images", headers=admin, data={"altText": "E2E photo"}, files={"image": ("f.png", PNG, "image/png")})
    check("product photo uploaded to Neon storage", image.status_code in (200, 201), image.text[:160])
    detail = api.get(f"{API}/products/faki").json()
    signed = [img["url"] for img in detail.get("images", []) if not img["url"].startswith("/")]
    fetched = httpx.get(signed[-1], timeout=30) if signed else None
    check("public product photo is a working signed link", bool(fetched) and fetched.status_code == 200 and fetched.content == PNG)

    # ---- order and payment -----------------------------------------------------------------------------------------
    body = {"product": "faki", "packSize": "1kg", "quantity": 1, "fullName": "E2E Customer", "phone": "9876501234",
            "address": "12 Test Society, University Road, Rajkot", "pinCode": "360005"}
    quote = api.post(f"{API}/checkout/quote", json={k: body[k] for k in ("product", "packSize", "quantity", "pinCode")})
    check("server-calculated quote", quote.status_code == 200 and quote.json().get("total") == 1000, quote.text[:160])
    order_resp = api.post(f"{API}/orders", headers={**cust, "Idempotency-Key": uuid.uuid4().hex}, json=body)
    check("customer places an order", order_resp.status_code == 200 and order_resp.json().get("status") == "PENDING_PAYMENT", order_resp.text[:200])
    order = order_resp.json()
    check("order data is private", api.get(f"{API}/orders/{order['id']}").status_code == 401)
    paid = api.post(f"{API}/payments/{order['id']}/submit", headers={**cust, "Idempotency-Key": uuid.uuid4().hex},
                    files={"screenshot": ("proof.png", PNG, "image/png")})
    check("payment screenshot stored in Neon storage", paid.status_code == 200 and paid.json().get("paymentStatus") == "SUBMITTED", paid.text[:200])
    pid = paid.json().get("paymentId")
    proof = api.get(f"{API}/admin/payments/{pid}/proof?raw=1", headers=admin)
    check("admin reads the screenshot (bytes match)", proof.status_code == 200 and proof.content == PNG, f"HTTP {proof.status_code}")
    check("customer cannot read the proof endpoint", api.get(f"{API}/admin/payments/{pid}/proof?raw=1", headers=cust).status_code in (401, 403))
    api.post(f"{API}/admin/payments/{pid}/review", headers=admin, json={"notes": "e2e"})
    approve = api.post(f"{API}/admin/payments/{pid}/approve", headers=admin, json={"notes": "e2e"})
    check("admin approves the payment", approve.status_code == 200, approve.text[:160])
    confirmed = api.post(f"{API}/admin/orders/{order['id']}/confirm", headers=admin, json={})
    check("admin confirms the order", confirmed.status_code == 200, confirmed.text[:160])
    mine = api.get(f"{API}/orders/{order['id']}", headers=cust).json()
    check("customer sees the confirmed order", mine.get("status") == "CONFIRMED", str(mine.get("status")))

    # ---- account linking: a historical profile reconnects only through a verified Neon identity -----------------------
    legacy_email = f"bfp-e2e-legacy-{uuid.uuid4().hex[:8]}@example.com"
    legacy_id = db.execute("insert into public.user_profiles (email, full_name, phone, role) values (%s, 'Old Customer', '', 'CUSTOMER') returning id",
                           (legacy_email,)).fetchone()[0]
    returning = Account(auth_url, "legacy")
    returning.email = legacy_email
    returning.post("sign-up/email", {"email": legacy_email, "password": returning.password, "name": "Old Customer"})
    mark_verified(legacy_email)
    returning.post("sign-in/email", {"email": legacy_email, "password": returning.password})
    linked = api.get(f"{API}/me", headers=returning.headers()).json()
    check("returning customer reconnects to their old profile (same ID)", str(linked.get("id")) == str(legacy_id), str(linked)[:120])
    other = api.get(f"{API}/orders/{order['id']}", headers=returning.headers())
    check("another customer cannot read someone else's order", other.status_code in (403, 404), f"HTTP {other.status_code}")
    queue = [p["type"] for p in api.get(f"{API}/products").json()]
    check("catalogue keeps the queue order", queue == ["faki", "supari", "mitho-mavo", "water", "chuno", "tamaku"], str(queue))

    db.close()
    passed = sum(results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
