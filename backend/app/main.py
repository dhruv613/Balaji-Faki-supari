"""Balaji Faki Point — FastAPI application. Routes live in app/routes/ (shared helpers in app/routes/common.py)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .db.session import init_db
from .routes import router


def create_app() -> FastAPI:
    init_db()
    application = FastAPI(
        title="Balaji Faki Point API",
        version="1.0.0",
        description="Backend API for Balaji Faki Point e-commerce, UPI payment verification, and administration.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "Idempotency-Key"],
    )
    # Mount under /api and root so both VITE_API_BASE_URL='.../api' and '...' resolve identically
    application.include_router(router, prefix="/api")
    application.include_router(router)
    return application


app = create_app()
