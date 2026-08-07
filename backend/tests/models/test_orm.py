import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.models.orm import Base, Document, ChatMessage
from app.models.schemas import DocumentOut


def _memory_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_document_round_trip():
    db = _memory_session()
    doc = Document(
        id="doc-1", filename="a.pdf", source_type="upload",
        file_hash="hash1", status="indexed", chunk_count=3, size_bytes=1024,
    )
    db.add(doc)
    db.commit()

    fetched = db.query(Document).filter_by(id="doc-1").one()
    assert fetched.filename == "a.pdf"
    assert fetched.chunk_count == 3
    assert fetched.status_detail is None


def test_chat_message_round_trip():
    db = _memory_session()
    msg = ChatMessage(id="msg-1", role="user", content="hello", status="ok")
    db.add(msg)
    db.commit()

    fetched = db.query(ChatMessage).filter_by(id="msg-1").one()
    assert fetched.content == "hello"
    assert fetched.citations is None


def test_chat_message_provider_round_trip():
    db = _memory_session()
    msg = ChatMessage(id="msg-2", role="assistant", content="hi", status="ok", provider="ollama")
    db.add(msg)
    db.commit()

    fetched = db.query(ChatMessage).filter_by(id="msg-2").one()
    assert fetched.provider == "ollama"


def test_chat_message_provider_defaults_to_none():
    db = _memory_session()
    msg = ChatMessage(id="msg-3", role="user", content="hi", status="ok")
    db.add(msg)
    db.commit()

    fetched = db.query(ChatMessage).filter_by(id="msg-3").one()
    assert fetched.provider is None


def test_document_out_from_orm_round_trip():
    db = _memory_session()
    doc = Document(
        id="doc-2",
        filename="report.pdf",
        source_type="upload",
        file_hash="hash2",
        status="indexed",
        status_detail="all good",
        chunk_count=7,
        size_bytes=2048,
    )
    db.add(doc)
    db.commit()

    fetched = db.query(Document).filter_by(id="doc-2").one()
    out = DocumentOut.model_validate(fetched)

    assert out.id == "doc-2"
    assert out.filename == "report.pdf"
    assert out.source_type == "upload"
    assert out.status == "indexed"
    assert out.status_detail == "all good"
    assert out.chunk_count == 7
    assert out.size_bytes == 2048
    assert out.created_at == fetched.created_at
    assert out.indexed_at is None


def test_document_file_hash_unique_constraint():
    db = _memory_session()
    db.add(
        Document(
            id="doc-3",
            filename="a.pdf",
            source_type="upload",
            file_hash="dup-hash",
            status="indexed",
        )
    )
    db.commit()

    db.add(
        Document(
            id="doc-4",
            filename="b.pdf",
            source_type="upload",
            file_hash="dup-hash",
            status="indexed",
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
