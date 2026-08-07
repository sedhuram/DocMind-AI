import io
from pathlib import Path

from unittest.mock import patch

from app.core.config import settings


def _fake_embeddings(chunks):
    return [[1.0, 0.0] for _ in chunks]


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_upload_txt_file_returns_indexed_document(mock_embed, client):
    file_content = b"DocMind AI answers questions about documents."
    response = client.post(
        "/api/documents/upload",
        files={"file": ("notes.txt", io.BytesIO(file_content), "text/plain")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "notes.txt"
    assert body["source_type"] == "upload"
    assert body["status"] == "indexed"
    assert body["chunk_count"] > 0


def test_upload_rejects_unsupported_extension(client):
    response = client.post(
        "/api/documents/upload",
        files={"file": ("data.xyz", io.BytesIO(b"data"), "application/octet-stream")},
    )

    assert response.status_code == 422


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_upload_rejects_path_traversal_filename(mock_embed, client):
    # `file.filename` is attacker-controlled and Starlette does not sanitize it, so a
    # traversal payload must be reduced to its basename before it is ever joined onto
    # the uploads directory - otherwise this endpoint is an unauthenticated
    # arbitrary-file-write into e.g. data/static/.
    uploads_dir = Path(settings.uploads_dir)
    response = client.post(
        "/api/documents/upload",
        files={"file": ("../../evil.txt", io.BytesIO(b"traversal payload"), "text/plain")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "evil.txt"

    written_file = uploads_dir / body["id"] / "evil.txt"
    assert written_file.exists()

    # Nothing may exist outside uploads_dir: the traversal target would have been
    # uploads_dir.parent.parent / "evil.txt".
    escaped_paths = list(uploads_dir.parent.rglob("evil.txt"))
    assert [p for p in escaped_paths if not p.is_relative_to(uploads_dir)] == []


def test_upload_without_filename_returns_422(client):
    # A missing filename previously reached `Path(None)` and raised an unhandled
    # TypeError (500) instead of a clean validation error.
    response = client.post(
        "/api/documents/upload",
        files={"file": ("", io.BytesIO(b"no name"), "text/plain")},
    )

    assert response.status_code == 422


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_list_documents_returns_uploaded_files(mock_embed, client):
    client.post("/api/documents/upload", files={"file": ("a.txt", io.BytesIO(b"content a"), "text/plain")})

    response = client.get("/api/documents")

    assert response.status_code == 200
    filenames = [doc["filename"] for doc in response.json()]
    assert "a.txt" in filenames


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_delete_uploaded_document_removes_it(mock_embed, client):
    upload = client.post("/api/documents/upload", files={"file": ("b.txt", io.BytesIO(b"content b"), "text/plain")})
    doc_id = upload.json()["id"]

    response = client.delete(f"/api/documents/{doc_id}")

    assert response.status_code == 204
    assert doc_id not in [doc["id"] for doc in client.get("/api/documents").json()]


def test_delete_nonexistent_document_returns_404(client):
    response = client.delete("/api/documents/does-not-exist")
    assert response.status_code == 404


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_get_chunk_returns_text_and_page_number(mock_embed, client):
    upload = client.post("/api/documents/upload", files={"file": ("c.txt", io.BytesIO(b"chunk content here"), "text/plain")})
    doc_id = upload.json()["id"]

    response = client.get(f"/api/documents/{doc_id}/chunks/0")

    assert response.status_code == 200
    assert "chunk content here" in response.json()["text"]


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_delete_one_of_two_same_named_documents_preserves_the_others_file(mock_embed, client):
    # Two uploads sharing a filename but with DIFFERENT content are distinct, non-deduped
    # Document rows with distinct ids. Deleting one must not touch the other's file on disk
    # (regression test for the cross-document data-destruction bug: the old implementation
    # cleaned up by globbing `uploads_dir/*/{filename}`, which matched and unlinked BOTH
    # physical files regardless of which document_id was targeted).
    first = client.post(
        "/api/documents/upload", files={"file": ("dup.txt", io.BytesIO(b"first upload content"), "text/plain")}
    )
    second = client.post(
        "/api/documents/upload", files={"file": ("dup.txt", io.BytesIO(b"second upload content"), "text/plain")}
    )
    first_id = first.json()["id"]
    second_id = second.json()["id"]
    assert first_id != second_id

    response = client.delete(f"/api/documents/{first_id}")
    assert response.status_code == 204

    surviving_path = Path(settings.uploads_dir) / second_id / "dup.txt"
    assert surviving_path.exists()

    chunk_response = client.get(f"/api/documents/{second_id}/chunks/0")
    assert chunk_response.status_code == 200
    assert "second upload content" in chunk_response.json()["text"]


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_upload_of_duplicate_content_does_not_orphan_a_temp_directory(mock_embed, client):
    # Two uploads with IDENTICAL content (different filenames) hit `ingest_file`'s
    # content-hash dedup path: the second call returns the first upload's already-indexed
    # Document unchanged. The second upload's freshly written temp file/subdirectory has
    # nothing new to contribute and must be discarded, not left behind permanently.
    same_content = b"identical bytes for dedup"
    client.post("/api/documents/upload", files={"file": ("one.txt", io.BytesIO(same_content), "text/plain")})
    client.post("/api/documents/upload", files={"file": ("two.txt", io.BytesIO(same_content), "text/plain")})

    subdirs = [p for p in Path(settings.uploads_dir).iterdir() if p.is_dir()]
    assert len(subdirs) == 1
