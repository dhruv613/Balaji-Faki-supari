"""Database engine and transactional session factory for FastAPI."""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from ..core.config import settings
from .models import Base

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_SQLITE_PATH = _BACKEND_DIR / "balaji_faki_local.db"


def resolve_database_url(explicit_url: str | None = None) -> str:
    url = (explicit_url or settings.database_url or "").strip()
    if not url:
        if not settings.is_local_env:
            # A silent local SQLite file would lose every order on a serverless host (read-only, per-instance filesystem).
            raise RuntimeError("DATABASE_URL is not set. Outside local development the backend needs a PostgreSQL database URL.")
        return f"sqlite:///{_DEFAULT_SQLITE_PATH.as_posix()}"
    # Standard PostgreSQL URLs use the installed psycopg 3 driver.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg://" + url[len(prefix) :]
            break
    return url


def _is_serverless_pooled(url: str) -> bool:
    """Vercel and Neon pooled connections are short-lived and shared by many
    function instances, so the app keeps no pool of its own and must not use prepared statements."""
    host = make_url(url).host or ""
    return bool(os.environ.get("VERCEL")) or (
        host.endswith(".neon.tech") and "-pooler." in host
    )


def build_engine(database_url: str | None = None) -> Engine:
    resolved_url = resolve_database_url(database_url)
    kwargs: dict[str, Any] = {"future": True}
    if resolved_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in resolved_url:
            kwargs["poolclass"] = StaticPool
    elif _is_serverless_pooled(resolved_url):
        kwargs["poolclass"] = NullPool
        kwargs["connect_args"] = {"prepare_threshold": None}  # psycopg: no server-side prepared statements behind the pooler
    else:
        kwargs["pool_pre_ping"] = True

    eng = create_engine(resolved_url, **kwargs)
    if resolved_url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _set_sqlite_pragma(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return eng


engine: Engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)


def configure_database(database_url: str) -> Engine:
    """Reconfigures the module engine and SessionLocal (used by isolated test suites)."""
    global engine, SessionLocal
    previous_engine = engine
    engine = build_engine(database_url)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, class_=Session)
    previous_engine.dispose()
    init_db(engine)
    return engine


def init_db(target_engine: Engine | None = None) -> None:
    """Creates tables for SQLite (local fixtures/tests) only.

    On PostgreSQL the schema is owned by explicit migrations; creating tables from the ORM there could
    silently drift from the migrated schema (types, CHECKs, RLS), so it is never done automatically.
    """
    eng = target_engine or engine
    if eng.dialect.name == "postgresql":
        return
    Base.metadata.create_all(bind=eng)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
