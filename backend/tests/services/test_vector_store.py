import pytest

from app.services.vector_store import VectorStore


@pytest.fixture
def store(tmp_path):
    return VectorStore(str(tmp_path / "chroma"))


def test_add_and_query_returns_chunks_by_similarity(store):
    store.add_chunks(
        document_id="doc-1",
        filename="a.pdf",
        source_type="upload",
        chunks=["cats are great pets", "the stock market fell today"],
        embeddings=[[1.0, 0.0], [0.0, 1.0]],
        page_numbers=[1, 2],
    )

    results = store.query(query_embedding=[1.0, 0.0], top_k=1)

    assert len(results) == 1
    assert results[0].document_id == "doc-1"
    assert results[0].chunk_index == 0
    assert results[0].page_number == 1
    assert results[0].score > 0.9


def test_page_number_none_round_trips(store):
    store.add_chunks(
        document_id="doc-2",
        filename="b.docx",
        source_type="static",
        chunks=["some docx content"],
        embeddings=[[0.5, 0.5]],
        page_numbers=[None],
    )

    chunk = store.get_chunk("doc-2", 0)
    assert chunk is not None
    assert chunk.page_number is None


def test_delete_document_removes_its_chunks(store):
    store.add_chunks(
        document_id="doc-3", filename="c.txt", source_type="upload",
        chunks=["a", "b"], embeddings=[[1.0, 0.0], [0.0, 1.0]], page_numbers=[None, None],
    )
    assert store.count() == 2

    store.delete_document("doc-3")

    assert store.count() == 0


def test_get_chunk_returns_none_when_missing(store):
    assert store.get_chunk("missing-doc", 0) is None
