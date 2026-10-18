"""Database engine and transactional session factory for FastAPI."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from ..core.config import settings
from .models import Base

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_SQLITE_PATH = _BACKEND_DIR / "balaji_faki_local.db"


def resolve_database_url(explicit_url: str | None = None) -> str:
    url = (explicit_url or settings.database_url or "").strip()
    if not url:
        return f"sqlite:///{_DEFAULT_SQLITE_PATH.as_posix()}"
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    return url


def build_engine(database_url: str | None = None) -> Engine:
    resolved_url = resolve_database_url(database_url)
    kwargs: dict[str, Any] = {"future": True}
    if resolved_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in resolved_url:
            kwargs["poolclass"] = StaticPool
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
    Base.metadata.create_all(bind=engine)
    return engine


def init_db(target_engine: Engine | None = None) -> None:
    Base.metadata.create_all(bind=target_engine or engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
