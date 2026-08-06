import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import session as db_session
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.vector_db_dir", str(tmp_path / "chroma"))
    monkeypatch.setattr("app.core.config.settings.sqlite_path", str(tmp_path / "test.db"))
    monkeypatch.setattr("app.core.config.settings.static_dir", str(tmp_path / "static"))
    monkeypatch.setattr("app.core.config.settings.uploads_dir", str(tmp_path / "uploads"))

    # `app.db.session.engine`/`SessionLocal` are created once at module-import time from
    # whatever `settings.sqlite_path` was at that point (see app/db/session.py). Patching
    # `settings.sqlite_path` above does NOT change the already-constructed engine object,
    # and `app/main.py` / `app/api/health.py` / `app/api/chat.py` each did `from
    # app.db.session import SessionLocal`, which binds their own module-level name directly
    # to that same sessionmaker instance. So all four references must be repointed at a
    # fresh tmp_path-backed engine, or the app under test would read/write the real
    # backend/data/docmind.db instead of an isolated database.
    test_engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )
    test_session_local = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(db_session, "engine", test_engine)
    monkeypatch.setattr(db_session, "SessionLocal", test_session_local)
    monkeypatch.setattr("app.main.SessionLocal", test_session_local)
    monkeypatch.setattr("app.api.health.SessionLocal", test_session_local)
    monkeypatch.setattr("app.api.chat.SessionLocal", test_session_local)

    with TestClient(app) as test_client:
        yield test_client
