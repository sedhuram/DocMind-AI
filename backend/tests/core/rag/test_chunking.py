from app.core.rag.chunking import chunk_text


def test_empty_text_returns_no_chunks():
    assert chunk_text("", chunk_size=1000, chunk_overlap=150) == []
    assert chunk_text("   \n  ", chunk_size=1000, chunk_overlap=150) == []


def test_short_text_returns_single_chunk():
    text = "This is a short paragraph about DocMind AI."
    chunks = chunk_text(text, chunk_size=1000, chunk_overlap=150)
    assert chunks == [text]


def test_long_text_splits_into_overlapping_chunks():
    paragraph = "Sentence number {}. " * 1
    text = "\n\n".join((paragraph.format(i)) * 20 for i in range(10))
    chunks = chunk_text(text, chunk_size=1000, chunk_overlap=150)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 1000
