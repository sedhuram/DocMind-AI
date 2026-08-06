from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.db import session as session_module
from app.models.orm import Document


def _patch_engine(monkeypatch, tmp_path):
    """Point the already-imported session module at a fresh temp-file SQLite engine."""
    test_engine = create_engine(
        f"sqlite:///{tmp_path}/test.db", connect_args={"check_same_thread": False}
    )
    test_session_local = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(session_module, "engine", test_engine)
    monkeypatch.setattr(session_module, "SessionLocal", test_session_local)
    return test_engine


def test_init_db_creates_tables(monkeypatch, tmp_path):
    test_engine = _patch_engine(monkeypatch, tmp_path)

    session_module.init_db()

    table_names = inspect(test_engine).get_table_names()
    assert "documents" in table_names
    assert "chat_messages" in table_names

    # Confirm the tables are actually usable, not just present in the schema.
    db = session_module.SessionLocal()
    try:
        db.add(
            Document(
                id="doc-init",
                filename="init.pdf",
                source_type="upload",
                file_hash="hash-init",
                status="indexed",
            )
        )
        db.commit()
        assert db.query(Document).filter_by(id="doc-init").one().filename == "init.pdf"
    finally:
        db.close()


def test_get_db_yields_working_session_and_closes(monkeypatch, tmp_path):
    _patch_engine(monkeypatch, tmp_path)
    session_module.init_db()

    gen = session_module.get_db()
    db = next(gen)

    db.add(
        Document(
            id="doc-get-db",
            filename="get_db.pdf",
            source_type="upload",
            file_hash="hash-get-db",
            status="indexed",
        )
    )
    db.commit()
    fetched = db.query(Document).filter_by(id="doc-get-db").one()
    assert fetched.filename == "get_db.pdf"

    # Exhaust the generator so the `finally: db.close()` branch runs, and confirm
    # it terminates cleanly (StopIteration) rather than raising anything else.
    try:
        next(gen)
    except StopIteration:
        pass
    else:
        raise AssertionError("get_db() generator should yield exactly one session")

    # Session.close() expunges all objects from the identity map; a previously
    # fetched object becoming detached confirms the session's cleanup ran.
    from sqlalchemy import inspect as sa_inspect

    assert sa_inspect(fetched).detached
