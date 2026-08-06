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


def test_query_uses_cosine_similarity_not_l2(store):
    # [2.0, 0.0] is NOT unit-normalized, so cosine and L2 distance diverge here.
    # Cosine distance cares only about direction: [2,0] and [1,0] point the same
    # way, so cosine distance ~= 0.0 and score ~= 1.0. L2 distance between these
    # two points is 1.0, which would give a much lower score. If the collection
    # were created with the default L2 space instead of cosine, this test would
    # fail while the identical-vector test above would still pass.
    store.add_chunks(
        document_id="doc-cos",
        filename="cos.pdf",
        source_type="upload",
        chunks=["only chunk"],
        embeddings=[[2.0, 0.0]],
        page_numbers=[1],
    )

    results = store.query(query_embedding=[1.0, 0.0], top_k=1)

    assert len(results) == 1
    assert results[0].score > 0.99


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
    store.add_chunks(
        document_id="doc-4", filename="d.txt", source_type="upload",
        chunks=["c", "d"], embeddings=[[0.0, 1.0], [1.0, 1.0]], page_numbers=[None, None],
    )
    assert store.count() == 4

    store.delete_document("doc-3")

    assert store.count() == 2
    assert store.get_chunk("doc-3", 0) is None
    assert store.get_chunk("doc-3", 1) is None
    other = store.get_chunk("doc-4", 0)
    assert other is not None
    assert other.document_id == "doc-4"
    assert store.get_chunk("doc-4", 1) is not None


def test_get_chunk_returns_none_when_missing(store):
    assert store.get_chunk("missing-doc", 0) is None
