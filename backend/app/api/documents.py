import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_vector_store
from app.core.config import settings
from app.db.session import get_db
from app.models.orm import Document
from app.models.schemas import DocumentOut
from app.services.ingestion_service import ingest_file
from app.services.vector_store import VectorStore

router = APIRouter(prefix="/documents", tags=["documents"])

_ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx"}


@router.get("", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)) -> list[Document]:
    return db.query(Document).order_by(Document.created_at.desc()).all()


@router.post("/upload", response_model=DocumentOut)
async def upload_document(
    file: UploadFile,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> Document:
    suffix = Path(file.filename).suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported file type: {suffix}")

    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(status_code=422, detail=f"File exceeds {settings.max_upload_size_mb}MB limit")

    # Each upload is first written to a throwaway UUID subdirectory (rather than a
    # "{uuid}_{filename}" prefix) so that `ingest_file`, which derives `Document.filename`
    # from `file_path.name`, records the original filename verbatim instead of a
    # UUID-prefixed one, while still avoiding on-disk collisions between concurrent
    # uploads that share a filename before we know the eventual `Document.id`.
    uploads_dir = Path(settings.uploads_dir)
    temp_dir = uploads_dir / uuid4().hex
    temp_dir.mkdir(parents=True, exist_ok=True)
    dest_path = temp_dir / file.filename
    dest_path.write_bytes(contents)

    document = ingest_file(dest_path, "upload", db, vector_store)

    # Move the temp subdirectory to its permanent, unambiguous home keyed by the real
    # Document.id, so `delete_document` can later remove exactly this document's file
    # with no filename globbing. `final_dir` can only already exist here if a *previous*
    # upload already indexed this exact document.id and performed this same rename -
    # which happens precisely when `ingest_file`'s content-hash dedup (see
    # `ingestion_service.ingest_file`) returned that pre-existing, already-indexed
    # `Document` instead of processing this upload's bytes. In that case this upload's
    # freshly written temp file has nothing new to contribute, so discard it rather than
    # leaving it orphaned on disk forever.
    final_dir = uploads_dir / document.id
    if final_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)
    else:
        temp_dir.rename(final_dir)

    return document


@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> None:
    document = db.query(Document).filter_by(id=document_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.source_type == "static":
        raise HTTPException(
            status_code=400,
            detail="Static documents are managed via data/static/ and re-indexed on restart; "
            "remove the file from that directory instead of deleting it here.",
        )

    vector_store.delete_document(document_id)
    # Each upload lives in its own "{uploads_dir}/{document.id}/{original_filename}"
    # subdirectory keyed by the document's own permanent id (see upload_document above),
    # so removal is exact and unambiguous - no filename globbing that could ever match
    # (and delete) a different document's identically-named file.
    shutil.rmtree(Path(settings.uploads_dir) / document_id, ignore_errors=True)
    db.delete(document)
    db.commit()


@router.get("/{document_id}/chunks/{chunk_index}")
def get_chunk(
    document_id: str,
    chunk_index: int,
    vector_store: VectorStore = Depends(get_vector_store),
) -> dict:
    chunk = vector_store.get_chunk(document_id, chunk_index)
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return {
        "document_id": chunk.document_id,
        "filename": chunk.filename,
        "chunk_index": chunk.chunk_index,
        "page_number": chunk.page_number,
        "text": chunk.text,
    }
