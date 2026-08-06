import io

from unittest.mock import patch


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
