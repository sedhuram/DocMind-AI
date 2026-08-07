from datetime import datetime

from pydantic import BaseModel


class Citation(BaseModel):
    document_id: str
    filename: str
    chunk_index: int
    page_number: int | None = None
    score: float


class DocumentOut(BaseModel):
    id: str
    filename: str
    source_type: str
    status: str
    status_detail: str | None = None
    chunk_count: int
    size_bytes: int
    created_at: datetime
    indexed_at: datetime | None = None

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    message: str


class ChatMessageOut(BaseModel):
    id: str
    role: str
    content: str
    citations: list[Citation] = []
    latency_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    chunks_retrieved: int | None = None
    top_score: float | None = None
    status: str
    provider: str | None = None
    created_at: datetime


class ChunkOut(BaseModel):
    document_id: str
    filename: str
    chunk_index: int
    page_number: int | None = None
    text: str


class ObservabilityRow(BaseModel):
    id: str
    query: str
    latency_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    chunks_retrieved: int | None = None
    top_score: float | None = None
    status: str
    provider: str | None = None
    created_at: datetime


class HealthOut(BaseModel):
    status: str
    gemini_configured: bool
    chroma_document_count: int
    sqlite_ok: bool
    uptime_seconds: int
