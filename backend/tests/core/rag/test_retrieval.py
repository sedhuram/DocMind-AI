from unittest.mock import patch

from app.core.rag.retrieval import retrieve
from app.services.vector_store import VectorStore


@patch("app.core.rag.retrieval.embed_query", return_value=[1.0, 0.0])
def test_retrieve_builds_context_with_source_headers(mock_embed, tmp_path):
    store = VectorStore(str(tmp_path / "chroma"))
    store.add_chunks(
        document_id="doc-1", filename="handbook.pdf", source_type="upload",
        chunks=["onboarding takes two weeks"], embeddings=[[1.0, 0.0]], page_numbers=[4],
    )

    result = retrieve("how long is onboarding?", store)

    assert len(result.chunks) == 1
    assert "handbook.pdf" in result.context_text
    assert "page 4" in result.context_text
    assert result.top_score > 0.9
    assert result.is_low_confidence is False


@patch("app.core.rag.retrieval.embed_query", return_value=[1.0, 0.0])
def test_retrieve_flags_low_confidence_below_threshold(mock_embed, tmp_path):
    store = VectorStore(str(tmp_path / "chroma"))
    store.add_chunks(
        document_id="doc-2", filename="unrelated.txt", source_type="upload",
        chunks=["completely unrelated content"], embeddings=[[0.0, 1.0]], page_numbers=[None],
    )

    result = retrieve("how long is onboarding?", store)

    assert result.is_low_confidence is True


@patch("app.core.rag.retrieval.embed_query", return_value=[1.0, 0.0])
def test_retrieve_with_empty_store_returns_no_chunks(mock_embed, tmp_path):
    store = VectorStore(str(tmp_path / "chroma"))

    result = retrieve("anything", store)

    assert result.chunks == []
    assert result.context_text == ""
    assert result.top_score == 0.0
    assert result.is_low_confidence is True


@patch("app.core.rag.retrieval.embed_query", return_value=[1.0, 0.0])
def test_retrieve_truncates_context_to_char_budget(mock_embed, tmp_path):
    store = VectorStore(str(tmp_path / "chroma"))
    long_chunk_a = "A" * 4000
    long_chunk_b = "B" * 4000
    store.add_chunks(
        document_id="doc-3", filename="big.txt", source_type="upload",
        chunks=[long_chunk_a, long_chunk_b], embeddings=[[1.0, 0.0], [0.99, 0.01]], page_numbers=[None, None],
    )

    result = retrieve("query", store)

    assert len(result.context_text) < 8000
    assert long_chunk_b not in result.context_text or long_chunk_a not in result.context_text
