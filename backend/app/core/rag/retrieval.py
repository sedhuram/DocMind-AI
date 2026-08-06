from dataclasses import dataclass

from app.core.config import settings
from app.services.embedding_service import embed_query
from app.services.vector_store import RetrievedChunk, VectorStore


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk]
    context_text: str
    top_score: float
    is_low_confidence: bool


def retrieve(query: str, vector_store: VectorStore) -> RetrievalResult:
    query_embedding = embed_query(query)
    candidates = vector_store.query(query_embedding, settings.retrieval_top_k)

    seen: set[tuple[str, int]] = set()
    deduped: list[RetrievedChunk] = []
    for chunk in candidates:
        key = (chunk.document_id, chunk.chunk_index)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(chunk)

    context_parts: list[str] = []
    included_chunks: list[RetrievedChunk] = []
    total_len = 0
    for i, chunk in enumerate(deduped, start=1):
        location = f"page {chunk.page_number}" if chunk.page_number else f"chunk {chunk.chunk_index}"
        block = f"[Source {i}: {chunk.filename}, {location}]\n{chunk.text}"
        if context_parts and total_len + len(block) > settings.context_char_budget:
            break
        context_parts.append(block)
        included_chunks.append(chunk)
        total_len += len(block)

    top_score = deduped[0].score if deduped else 0.0
    return RetrievalResult(
        chunks=included_chunks,
        context_text="\n\n".join(context_parts),
        top_score=top_score,
        is_low_confidence=top_score < settings.low_confidence_threshold,
    )
