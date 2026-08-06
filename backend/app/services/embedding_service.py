import numpy as np
from google import genai
from google.genai import types

from app.core.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed a batch of chunk texts for storage. Returns L2-normalized vectors."""
    return _embed(texts, task_type="RETRIEVAL_DOCUMENT")


def embed_query(text: str) -> list[float]:
    """Embed a single query string for similarity search."""
    return _embed([text], task_type="RETRIEVAL_QUERY")[0]


def _embed(texts: list[str], task_type: str) -> list[list[float]]:
    if not texts:
        return []
    config = types.EmbedContentConfig(
        task_type=task_type,
        output_dimensionality=settings.embedding_dimensions,
    )
    result = _client.models.embed_content(
        model=settings.embedding_model,
        contents=texts,
        config=config,
    )
    return [_normalize(embedding.values) for embedding in result.embeddings]


def _normalize(vector: list[float]) -> list[float]:
    # gemini-embedding-001 does not auto-normalize truncated output_dimensionality
    # values the way gemini-embedding-2 does, so we normalize here to keep cosine
    # similarity meaningful regardless of which embedding model is configured.
    arr = np.array(vector, dtype=float)
    norm = np.linalg.norm(arr)
    if norm == 0:
        return vector
    return (arr / norm).tolist()
