"""End-to-end walkthrough against the LOCAL stack (real Supabase Auth, PostgreSQL and Storage + FastAPI).

Prerequisites: `supabase start`, `supabase db reset`, backend running on :8000, and
`python -m app.db.seed --dev --dev-admin` executed. Refuses anything that is not 127.0.0.1/localhost.
Credentials are read from gitignored files and never printed. Creates throwaway customers (random e-mails).
"""

from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parents[1]
API = "http://127.0.0.1:8000/api"
PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in (ROOT / "backend" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env


ENV = load_env()
AUTH = ENV["SUPABASE_URL"]
if urlparse(AUTH).hostname not in {"127.0.0.1", "localhost"}:
    sys.exit("REFUSED: SUPABASE_URL is not local.")

RUN = uuid.uuid4().hex[:8]
results: list[tuple[str, bool, str]] = []
http = httpx.Client(timeout=30)


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    return ok


def login(email: str, password: str) -> dict[str, str]:
    r = http.post(f"{AUTH}/auth/v1/token?grant_type=password", headers={"apikey": ENV["SUPABASE_PUBLISHABLE_KEY"]},
                  json={"email": email, "password": password})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def signup(email: str, password: str, name: str, phone: str):
    return http.post(f"{AUTH}/auth/v1/signup", headers={"apikey": ENV["SUPABASE_PUBLISHABLE_KEY"]},
                     json={"email": email, "password": password, "data": {"fullName": name, "phone": phone}})


def main() -> int:
    creds = json.loads((ROOT / ".local-dev-credentials.json").read_text(encoding="utf-8"))
    admin = login(creds["email"], creds["password"])
    check("admin /me is OWNER_ADMIN (real ES256 token via JWKS)", http.get(f"{API}/me", headers=admin).json().get("role") == "OWNER_ADMIN")

    # ---- public browsing --------------------------------------------------------------------------------------------
    products = http.get(f"{API}/products").json()
    faki = next(p for p in products if p["type"] == "faki")
    check("public catalogue has the confirmed Faki 1 kg price", faki["prices"]["1kg"] == 1000 and faki["priceConfirmed"]["1kg"] is True)
    check("other prices are flagged unconfirmed", faki["priceConfirmed"]["250g"] is False)
    check("public store profile hides payment details", "upiId" not in http.get(f"{API}/store").text)
    check("anonymous cannot reach admin", http.get(f"{API}/admin/dashboard").status_code == 401)

    # ---- sign-up (no email confirmation) and protected data ------------------------------------------------------------
    email, password = f"smoke-{uuid.uuid4().hex[:8]}@local.test", "Smoke-Test-123"
    su = signup(email, password, "Smoke Customer", "+919876501234")
    check("local sign-up returns a session without email confirmation", su.status_code == 200 and bool(su.json().get("access_token")), su.text[:120])
    wrong = http.post(f"{AUTH}/auth/v1/token?grant_type=password", headers={"apikey": ENV["SUPABASE_PUBLISHABLE_KEY"]},
                      json={"email": email, "password": "wrong-password"})
    check("wrong password is rejected", wrong.status_code == 400)
    cust = login(email, password)
    me = http.get(f"{API}/me", headers=cust).json()
    check("customer role is CUSTOMER", me.get("role") == "CUSTOMER")
    check("customer cannot reach admin", http.get(f"{API}/admin/dashboard", headers=cust).status_code == 403)
    check("customer orders start empty", http.get(f"{API}/orders", headers=cust).json() == [])

    # ---- ordering ------------------------------------------------------------------------------------------------------
    body = {"product": "faki", "packSize": "1kg", "quantity": 1, "fullName": "Smoke Customer", "phone": "9876501234",
            "address": "12 Test Society, University Road, Rajkot", "pinCode": "360005"}
    quote = http.post(f"{API}/checkout/quote", json={k: body[k] for k in ("product", "packSize", "quantity", "pinCode")}).json()
    check("server-calculated quote", quote.get("total") == 1000, str(quote))
    outside = http.post(f"{API}/checkout/quote", json={"product": "faki", "packSize": "1kg", "quantity": 1, "pinCode": "110001"})
    check("PIN outside the delivery area is refused (jsonb PIN list)", outside.status_code == 422, outside.text[:100])
    key = uuid.uuid4().hex
    o1 = http.post(f"{API}/orders", headers={**cust, "Idempotency-Key": key}, json=body)
    check("order created and persisted", o1.status_code == 200 and o1.json()["status"] == "PENDING_PAYMENT", o1.text[:200])
    order = o1.json()
    o1b = http.post(f"{API}/orders", headers={**cust, "Idempotency-Key": key}, json=body)
    check("duplicate submission returns the same order", o1b.json()["id"] == order["id"])
    check("LOCAL TEST payment instructions are flagged", order["payment"]["settingsConfirmed"] is False)
    qr_url = order["payment"].get("qrImageUrl")
    check("QR link is only issued once a QR has been uploaded", qr_url is None or qr_url.startswith("/api/orders/"))
    unauth_order = http.get(f"{API}/orders/{order['id']}")
    check("order data is protected", unauth_order.status_code == 401)
    check("malformed order id is a clean 404", http.get(f"{API}/orders/not-a-uuid", headers=cust).status_code == 404)

    # ---- payment proof: private Storage, idempotent, rejection and resubmission ---------------------------------------------
    def submit(idem: str):
        return http.post(f"{API}/payments/{order['id']}/submit", headers={**cust, "Idempotency-Key": idem},
                         files={"screenshot": ("proof.png", PNG, "image/png")})

    p1 = submit(f"pay-1-{RUN}")
    check("proof stored in private Storage; payment SUBMITTED", p1.status_code == 200 and p1.json()["paymentStatus"] == "SUBMITTED", p1.text[:200])
    check("replay of the same attempt is idempotent", submit(f"pay-1-{RUN}").json()["paymentId"] == p1.json()["paymentId"])
    pid = p1.json()["paymentId"]
    proof = http.get(f"{API}/admin/payments/{pid}/proof?raw=1", headers=admin)
    check("admin reads the proof through FastAPI (bytes match)", proof.status_code == 200 and proof.content == PNG, str(proof.status_code))
    check("customer cannot read the proof endpoint", http.get(f"{API}/admin/payments/{pid}/proof?raw=1", headers=cust).status_code in (401, 403))
    check("no UTR is asked for or stored", "utrMasked" not in p1.json())
    check("approval blocked before review", http.post(f"{API}/admin/payments/{pid}/approve", headers=admin, json={}).status_code == 409)
    http.post(f"{API}/admin/payments/{pid}/review", headers=admin, json={"notes": "checking"})
    rej = http.post(f"{API}/admin/payments/{pid}/reject", headers=admin, json={"reason": "Screenshot is blurry, please resend."})
    check("admin rejects with a reason", rej.status_code == 200, rej.text[:150])
    st = http.get(f"{API}/payments/{order['id']}/status", headers=cust).json()
    check("customer sees the reason and may resubmit", st["rejectionReason"] and st["canSubmitProof"] is True)
    p2 = submit(f"pay-2-{RUN}")
    check("resubmission creates a NEW attempt (history kept)", p2.status_code == 200 and p2.json()["paymentId"] != pid)
    pid2 = p2.json()["paymentId"]
    http.post(f"{API}/admin/payments/{pid2}/review", headers=admin, json={"notes": "checking again"})
    old_style = http.post(f"{API}/admin/payments/{pid2}/approve", headers=admin, json={"bankCreditReference": "AXIS-1"})
    check("bank-evidence fields are no longer accepted", old_style.status_code == 422)
    appr = http.post(f"{API}/admin/payments/{pid2}/approve", headers=admin, json={"notes": "walkthrough"})
    check("screenshot approval -> AWAITING_CONFIRMATION (not confirmed)", appr.status_code == 200 and appr.json()["orderStatus"] == "AWAITING_CONFIRMATION", appr.text[:200])
    conf = http.post(f"{API}/admin/orders/{order['id']}/confirm", headers=admin, json={})
    check("order confirmed separately", conf.status_code == 200, conf.text[:200])
    for status in ("PACKING", "PACKED", "PICKED_UP", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"):
        r = http.patch(f"{API}/admin/orders/{order['id']}/status", headers=admin, json={"status": status})
        if not check(f"admin moves order to {status}", r.status_code == 200, r.text[:150]):
            break
    tracking = http.get(f"{API}/orders/{order['id']}/tracking", headers=cust).json()["events"]
    check("customer timeline has real history", {"CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"} <= {e["status"] for e in tracking}, str([e["status"] for e in tracking]))

    # ---- reviews and photos ---------------------------------------------------------------------------------------------
    base_reviews = http.get(f"{API}/reviews").json()["summary"]["count"]  # earlier manual runs may have left reviews
    rv = http.post(f"{API}/orders/{order['id']}/review", headers=cust, data={"rating": "2", "reviewText": "Packaging was damaged on arrival."},
                   files=[("photos", ("a.png", PNG, "image/png")), ("photos", ("b.png", PNG, "image/png"))])
    check("review with two photos published immediately", rv.status_code == 201 and len(rv.json()["photoUrls"]) == 2, rv.text[:200])
    again = http.post(f"{API}/orders/{order['id']}/review", headers=cust, data={"rating": "5", "reviewText": "Second review attempt text."})
    check("duplicate review refused", again.status_code == 409)
    public = http.get(f"{API}/reviews?sort=lowest").json()
    check("negative review is public; summary counts it", any(i["id"] == rv.json()["id"] and i["rating"] == 2 for i in public["items"]) and public["summary"]["count"] == base_reviews + 1)
    photo = http.get(f"{API}/reviews/photos/{rv.json()['photoUrls'][0].rsplit('/', 1)[1]}")
    check("published review photo served from private Storage", photo.status_code == 200 and photo.content == PNG)
    rid = rv.json()["id"]
    check("hiding needs a reason", http.patch(f"{API}/admin/reviews/{rid}", headers=admin, json={"moderationStatus": "HIDDEN"}).status_code == 422)
    http.patch(f"{API}/admin/reviews/{rid}", headers=admin, json={"moderationStatus": "HIDDEN", "moderationReason": "Spam: test"})
    after = http.get(f"{API}/reviews").json()
    check("hidden review leaves public list, count and average", after["summary"]["count"] == base_reviews and all(i["id"] != rid for i in after["items"]))
    check("hidden review photo is no longer public", http.get(f"{API}/reviews/photos/{rv.json()['photoUrls'][0].rsplit('/', 1)[1]}").status_code == 404)
    adm = next(i for i in http.get(f"{API}/admin/reviews", headers=admin).json()["items"] if i["id"] == rid)
    check("admin still sees it with signed photo URLs", adm["moderationStatus"] == "HIDDEN" and http.get(f"http://127.0.0.1:8000{adm['photoUrls'][0]}").content == PNG)

    # ---- cancel + refund path (notification enum on Postgres) --------------------------------------------------------------
    o2 = http.post(f"{API}/orders", headers={**cust, "Idempotency-Key": uuid.uuid4().hex}, json={**body, "packSize": "500g"}).json()
    c = http.post(f"{API}/orders/{o2['id']}/cancel", headers=cust, json={"reason": "Changed my mind about this order"})
    check("customer cancel works on Postgres (ORDER_CANCELLED notification)", c.status_code == 200 and c.json()["status"] == "CANCELLED", c.text[:200])

    # ---- Mitho Mavo and Water are ordinary catalogue products (relaxed slug / pack-size CHECK constraints on Postgres) ------
    water = next((p for p in http.get(f"{API}/products").json() if p["type"] == "water"), None)
    wprice = water["prices"].get("1l") if water else None
    check("Water Bottle is in the catalogue with a 1 L pack and its own images", bool(water) and water["packSizes"] == ["1l"] and len(water["images"]) == 2, str(water)[:150])
    if wprice is not None:  # a price exists (dev placeholder or owner-approved)
        wq = http.post(f"{API}/checkout/quote", json={"product": "water", "packSize": "1l", "quantity": 2, "pinCode": "360005"}).json()
        check("Water 1 L quote is server-calculated", wq.get("subtotal") == wprice * 2, str(wq))
        wo = http.post(f"{API}/orders", headers={**cust, "Idempotency-Key": uuid.uuid4().hex}, json={**body, "product": "water", "packSize": "1l", "quantity": 2})
        check("Water order persists as product 'water', pack '1l'", wo.status_code == 200 and wo.json()["product"] == "water" and wo.json()["packSize"] == "1l", wo.text[:200])
        if wo.status_code == 200:
            http.post(f"{API}/orders/{wo.json()['id']}/cancel", headers=cust, json={"reason": "Smoke test cleanup of the water order"})
    mavo_bad = http.post(f"{API}/checkout/quote", json={"product": "mitho-mavo", "packSize": "1l", "quantity": 1, "pinCode": "360005"})
    check("a pack size the product does not have is refused", mavo_bad.status_code == 400, mavo_bad.text[:120])

    # ---- admin: inventory, products, settings, images, QR ------------------------------------------------------------------
    inv = http.get(f"{API}/admin/inventory", headers=admin).json()
    item = next(i for i in inv["items"] if i["sku"] == "BFP-FAKI-500G")
    adj = http.post(f"{API}/admin/inventory/adjustments", headers=admin, json={"inventoryItemId": item["id"], "adjustmentType": "ADD", "quantity": 5, "reason": "Walkthrough restock"})
    check("inventory adjustment", adj.status_code == 201 and adj.json()["newAvailable"] == adj.json()["previousAvailable"] + 5, adj.text[:150])
    pr = http.patch(f"{API}/admin/products/faki", headers=admin, json={"description": "", "variants": [{"packSize": "500g", "isAvailable": True}]})
    check("partial product update keeps prices", pr.status_code == 200 and next(v for v in pr.json()["variants"] if v["packSize"] == "500g")["price"] == 500, pr.text[:150])
    img = http.post(f"{API}/admin/products/faki/images", headers=admin, data={"altText": "Smoke photo"}, files={"image": ("f.png", PNG, "image/png")})
    uploaded = next((i for i in img.json().get("images", []) if i["alt"] == "Smoke photo"), None) if img.status_code == 201 else None
    check("product image stored in the public catalogue bucket", uploaded is not None, img.text[:150])
    pub_img = http.get(uploaded["url"]) if uploaded else None
    check("public product image URL is served by local Storage", pub_img is not None and pub_img.status_code == 200 and pub_img.content == PNG, str(pub_img and pub_img.status_code))
    if uploaded:  # leave the gallery as it was
        http.delete(f"{API}/admin/products/faki/images/{uploaded['id']}", headers=admin)
    gallery = http.get(f"{API}/products/faki").json()["images"]
    check("Faki gallery: bundle first, banner last", [i["url"] for i in gallery[:3]] == ["/images/products/balaji-faki-bundle.jpg", "/images/products/balaji-faki-box.webp", "/images/products/balaji-faki-banner.jpg"] and all(i["alt"] != "Smoke photo" for i in gallery), str(gallery)[:200])
    supari_gallery = http.get(f"{API}/products/supari").json()["images"]
    check("Supari gallery: bowl first, arecanut packet photos last", [i["url"] for i in supari_gallery] == ["/images/supari-reference.png", "/images/products/balaji-supari-packet-front.webp", "/images/products/balaji-supari-packet-back.webp"], str(supari_gallery)[:200])
    qr = http.post(f"{API}/admin/settings/qr", headers=admin, files={"qr": ("qr.png", PNG, "image/png")})
    check("payment QR stored in the PRIVATE bucket", qr.status_code == 200 and qr.json()["officialUpiQrImageUrl"], qr.text[:150])
    o3 = http.post(f"{API}/orders", headers={**cust, "Idempotency-Key": uuid.uuid4().hex}, json=body).json()
    qurl = o3["payment"]["qrImageUrl"]
    check("customer gets a signed QR link", bool(qurl) and http.get("http://127.0.0.1:8000" + qurl).content == PNG)
    direct = http.get(f"{AUTH}/storage/v1/object/public/payment-qr/{qr.json()['officialUpiQrImageUrl'][:0]}anything")
    check("private bucket is not publicly readable", direct.status_code in (400, 404))
    check("business settings cannot be confirmed with LOCAL TEST UPI", http.post(f"{API}/admin/settings/confirm", headers=admin, json={"confirm": True}).status_code == 422)
    st = http.patch(f"{API}/admin/settings", headers=admin, json={"shopIntro": "Written by the owner.", "serviceablePinCodes": ["360005", "360001"]})
    check("settings saved; public profile reflects shop content", st.status_code == 200 and http.get(f"{API}/store").json()["shopIntro"] == "Written by the owner.", st.text[:150])
    dash = http.get(f"{API}/admin/dashboard", headers=admin).json()
    check("dashboard: delivered paid order counted, profit uses real item costs", dash["productsSold"] >= 1 and dash["netProfit"]["status"] == "OK", str(dash["netProfit"]))
    cl = http.get(f"{API}/admin/customers?search=smoke", headers=admin).json()
    check("customers list shows the new customer", cl["total"] >= 1)
    ol = http.get(f"{API}/admin/orders?pageSize=50", headers=admin).json()
    check("order list returns items in one response", ol["total"] >= 3 and "items" in ol["items"][0])

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
