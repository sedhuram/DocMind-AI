from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.orm import Base, Document
from app.services.ingestion_service import ingest_file
from app.services.vector_store import VectorStore

# NOTE: the task brief specifies FIXTURES = parents[1] / "fixtures", which would
# resolve to backend/tests/fixtures. The real fixtures created in Task 4 live at
# backend/tests/core/fixtures (see tests/core/rag/test_parsers.py), so this path
# is corrected to point there.
FIXTURES = Path(__file__).resolve().parents[1] / "core" / "fixtures"


def _db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _fake_embeddings(chunks):
    return [[1.0, 0.0] for _ in chunks]


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_ingest_txt_file_marks_indexed(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))

    document = ingest_file(FIXTURES / "sample.txt", "upload", db, store)

    assert document.status == "indexed"
    assert document.chunk_count > 0
    assert document.indexed_at is not None
    assert store.count() == document.chunk_count


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_ingest_same_file_twice_is_deduped(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))

    first = ingest_file(FIXTURES / "sample.txt", "static", db, store)
    second = ingest_file(FIXTURES / "sample.txt", "static", db, store)

    assert first.id == second.id
    assert mock_embed.call_count == 1
    assert db.query(Document).count() == 1


@patch("app.services.ingestion_service.embed_documents", side_effect=RuntimeError("Gemini quota exceeded"))
def test_ingest_failure_is_recorded_without_raising(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))

    document = ingest_file(FIXTURES / "sample.txt", "upload", db, store)

    assert document.status == "failed"
    assert "quota" in document.status_detail.lower()


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_ingest_unparseable_extension_marks_failed(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))
    bad_file = tmp_path / "sample.xyz"
    bad_file.write_text("data")

    document = ingest_file(bad_file, "upload", db, store)

    assert document.status == "failed"
    assert document.status_detail
