import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rag.chunking import chunk_text
from app.core.rag.parsers import parse_file
from app.models.orm import Document
from app.services.embedding_service import embed_documents
from app.services.vector_store import VectorStore

logger = logging.getLogger(__name__)


def ingest_file(file_path: Path, source_type: str, db: Session, vector_store: VectorStore) -> Document:
    """Parse, chunk, embed, and store one file. Never raises — failures are recorded on the Document row
    so one bad file doesn't abort a batch of others."""
    file_hash = _hash_file(file_path)
    existing = db.query(Document).filter_by(file_hash=file_hash).first()
    if existing and existing.status == "indexed":
        return existing

    document = existing or Document(
        id=str(uuid4()),
        filename=file_path.name,
        source_type=source_type,
        file_hash=file_hash,
        status="processing",
        size_bytes=file_path.stat().st_size,
        created_at=datetime.now(timezone.utc),
    )
    db.add(document)
    db.commit()

    try:
        pages = parse_file(file_path)
        all_chunks: list[str] = []
        page_numbers: list[int | None] = []
        for page in pages:
            page_chunks = chunk_text(page.text, settings.chunk_size, settings.chunk_overlap)
            all_chunks.extend(page_chunks)
            page_numbers.extend([page.page_number] * len(page_chunks))

        if not all_chunks:
            raise ValueError("No extractable text found in file")

        embeddings = embed_documents(all_chunks)
        vector_store.add_chunks(
            document_id=document.id,
            filename=document.filename,
            source_type=source_type,
            chunks=all_chunks,
            embeddings=embeddings,
            page_numbers=page_numbers,
        )
        document.status = "indexed"
        document.status_detail = None
        document.chunk_count = len(all_chunks)
        document.indexed_at = datetime.now(timezone.utc)
    except Exception as exc:
        logger.exception("ingestion_failed", extra={"doc_filename": document.filename})
        document.status = "failed"
        document.status_detail = str(exc)[:500]

    db.commit()
    return document


def _hash_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(8192), b""):
            digest.update(block)
    return digest.hexdigest()
