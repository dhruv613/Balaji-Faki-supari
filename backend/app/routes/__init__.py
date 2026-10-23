"""HTTP route modules, combined into one router that main.py mounts under /api and at the root.

Shared helpers, serializers and auth dependencies live in `common.py`; a helper used by one module lives there.
"""

from fastapi import APIRouter

from . import account, admin, admin_catalog, admin_orders, admin_payments, orders, payments, public, receipts, reviews

router = APIRouter()
for _module in (public, account, orders, reviews, payments, receipts, admin, admin_payments, admin_orders, admin_catalog):
    router.include_router(_module.router)
