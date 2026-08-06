from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.orm import Base, Document, ChatMessage


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
