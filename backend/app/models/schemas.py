from datetime import datetime

from pydantic import BaseModel


class Citation(BaseModel):
    document_id: str
    filename: str
    chunk_index: int
    page_number: int | None = None
    score: float
    source_name: str | None = None
    chunk_id: str | None = None
    upload_timestamp: str | None = None


class ChatSessionOut(BaseModel):
    id: str
    title: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionCreate(BaseModel):
    title: str | None = None


class ChatSessionUpdate(BaseModel):
    title: str


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
    session_id: str = "default"


class ChatMessageOut(BaseModel):
    id: str
    session_id: str
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


class MessageEditRequest(BaseModel):
    content: str


class MindmapNode(BaseModel):
    title: str
    description: str | None = None
    children: list["MindmapNode"] = []


class MindmapResponse(BaseModel):
    title: str
    children: list[MindmapNode] = []


MindmapNode.model_rebuild()
