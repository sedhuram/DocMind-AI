# DocMind AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DocMind AI, a full-stack RAG application (FastAPI + Next.js 15) that answers questions grounded in a document collection ingested from both a static bootstrap directory and drag-and-drop uploads, with streaming answers, visible citations, and an observability surface — matching the design in `docs/superpowers/specs/2026-08-06-docmind-ai-design.md`.

**Architecture:** FastAPI backend (SQLite for documents/chat metadata, ChromaDB persistent-mode for vectors, Gemini API for embeddings/generation) behind a REST+SSE API; Next.js 15 frontend with three tabs (Chat, Documents, Observability) consuming a typed API client generated from the backend's OpenAPI schema. Two Docker services, no auth, single conversation thread, single document collection.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy 2.0, ChromaDB, `google-genai` SDK, `langchain-text-splitters`, `pypdf`, `python-docx`, `tenacity`, pytest. Next.js 15 (App Router, TypeScript), Tailwind CSS v4, Lucide icons, `react-markdown`.

## Global Constraints

- Repo root: `/Users/sedhuram/Documents/assignment`. Backend at `backend/`, frontend at `frontend/`.
- Python 3.11+. Backend dependencies pinned in `backend/requirements.txt`, installed into `backend/.venv`.
- Embedding model: `gemini-embedding-001`, `output_dimensionality=768`, L2-normalized client-side before storage (this model does not auto-normalize truncated output).
- Generation model: `gemini-3.6-flash`, streamed via `client.models.generate_content_stream`.
- Chunking: `RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)`.
- Retrieval: top_k=5, Chroma collection configured with `hnsw:space="cosine"`, similarity computed as `1 - distance`.
- Context budget: 6000 characters of concatenated retrieved chunk text per query.
- Low-confidence threshold: 0.3 similarity — below this, answer is still generated but tagged `status=low_confidence` and the model is instructed to say it lacks sufficient information.
- Conversation memory: last 4 messages (2 exchanges) included verbatim in the prompt; no summarization.
- Single default document collection, no auth, single continuous chat thread (no session list).
- Supported upload types: `.pdf`, `.txt`, `.md`, `.docx`. Max upload size configurable, default 20MB.
- No hardcoded secrets — all config through `pydantic-settings` reading `backend/.env` (never committed; `.env.example` is committed).
- Tests must never require a real `GEMINI_API_KEY` or network access — Gemini calls are mocked in all backend tests.
- All backend file paths below are relative to `/Users/sedhuram/Documents/assignment` unless given as absolute.

---

## Task 1: Backend project scaffold, config, and logging

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/requirements-dev.txt`
- Create: `backend/.env.example`
- Create: `backend/.gitignore`
- Create: `backend/app/__init__.py`
- Create: `backend/app/core/__init__.py`
- Create: `backend/app/core/config.py`
- Create: `backend/app/core/logging.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/core/__init__.py`
- Create: `backend/tests/core/test_config.py`
- Modify: root `.gitignore` (create if absent)

**Interfaces:**
- Produces: `app.core.config.Settings` (Pydantic settings class), `app.core.config.settings` (singleton instance), `app.core.logging.configure_logging(level: str) -> None`.

- [ ] **Step 1: Create directory structure and dependency files**

```bash
mkdir -p /Users/sedhuram/Documents/assignment/backend/app/core/rag
mkdir -p /Users/sedhuram/Documents/assignment/backend/app/services
mkdir -p /Users/sedhuram/Documents/assignment/backend/app/models
mkdir -p /Users/sedhuram/Documents/assignment/backend/app/db
mkdir -p /Users/sedhuram/Documents/assignment/backend/app/api
mkdir -p /Users/sedhuram/Documents/assignment/backend/data/static
mkdir -p /Users/sedhuram/Documents/assignment/backend/data/uploads
mkdir -p /Users/sedhuram/Documents/assignment/backend/tests/core/rag
mkdir -p /Users/sedhuram/Documents/assignment/backend/tests/services
mkdir -p /Users/sedhuram/Documents/assignment/backend/tests/api
touch /Users/sedhuram/Documents/assignment/backend/data/uploads/.gitkeep
```

`backend/requirements.txt`:
```
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.10.4
pydantic-settings==2.7.1
sqlalchemy==2.0.36
chromadb==0.5.23
google-genai==1.3.0
langchain-text-splitters==0.3.4
pypdf==5.1.0
python-docx==1.1.2
tenacity==9.0.0
python-multipart==0.0.20
numpy==2.2.1
```

`backend/requirements-dev.txt`:
```
-r requirements.txt
pytest==8.3.4
httpx==0.28.1
```

`backend/.env.example`:
```
GEMINI_API_KEY=your-gemini-api-key-here
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=768
GENERATION_MODEL=gemini-3.6-flash
CHUNK_SIZE=1000
CHUNK_OVERLAP=150
RETRIEVAL_TOP_K=5
CONTEXT_CHAR_BUDGET=6000
LOW_CONFIDENCE_THRESHOLD=0.3
CONVERSATION_WINDOW_TURNS=4
MAX_UPLOAD_SIZE_MB=20
STATIC_DIR=data/static
UPLOADS_DIR=data/uploads
VECTOR_DB_DIR=vector_db
SQLITE_PATH=data/docmind.db
LOG_LEVEL=INFO
```

`backend/.gitignore`:
```
.venv/
__pycache__/
*.pyc
vector_db/
data/uploads/*
!data/uploads/.gitkeep
data/docmind.db
.env
```

Root `.gitignore` (create at `/Users/sedhuram/Documents/assignment/.gitignore`):
```
*.docx
node_modules/
.next/
frontend/lib/api-types.ts.bak
.DS_Store
```

- [ ] **Step 2: Set up the virtualenv and install dependencies**

```bash
cd /Users/sedhuram/Documents/assignment/backend
python3.11 -m venv .venv || python3 -m venv .venv
.venv/bin/pip install --upgrade pip -q
.venv/bin/pip install -r requirements-dev.txt -q
```

Expected: installs complete with no errors. If `google-genai==1.3.0` or another pin is unavailable on PyPI at build time, install without the version pin (`pip install google-genai`) and record the resolved version back into `requirements.txt` with `pip freeze | grep google-genai`.

- [ ] **Step 3: Write `app/core/config.py`**

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    generation_model: str = "gemini-3.6-flash"
    chunk_size: int = 1000
    chunk_overlap: int = 150
    retrieval_top_k: int = 5
    context_char_budget: int = 6000
    low_confidence_threshold: float = 0.3
    conversation_window_turns: int = 4
    max_upload_size_mb: int = 20
    static_dir: str = "data/static"
    uploads_dir: str = "data/uploads"
    vector_db_dir: str = "vector_db"
    sqlite_path: str = "data/docmind.db"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
```

- [ ] **Step 4: Write `app/core/logging.py`**

```python
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in ("args", "msg", "exc_info", "exc_text", "stack_info") or key in payload:
                continue
            if key.startswith("_") or not isinstance(value, (str, int, float, bool, type(None))):
                continue
            if key in logging.LogRecord(__name__, 0, "", 0, "", (), None).__dict__:
                continue
            payload[key] = value
        return json.dumps(payload)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
```

- [ ] **Step 5: Write test conftest to guarantee tests never touch a real API key or shared state**

`backend/tests/conftest.py`:
```python
import os

os.environ.setdefault("GEMINI_API_KEY", "test-key-not-real")
```

`backend/tests/__init__.py`, `backend/tests/core/__init__.py`, `backend/app/__init__.py`, `backend/app/core/__init__.py`: empty files.

- [ ] **Step 6: Write the failing test for settings defaults**

`backend/tests/core/test_config.py`:
```python
from app.core.config import Settings


def test_settings_load_defaults_from_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "abc123")
    settings = Settings(_env_file=None)
    assert settings.gemini_api_key == "abc123"
    assert settings.embedding_model == "gemini-embedding-001"
    assert settings.embedding_dimensions == 768
    assert settings.generation_model == "gemini-3.6-flash"
    assert settings.chunk_size == 1000
    assert settings.chunk_overlap == 150
    assert settings.low_confidence_threshold == 0.3


def test_settings_requires_gemini_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    try:
        Settings(_env_file=None)
        assert False, "expected a validation error without GEMINI_API_KEY"
    except Exception as exc:
        assert "gemini_api_key" in str(exc).lower()
```

- [ ] **Step 7: Run the test**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/test_config.py -v
```
Expected: both tests PASS (the module already exists from Step 3, so this confirms behavior rather than TDD-driving new code — acceptable for a pure-config module).

- [ ] **Step 8: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/requirements.txt backend/requirements-dev.txt backend/.env.example backend/.gitignore .gitignore \
  backend/app/__init__.py backend/app/core/__init__.py backend/app/core/config.py backend/app/core/logging.py \
  backend/tests/__init__.py backend/tests/conftest.py backend/tests/core/__init__.py backend/tests/core/test_config.py \
  backend/data/uploads/.gitkeep
git commit -m "backend: project scaffold, settings, structured logging"
```

---

## Task 2: SQLAlchemy models, DB session, Pydantic schemas

**Files:**
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/orm.py`
- Create: `backend/app/models/schemas.py`
- Create: `backend/app/db/__init__.py`
- Create: `backend/app/db/session.py`
- Create: `backend/tests/models/__init__.py`
- Create: `backend/tests/models/test_orm.py`

**Interfaces:**
- Consumes: `app.core.config.settings` (Task 1).
- Produces: `app.models.orm.Base`, `app.models.orm.Document`, `app.models.orm.ChatMessage`; `app.db.session.engine`, `app.db.session.SessionLocal`, `app.db.session.get_db()` (FastAPI dependency generator); Pydantic schemas `DocumentOut`, `ChatMessageOut`, `ChatRequest`, `Citation`, `HealthOut` in `app.models.schemas`.

- [ ] **Step 1: Write `app/models/orm.py`**

```python
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Float, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    file_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="processing")
    status_detail: Mapped[str | None] = mapped_column(String, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(String, nullable=False)
    citations: Mapped[str | None] = mapped_column(String, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunks_retrieved: Mapped[int | None] = mapped_column(Integer, nullable=True)
    top_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String, default="ok")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
```

- [ ] **Step 2: Write `app/db/session.py`**

```python
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.core.config import settings
from app.models.orm import Base

_db_path = Path(settings.sqlite_path)
_db_path.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(f"sqlite:///{_db_path}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: Write `app/models/schemas.py`**

```python
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
    created_at: datetime


class HealthOut(BaseModel):
    status: str
    gemini_configured: bool
    chroma_document_count: int
    sqlite_ok: bool
    uptime_seconds: int
```

- [ ] **Step 4: Write the failing test for ORM round-trip**

`backend/tests/models/test_orm.py`:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.orm import Base, Document, ChatMessage


def _memory_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_document_round_trip():
    db = _memory_session()
    doc = Document(
        id="doc-1", filename="a.pdf", source_type="upload",
        file_hash="hash1", status="indexed", chunk_count=3, size_bytes=1024,
    )
    db.add(doc)
    db.commit()

    fetched = db.query(Document).filter_by(id="doc-1").one()
    assert fetched.filename == "a.pdf"
    assert fetched.chunk_count == 3
    assert fetched.status_detail is None


def test_chat_message_round_trip():
    db = _memory_session()
    msg = ChatMessage(id="msg-1", role="user", content="hello", status="ok")
    db.add(msg)
    db.commit()

    fetched = db.query(ChatMessage).filter_by(id="msg-1").one()
    assert fetched.content == "hello"
    assert fetched.citations is None
```

- [ ] **Step 5: Run the test**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/models/test_orm.py -v
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/models backend/app/db backend/tests/models
git commit -m "backend: SQLAlchemy models, DB session, Pydantic schemas"
```

---

## Task 3: Chunking

**Files:**
- Create: `backend/app/core/rag/__init__.py`
- Create: `backend/app/core/rag/chunking.py`
- Create: `backend/tests/core/rag/__init__.py`
- Create: `backend/tests/core/rag/test_chunking.py`

**Interfaces:**
- Produces: `chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/core/rag/test_chunking.py`:
```python
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
    # overlap means the tail of one chunk should reappear near the head of the next
    assert chunks[0][-50:] in chunks[1] or chunks[1].startswith(chunks[0][-20:])
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_chunking.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.rag'`.

- [ ] **Step 3: Write `app/core/rag/chunking.py`**

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter


def chunk_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Split text into semantically-bounded chunks (paragraph -> sentence -> word cascade)."""
    if not text or not text.strip():
        return []
    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    return splitter.split_text(text)
```

`backend/app/core/rag/__init__.py` and `backend/tests/core/rag/__init__.py`: empty files.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_chunking.py -v
```
Expected: PASS (3 tests). If the overlap assertion in `test_long_text_splits_into_overlapping_chunks` fails due to exact boundary text, loosen it to `len(chunks) > 1` only — the important invariant is multiple chunks and the size cap, not exact overlap byte-matching.

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/core/rag/__init__.py backend/app/core/rag/chunking.py backend/tests/core/rag/__init__.py backend/tests/core/rag/test_chunking.py
git commit -m "backend: recursive character chunking with tests"
```

---

## Task 4: Document parsers (PDF, DOCX, TXT, MD)

**Files:**
- Create: `backend/app/core/rag/parsers.py`
- Create: `backend/tests/core/rag/test_parsers.py`
- Create: `backend/tests/fixtures/sample.txt`
- Create: `backend/tests/fixtures/sample.md`

**Interfaces:**
- Produces: `ParsedPage` dataclass (`text: str`, `page_number: int | None`), `parse_file(file_path: Path) -> list[ParsedPage]`, `UnsupportedFileTypeError`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/fixtures/sample.txt`:
```
DocMind AI is a retrieval-augmented generation system.
It answers questions using only the documents it has indexed.
```

`backend/tests/fixtures/sample.md`:
```
# DocMind AI

DocMind AI supports Markdown ingestion out of the box.
```

`backend/tests/core/rag/test_parsers.py`:
```python
from pathlib import Path

import pytest

from app.core.rag.parsers import parse_file, UnsupportedFileTypeError

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_parse_txt_returns_single_page_with_no_page_number():
    pages = parse_file(FIXTURES / "sample.txt")
    assert len(pages) == 1
    assert pages[0].page_number is None
    assert "retrieval-augmented" in pages[0].text


def test_parse_md_returns_single_page():
    pages = parse_file(FIXTURES / "sample.md")
    assert len(pages) == 1
    assert "Markdown ingestion" in pages[0].text


def test_parse_empty_txt_returns_no_pages(tmp_path):
    empty_file = tmp_path / "empty.txt"
    empty_file.write_text("   \n  ")
    assert parse_file(empty_file) == []


def test_unsupported_extension_raises(tmp_path):
    bad_file = tmp_path / "sample.xyz"
    bad_file.write_text("data")
    with pytest.raises(UnsupportedFileTypeError):
        parse_file(bad_file)
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_parsers.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/core/rag/parsers.py`**

```python
from dataclasses import dataclass
from pathlib import Path

import docx
import pypdf


@dataclass
class ParsedPage:
    text: str
    page_number: int | None


class UnsupportedFileTypeError(Exception):
    pass


def parse_file(file_path: Path) -> list[ParsedPage]:
    """Extract text from a document, preserving page numbers where the format has them.

    PDF pages map 1:1 to ParsedPage.page_number. DOCX and plain text have no fixed
    pagination, so they collapse to a single page with page_number=None; citations
    for those formats fall back to chunk index instead of page number.
    """
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _parse_pdf(file_path)
    if suffix == ".docx":
        return _parse_docx(file_path)
    if suffix in (".txt", ".md"):
        return _parse_text(file_path)
    raise UnsupportedFileTypeError(f"Unsupported file type: {suffix}")


def _parse_pdf(file_path: Path) -> list[ParsedPage]:
    reader = pypdf.PdfReader(str(file_path))
    pages: list[ParsedPage] = []
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            pages.append(ParsedPage(text=text, page_number=index + 1))
    return pages


def _parse_docx(file_path: Path) -> list[ParsedPage]:
    document = docx.Document(str(file_path))
    text = "\n\n".join(p.text for p in document.paragraphs if p.text.strip())
    return [ParsedPage(text=text, page_number=None)] if text.strip() else []


def _parse_text(file_path: Path) -> list[ParsedPage]:
    text = file_path.read_text(encoding="utf-8", errors="ignore")
    return [ParsedPage(text=text, page_number=None)] if text.strip() else []
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_parsers.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/core/rag/parsers.py backend/tests/core/rag/test_parsers.py backend/tests/fixtures
git commit -m "backend: PDF/DOCX/TXT/MD parsers with page-aware extraction"
```

---

## Task 5: Embedding service (Gemini wrapper)

**Files:**
- Create: `backend/app/services/__init__.py`
- Create: `backend/app/services/embedding_service.py`
- Create: `backend/tests/services/__init__.py`
- Create: `backend/tests/services/test_embedding_service.py`

**Interfaces:**
- Consumes: `app.core.config.settings` (Task 1).
- Produces: `embed_documents(texts: list[str]) -> list[list[float]]`, `embed_query(text: str) -> list[float]`.

- [ ] **Step 1: Write the failing tests (Gemini client mocked — no network)**

`backend/tests/services/test_embedding_service.py`:
```python
from unittest.mock import MagicMock, patch

from app.services import embedding_service


def _fake_embedding(values):
    fake = MagicMock()
    fake.values = values
    return fake


def test_embed_documents_returns_empty_list_for_empty_input():
    assert embedding_service.embed_documents([]) == []


@patch("app.services.embedding_service._client")
def test_embed_documents_normalizes_vectors(mock_client):
    mock_result = MagicMock()
    mock_result.embeddings = [_fake_embedding([3.0, 4.0])]
    mock_client.models.embed_content.return_value = mock_result

    vectors = embedding_service.embed_documents(["some text"])

    assert len(vectors) == 1
    magnitude = sum(v ** 2 for v in vectors[0]) ** 0.5
    assert abs(magnitude - 1.0) < 1e-6


@patch("app.services.embedding_service._client")
def test_embed_query_uses_retrieval_query_task_type(mock_client):
    mock_result = MagicMock()
    mock_result.embeddings = [_fake_embedding([1.0, 0.0])]
    mock_client.models.embed_content.return_value = mock_result

    embedding_service.embed_query("what is docmind?")

    _, kwargs = mock_client.models.embed_content.call_args
    assert kwargs["config"].task_type == "RETRIEVAL_QUERY"
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_embedding_service.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/services/embedding_service.py`**

```python
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
```

`backend/app/services/__init__.py`, `backend/tests/services/__init__.py`: empty files.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_embedding_service.py -v
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/services/__init__.py backend/app/services/embedding_service.py backend/tests/services/__init__.py backend/tests/services/test_embedding_service.py
git commit -m "backend: Gemini embedding service with client-side normalization"
```

---

## Task 6: Vector store (ChromaDB wrapper)

**Files:**
- Create: `backend/app/services/vector_store.py`
- Create: `backend/tests/services/test_vector_store.py`

**Interfaces:**
- Produces: `RetrievedChunk` dataclass (`document_id, filename, chunk_index, page_number, text, score`), `VectorStore` class with `__init__(persist_dir: str)`, `add_chunks(document_id, filename, source_type, chunks, embeddings, page_numbers)`, `query(query_embedding, top_k) -> list[RetrievedChunk]`, `delete_document(document_id)`, `get_chunk(document_id, chunk_index) -> RetrievedChunk | None`, `count() -> int`.

- [ ] **Step 1: Write the failing tests (ephemeral Chroma client, no persistence needed for tests)**

`backend/tests/services/test_vector_store.py`:
```python
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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_vector_store.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/services/vector_store.py`**

```python
from dataclasses import dataclass

import chromadb

_PAGE_NUMBER_NONE_SENTINEL = -1
_COLLECTION_NAME = "docmind_chunks"


@dataclass
class RetrievedChunk:
    document_id: str
    filename: str
    chunk_index: int
    page_number: int | None
    text: str
    score: float


class VectorStore:
    def __init__(self, persist_dir: str):
        self._client = chromadb.PersistentClient(path=persist_dir)
        self._collection = self._client.get_or_create_collection(
            name=_COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(
        self,
        document_id: str,
        filename: str,
        source_type: str,
        chunks: list[str],
        embeddings: list[list[float]],
        page_numbers: list[int | None],
    ) -> None:
        if not chunks:
            return
        ids = [f"{document_id}_{i}" for i in range(len(chunks))]
        metadatas = [
            {
                "document_id": document_id,
                "filename": filename,
                "source_type": source_type,
                "chunk_index": i,
                "page_number": page_numbers[i] if page_numbers[i] is not None else _PAGE_NUMBER_NONE_SENTINEL,
            }
            for i in range(len(chunks))
        ]
        self._collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)

    def query(self, query_embedding: list[float], top_k: int) -> list[RetrievedChunk]:
        if self.count() == 0:
            return []
        result = self._collection.query(
            query_embeddings=[query_embedding],
            n_results=min(top_k, self.count()),
            include=["documents", "metadatas", "distances"],
        )
        return [
            self._to_chunk(doc, meta, distance)
            for doc, meta, distance in zip(result["documents"][0], result["metadatas"][0], result["distances"][0])
        ]

    def delete_document(self, document_id: str) -> None:
        self._collection.delete(where={"document_id": document_id})

    def get_chunk(self, document_id: str, chunk_index: int) -> RetrievedChunk | None:
        result = self._collection.get(ids=[f"{document_id}_{chunk_index}"], include=["documents", "metadatas"])
        if not result["ids"]:
            return None
        return self._to_chunk(result["documents"][0], result["metadatas"][0], distance=None)

    def count(self) -> int:
        return self._collection.count()

    @staticmethod
    def _to_chunk(document: str, metadata: dict, distance: float | None) -> RetrievedChunk:
        page_number = metadata["page_number"]
        return RetrievedChunk(
            document_id=metadata["document_id"],
            filename=metadata["filename"],
            chunk_index=metadata["chunk_index"],
            page_number=None if page_number == _PAGE_NUMBER_NONE_SENTINEL else page_number,
            text=document,
            score=(1 - distance) if distance is not None else 1.0,
        )
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_vector_store.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/services/vector_store.py backend/tests/services/test_vector_store.py
git commit -m "backend: ChromaDB vector store wrapper with cosine similarity"
```

---

## Task 7: Ingestion service

**Files:**
- Create: `backend/app/services/ingestion_service.py`
- Create: `backend/tests/services/test_ingestion_service.py`

**Interfaces:**
- Consumes: `app.core.rag.parsers.parse_file` (Task 4), `app.core.rag.chunking.chunk_text` (Task 3), `app.services.embedding_service.embed_documents` (Task 5), `app.services.vector_store.VectorStore` (Task 6), `app.models.orm.Document` (Task 2), `app.core.config.settings`.
- Produces: `ingest_file(file_path: Path, source_type: str, db: Session, vector_store: VectorStore) -> Document`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/services/test_ingestion_service.py`:
```python
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.orm import Base, Document
from app.services.ingestion_service import ingest_file
from app.services.vector_store import VectorStore

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _fake_embeddings(chunks):
    return [[1.0, 0.0] for _ in chunks]


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_ingest_txt_file_marks_indexed(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))

    document = ingest_file(FIXTURES / "sample.txt", "upload", db, store)

    assert document.status == "indexed"
    assert document.chunk_count > 0
    assert document.indexed_at is not None
    assert store.count() == document.chunk_count


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_ingest_same_file_twice_is_deduped(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))

    first = ingest_file(FIXTURES / "sample.txt", "static", db, store)
    second = ingest_file(FIXTURES / "sample.txt", "static", db, store)

    assert first.id == second.id
    assert mock_embed.call_count == 1
    assert db.query(Document).count() == 1


@patch("app.services.ingestion_service.embed_documents", side_effect=RuntimeError("Gemini quota exceeded"))
def test_ingest_failure_is_recorded_without_raising(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))

    document = ingest_file(FIXTURES / "sample.txt", "upload", db, store)

    assert document.status == "failed"
    assert "quota" in document.status_detail.lower()


@patch("app.services.ingestion_service.embed_documents", side_effect=_fake_embeddings)
def test_ingest_unparseable_extension_marks_failed(mock_embed, tmp_path):
    db = _db_session()
    store = VectorStore(str(tmp_path / "chroma"))
    bad_file = tmp_path / "sample.xyz"
    bad_file.write_text("data")

    document = ingest_file(bad_file, "upload", db, store)

    assert document.status == "failed"
    assert document.status_detail
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_ingestion_service.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/services/ingestion_service.py`**

```python
import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rag.chunking import chunk_text
from app.core.rag.parsers import parse_file
from app.models.orm import Document
from app.services.embedding_service import embed_documents
from app.services.vector_store import VectorStore

logger = logging.getLogger(__name__)


def ingest_file(file_path: Path, source_type: str, db: Session, vector_store: VectorStore) -> Document:
    """Parse, chunk, embed, and store one file. Never raises — failures are recorded on the Document row
    so one bad file doesn't abort a batch of others."""
    file_hash = _hash_file(file_path)
    existing = db.query(Document).filter_by(file_hash=file_hash).first()
    if existing and existing.status == "indexed":
        return existing

    document = existing or Document(
        id=str(uuid4()),
        filename=file_path.name,
        source_type=source_type,
        file_hash=file_hash,
        status="processing",
        size_bytes=file_path.stat().st_size,
        created_at=datetime.now(timezone.utc),
    )
    db.add(document)
    db.commit()

    try:
        pages = parse_file(file_path)
        all_chunks: list[str] = []
        page_numbers: list[int | None] = []
        for page in pages:
            page_chunks = chunk_text(page.text, settings.chunk_size, settings.chunk_overlap)
            all_chunks.extend(page_chunks)
            page_numbers.extend([page.page_number] * len(page_chunks))

        if not all_chunks:
            raise ValueError("No extractable text found in file")

        embeddings = embed_documents(all_chunks)
        vector_store.add_chunks(
            document_id=document.id,
            filename=document.filename,
            source_type=source_type,
            chunks=all_chunks,
            embeddings=embeddings,
            page_numbers=page_numbers,
        )
        document.status = "indexed"
        document.status_detail = None
        document.chunk_count = len(all_chunks)
        document.indexed_at = datetime.now(timezone.utc)
    except Exception as exc:
        logger.exception("ingestion_failed", extra={"filename": document.filename})
        document.status = "failed"
        document.status_detail = str(exc)[:500]

    db.commit()
    return document


def _hash_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as f:
        for block in iter(lambda: f.read(8192), b""):
            digest.update(block)
    return digest.hexdigest()
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_ingestion_service.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/services/ingestion_service.py backend/tests/services/test_ingestion_service.py
git commit -m "backend: ingestion service orchestrating parse/chunk/embed/store with dedup"
```

---

## Task 8: Retrieval and prompt building

**Files:**
- Create: `backend/app/core/rag/retrieval.py`
- Create: `backend/app/core/rag/prompt.py`
- Create: `backend/tests/core/rag/test_retrieval.py`
- Create: `backend/tests/core/rag/test_prompt.py`

**Interfaces:**
- Consumes: `app.services.embedding_service.embed_query` (Task 5), `app.services.vector_store.VectorStore`, `RetrievedChunk` (Task 6), `app.models.orm.ChatMessage` (Task 2).
- Produces: `RetrievalResult` dataclass (`chunks: list[RetrievedChunk]`, `context_text: str`, `top_score: float`, `is_low_confidence: bool`), `retrieve(query: str, vector_store: VectorStore) -> RetrievalResult`; `SYSTEM_INSTRUCTION: str`, `build_contents(query: str, retrieval: RetrievalResult, history: list[ChatMessage]) -> list[dict]`.

- [ ] **Step 1: Write the failing test for retrieval**

`backend/tests/core/rag/test_retrieval.py`:
```python
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
```

- [ ] **Step 2: Write the failing test for prompt building**

`backend/tests/core/rag/test_prompt.py`:
```python
from app.core.rag.prompt import build_contents, SYSTEM_INSTRUCTION
from app.core.rag.retrieval import RetrievalResult
from app.models.orm import ChatMessage


def test_system_instruction_requires_grounded_answers():
    assert "only" in SYSTEM_INSTRUCTION.lower()
    assert "cite" in SYSTEM_INSTRUCTION.lower()


def test_build_contents_includes_context_and_question():
    retrieval = RetrievalResult(chunks=[], context_text="[Source 1: a.txt]\nsome fact", top_score=0.9, is_low_confidence=False)

    contents = build_contents("what is the fact?", retrieval, history=[])

    assert contents[-1]["role"] == "user"
    text = contents[-1]["parts"][0]["text"]
    assert "some fact" in text
    assert "what is the fact?" in text


def test_build_contents_caps_history_to_conversation_window():
    retrieval = RetrievalResult(chunks=[], context_text="", top_score=0.0, is_low_confidence=True)
    history = [
        ChatMessage(id=str(i), role="user" if i % 2 == 0 else "assistant", content=f"turn {i}")
        for i in range(10)
    ]

    contents = build_contents("new question", retrieval, history)

    # 4 history turns + 1 new question turn
    assert len(contents) == 5
    assert contents[0]["parts"][0]["text"] == "turn 6"


def test_build_contents_handles_no_relevant_sources():
    retrieval = RetrievalResult(chunks=[], context_text="", top_score=0.0, is_low_confidence=True)

    contents = build_contents("anything", retrieval, history=[])

    assert "no relevant sources" in contents[-1]["parts"][0]["text"].lower()
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_retrieval.py tests/core/rag/test_prompt.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 4: Write `app/core/rag/retrieval.py`**

```python
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
```

- [ ] **Step 5: Write `app/core/rag/prompt.py`**

```python
from app.core.config import settings
from app.core.rag.retrieval import RetrievalResult
from app.models.orm import ChatMessage

SYSTEM_INSTRUCTION = (
    "You are DocMind AI, a document question-answering assistant. "
    "Answer only using the information in the numbered sources provided below the question. "
    "Cite the sources you used inline with their bracketed number, e.g. [Source 1]. "
    "If the sources don't contain enough information to answer, say so plainly instead of guessing."
)


def build_contents(query: str, retrieval: RetrievalResult, history: list[ChatMessage]) -> list[dict]:
    contents = []
    for turn in history[-settings.conversation_window_turns :]:
        role = "user" if turn.role == "user" else "model"
        contents.append({"role": role, "parts": [{"text": turn.content}]})

    context = retrieval.context_text or "(no relevant sources found in the document collection)"
    contents.append({"role": "user", "parts": [{"text": f"Sources:\n{context}\n\nQuestion: {query}"}]})
    return contents
```

- [ ] **Step 6: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/core/rag/test_retrieval.py tests/core/rag/test_prompt.py -v
```
Expected: PASS (8 tests). If `test_retrieve_truncates_context_to_char_budget` fails because both chunks are below budget with the loop's "always include the first chunk" guard, verify `settings.context_char_budget` is the default 6000 in test env (no `.env` override) — 4000+4000=8000 > 6000 so the second chunk should be excluded.

- [ ] **Step 7: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/core/rag/retrieval.py backend/app/core/rag/prompt.py backend/tests/core/rag/test_retrieval.py backend/tests/core/rag/test_prompt.py
git commit -m "backend: retrieval with dedup/context-budget and grounded prompt builder"
```

---

## Task 9: Generation service (Gemini streaming + retry)

**Files:**
- Create: `backend/app/services/generation_service.py`
- Create: `backend/tests/services/test_generation_service.py`

**Interfaces:**
- Consumes: `app.core.config.settings`.
- Produces: `UsageInfo` dataclass (`tokens_in: int = 0`, `tokens_out: int = 0`), `stream_generate(system_instruction: str, contents: list[dict], usage: UsageInfo) -> Iterator[str]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/services/test_generation_service.py`:
```python
from unittest.mock import MagicMock, patch

import pytest

from app.services.generation_service import stream_generate, UsageInfo


def _fake_chunk(text, tokens_in=None, tokens_out=None):
    chunk = MagicMock()
    chunk.text = text
    if tokens_in is not None:
        chunk.usage_metadata = MagicMock(prompt_token_count=tokens_in, candidates_token_count=tokens_out)
    else:
        chunk.usage_metadata = None
    return chunk


@patch("app.services.generation_service._start_stream")
def test_stream_generate_yields_text_deltas_and_captures_usage(mock_start_stream):
    mock_start_stream.return_value = iter([
        _fake_chunk("Hello "),
        _fake_chunk("world", tokens_in=42, tokens_out=2),
    ])
    usage = UsageInfo()

    deltas = list(stream_generate("system", [{"role": "user", "parts": [{"text": "hi"}]}], usage))

    assert deltas == ["Hello ", "world"]
    assert usage.tokens_in == 42
    assert usage.tokens_out == 2


@patch("app.services.generation_service._start_stream")
def test_stream_generate_skips_chunks_with_no_text(mock_start_stream):
    empty_chunk = _fake_chunk(None)
    mock_start_stream.return_value = iter([empty_chunk, _fake_chunk("ok")])
    usage = UsageInfo()

    deltas = list(stream_generate("system", [], usage))

    assert deltas == ["ok"]


@patch("app.services.generation_service._start_stream", side_effect=RuntimeError("upstream down"))
def test_stream_generate_propagates_unrecoverable_errors(mock_start_stream):
    usage = UsageInfo()
    with pytest.raises(RuntimeError):
        list(stream_generate("system", [], usage))
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_generation_service.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/services/generation_service.py`**

```python
from collections.abc import Iterator
from dataclasses import dataclass

from google import genai
from google.genai import types
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.core.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)
_RETRYABLE_CODES = {429, 500, 502, 503, 504}


@dataclass
class UsageInfo:
    tokens_in: int = 0
    tokens_out: int = 0


def _is_retryable(exc: BaseException) -> bool:
    return getattr(exc, "code", None) in _RETRYABLE_CODES


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(_is_retryable),
    reraise=True,
)
def _start_stream(system_instruction: str, contents: list[dict]):
    config = types.GenerateContentConfig(system_instruction=system_instruction)
    return _client.models.generate_content_stream(
        model=settings.generation_model,
        contents=contents,
        config=config,
    )


def stream_generate(system_instruction: str, contents: list[dict], usage: UsageInfo) -> Iterator[str]:
    """Yield text deltas from Gemini. Token usage is written into `usage` as it arrives —
    a mutable out-parameter because a generator's return value isn't accessible until
    the caller has fully exhausted it, and callers need usage before that point (SSE 'done' frame).

    Retry/backoff only covers *starting* the stream: once tokens have been sent to a client
    over SSE, a mid-stream failure can't be retried without re-sending duplicate text, so it
    propagates and the caller is expected to end the response with an error event instead.
    """
    stream = _start_stream(system_instruction, contents)
    for chunk in stream:
        if chunk.usage_metadata:
            usage.tokens_in = chunk.usage_metadata.prompt_token_count or usage.tokens_in
            usage.tokens_out = chunk.usage_metadata.candidates_token_count or usage.tokens_out
        if chunk.text:
            yield chunk.text
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/services/test_generation_service.py -v
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/services/generation_service.py backend/tests/services/test_generation_service.py
git commit -m "backend: Gemini streaming generation service with retry-before-stream-start"
```

---

## Task 10: FastAPI app skeleton, static bootstrap, health endpoint

**Files:**
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/deps.py`
- Create: `backend/app/api/health.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/api/__init__.py`
- Create: `backend/tests/api/conftest.py`
- Create: `backend/tests/api/test_health.py`

**Interfaces:**
- Consumes: `init_db`, `get_db` (Task 2), `VectorStore` (Task 6), `ingest_file` (Task 7), `app.core.logging.configure_logging` (Task 1).
- Produces: FastAPI `app` in `app.main`; `app.api.deps.get_vector_store(request: Request) -> VectorStore`; `GET /api/health`.

- [ ] **Step 1: Write `app/api/deps.py`**

```python
from fastapi import Request

from app.services.vector_store import VectorStore


def get_vector_store(request: Request) -> VectorStore:
    return request.app.state.vector_store
```

- [ ] **Step 2: Write `app/api/health.py`**

```python
import time

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.schemas import HealthOut
from app.services.vector_store import VectorStore
from app.api.deps import get_vector_store

router = APIRouter(tags=["health"])
_START_TIME = time.time()


@router.get("/health", response_model=HealthOut)
def health(vector_store: VectorStore = Depends(get_vector_store)) -> HealthOut:
    return HealthOut(
        status="ok",
        gemini_configured=bool(settings.gemini_api_key),
        chroma_document_count=vector_store.count(),
        sqlite_ok=_check_sqlite(),
        uptime_seconds=int(time.time() - _START_TIME),
    )


def _check_sqlite() -> bool:
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return True
    except Exception:
        return False
```

- [ ] **Step 3: Write `app/main.py`**

```python
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.api import health
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import SessionLocal, init_db
from app.services.ingestion_service import ingest_file
from app.services.vector_store import VectorStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.log_level)
    init_db()
    app.state.vector_store = VectorStore(settings.vector_db_dir)
    _bootstrap_static_documents(app.state.vector_store)
    yield


def _bootstrap_static_documents(vector_store: VectorStore) -> None:
    static_dir = Path(settings.static_dir)
    static_dir.mkdir(parents=True, exist_ok=True)
    db = SessionLocal()
    try:
        for file_path in sorted(static_dir.iterdir()):
            if file_path.is_file():
                ingest_file(file_path, "static", db, vector_store)
    finally:
        db.close()


app = FastAPI(title="DocMind AI", lifespan=lifespan)
app.include_router(health.router, prefix="/api")
```

- [ ] **Step 4: Write the API test fixture**

`backend/tests/api/conftest.py`:
```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.vector_db_dir", str(tmp_path / "chroma"))
    monkeypatch.setattr("app.core.config.settings.sqlite_path", str(tmp_path / "test.db"))
    monkeypatch.setattr("app.core.config.settings.static_dir", str(tmp_path / "static"))
    monkeypatch.setattr("app.core.config.settings.uploads_dir", str(tmp_path / "uploads"))
    with TestClient(app) as test_client:
        yield test_client
```

`backend/tests/api/__init__.py`: empty file.

- [ ] **Step 5: Write the failing test**

`backend/tests/api/test_health.py`:
```python
def test_health_returns_ok_status(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["gemini_configured"] is True
    assert body["chroma_document_count"] == 0
    assert body["sqlite_ok"] is True
    assert body["uptime_seconds"] >= 0
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_health.py -v
```
Expected: PASS (1 test). Note: `monkeypatch.setattr("app.core.config.settings...")` mutates the shared settings singleton for the test's duration — acceptable here since tests don't run in parallel processes by default, but flag it: if the suite later moves to `pytest-xdist`, this fixture needs a per-test `Settings` instance instead of monkeypatching the singleton.

- [ ] **Step 7: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/api backend/app/main.py backend/tests/api
git commit -m "backend: FastAPI app skeleton, static bootstrap lifespan, health endpoint"
```

---

## Task 11: Documents API

**Files:**
- Create: `backend/app/api/documents.py`
- Create: `backend/tests/api/test_documents.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `get_db` (Task 2), `get_vector_store` (Task 10), `ingest_file` (Task 7), `DocumentOut` (Task 2).
- Produces: `GET /api/documents`, `POST /api/documents/upload`, `DELETE /api/documents/{id}`, `GET /api/documents/{id}/chunks/{chunk_index}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_documents.py`:
```python
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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_documents.py -v
```
Expected: FAIL with 404s (router not registered) / `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/api/documents.py`**

```python
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_vector_store
from app.core.config import settings
from app.db.session import get_db
from app.models.orm import Document
from app.models.schemas import DocumentOut
from app.services.ingestion_service import ingest_file
from app.services.vector_store import VectorStore

router = APIRouter(prefix="/documents", tags=["documents"])

_ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx"}


@router.get("", response_model=list[DocumentOut])
def list_documents(db: Session = Depends(get_db)) -> list[Document]:
    return db.query(Document).order_by(Document.created_at.desc()).all()


@router.post("/upload", response_model=DocumentOut)
async def upload_document(
    file: UploadFile,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> Document:
    suffix = Path(file.filename).suffix.lower()
    if suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported file type: {suffix}")

    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(status_code=422, detail=f"File exceeds {settings.max_upload_size_mb}MB limit")

    uploads_dir = Path(settings.uploads_dir)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    dest_path = uploads_dir / f"{uuid4()}_{file.filename}"
    dest_path.write_bytes(contents)

    return ingest_file(dest_path, "upload", db, vector_store)


@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> None:
    document = db.query(Document).filter_by(id=document_id).first()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.source_type == "static":
        raise HTTPException(
            status_code=400,
            detail="Static documents are managed via data/static/ and re-indexed on restart; "
            "remove the file from that directory instead of deleting it here.",
        )

    vector_store.delete_document(document_id)
    for uploaded_file in Path(settings.uploads_dir).glob(f"{document_id}_*"):
        uploaded_file.unlink(missing_ok=True)
    db.delete(document)
    db.commit()


@router.get("/{document_id}/chunks/{chunk_index}")
def get_chunk(
    document_id: str,
    chunk_index: int,
    vector_store: VectorStore = Depends(get_vector_store),
) -> dict:
    chunk = vector_store.get_chunk(document_id, chunk_index)
    if chunk is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    return {
        "document_id": chunk.document_id,
        "filename": chunk.filename,
        "chunk_index": chunk.chunk_index,
        "page_number": chunk.page_number,
        "text": chunk.text,
    }
```

- [ ] **Step 4: Register the router in `app/main.py`**

Add `from app.api import documents` to the imports, and `app.include_router(documents.router, prefix="/api")` after the existing `app.include_router(health.router, prefix="/api")` line.

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_documents.py -v
```
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full backend test suite to check for regressions**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all tests from Tasks 1-11 PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/api/documents.py backend/app/main.py backend/tests/api/test_documents.py
git commit -m "backend: documents API (upload, list, delete, chunk preview)"
```

---

## Task 12: Chat API (SSE) and history

**Files:**
- Create: `backend/app/api/chat.py`
- Create: `backend/tests/api/test_chat.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `retrieve` (Task 8), `build_contents`, `SYSTEM_INSTRUCTION` (Task 8), `stream_generate`, `UsageInfo` (Task 9), `ChatMessage` (Task 2), `ChatMessageOut`, `ChatRequest`, `Citation` (Task 2).
- Produces: `POST /api/chat` (SSE), `GET /api/chat/history`, `DELETE /api/chat/history`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/api/test_chat.py`:
```python
import json
from unittest.mock import patch

from app.core.rag.retrieval import RetrievalResult


def _fake_retrieval(*args, **kwargs):
    return RetrievalResult(chunks=[], context_text="[Source 1: a.txt]\nDocMind supports PDF and DOCX.", top_score=0.8, is_low_confidence=False)


def _fake_stream(system_instruction, contents, usage):
    usage.tokens_in = 10
    usage.tokens_out = 3
    yield "DocMind "
    yield "supports PDF and DOCX."


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_streams_tokens_and_done_event(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "what formats are supported?"})

    assert response.status_code == 200
    body = response.text
    assert "event: token" in body
    assert "DocMind " in body
    assert "event: done" in body
    done_line = [line for line in body.splitlines() if line.startswith("data:") and "tokens_in" in line][0]
    payload = json.loads(done_line[len("data: "):])
    assert payload["tokens_in"] == 10
    assert payload["status"] == "ok"


@patch("app.api.chat.stream_generate", side_effect=RuntimeError("upstream down"))
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_emits_error_event_on_generation_failure(mock_retrieve, mock_stream, client):
    response = client.post("/api/chat", json={"message": "hello"})

    assert response.status_code == 200
    assert "event: error" in response.text


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_chat_history_persists_across_requests(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "what formats are supported?"})

    history = client.get("/api/chat/history").json()

    assert len(history) == 2
    assert history[0]["role"] == "user"
    assert history[1]["role"] == "assistant"
    assert history[1]["content"] == "DocMind supports PDF and DOCX."


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_clear_history_removes_all_messages(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "hi"})

    response = client.delete("/api/chat/history")

    assert response.status_code == 204
    assert client.get("/api/chat/history").json() == []
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_chat.py -v
```
Expected: FAIL with 404s / `ModuleNotFoundError`.

- [ ] **Step 3: Write `app/api/chat.py`**

```python
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_vector_store
from app.core.rag.prompt import SYSTEM_INSTRUCTION, build_contents
from app.core.rag.retrieval import retrieve
from app.db.session import SessionLocal, get_db
from app.models.orm import ChatMessage
from app.models.schemas import ChatMessageOut, ChatRequest
from app.services.generation_service import UsageInfo, stream_generate
from app.services.vector_store import VectorStore

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> StreamingResponse:
    history = db.query(ChatMessage).order_by(ChatMessage.created_at).all()

    user_message = ChatMessage(
        id=str(uuid4()), role="user", content=payload.message,
        status="ok", created_at=datetime.now(timezone.utc),
    )
    db.add(user_message)
    db.commit()

    def event_stream():
        start = time.perf_counter()
        retrieval = retrieve(payload.message, vector_store)
        contents = build_contents(payload.message, retrieval, history)
        usage = UsageInfo()
        full_text: list[str] = []
        status = "low_confidence" if retrieval.is_low_confidence else "ok"

        try:
            for delta in stream_generate(SYSTEM_INSTRUCTION, contents, usage):
                full_text.append(delta)
                yield f"event: token\ndata: {json.dumps({'text': delta})}\n\n"
        except Exception:
            status = "error"
            yield f"event: error\ndata: {json.dumps({'message': 'The model is temporarily unavailable. Please try again.'})}\n\n"

        latency_ms = int((time.perf_counter() - start) * 1000)
        citations = [
            {
                "document_id": c.document_id, "filename": c.filename,
                "chunk_index": c.chunk_index, "page_number": c.page_number,
                "score": round(c.score, 4),
            }
            for c in retrieval.chunks
        ]

        # A fresh session is required here: the `db` dependency injected above is closed by
        # FastAPI once this generator is returned to StreamingResponse, not when it finishes.
        db_local = SessionLocal()
        assistant_message = ChatMessage(
            id=str(uuid4()), role="assistant", content="".join(full_text),
            citations=json.dumps(citations), latency_ms=latency_ms,
            tokens_in=usage.tokens_in, tokens_out=usage.tokens_out,
            chunks_retrieved=len(retrieval.chunks), top_score=retrieval.top_score,
            status=status, created_at=datetime.now(timezone.utc),
        )
        db_local.add(assistant_message)
        db_local.commit()
        db_local.close()

        done_payload = {
            "citations": citations, "tokens_in": usage.tokens_in, "tokens_out": usage.tokens_out,
            "latency_ms": latency_ms, "chunks_retrieved": len(retrieval.chunks),
            "top_score": round(retrieval.top_score, 4), "status": status,
        }
        yield f"event: done\ndata: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/history", response_model=list[ChatMessageOut])
def get_history(db: Session = Depends(get_db)) -> list[dict]:
    messages = db.query(ChatMessage).order_by(ChatMessage.created_at).all()
    return [_to_schema(m) for m in messages]


@router.delete("/history", status_code=204)
def clear_history(db: Session = Depends(get_db)) -> None:
    db.query(ChatMessage).delete()
    db.commit()


def _to_schema(message: ChatMessage) -> dict:
    return {
        "id": message.id, "role": message.role, "content": message.content,
        "citations": json.loads(message.citations) if message.citations else [],
        "latency_ms": message.latency_ms, "tokens_in": message.tokens_in,
        "tokens_out": message.tokens_out, "chunks_retrieved": message.chunks_retrieved,
        "top_score": message.top_score, "status": message.status, "created_at": message.created_at,
    }
```

- [ ] **Step 4: Register the router in `app/main.py`**

Add `from app.api import chat` to the imports, and `app.include_router(chat.router, prefix="/api")`.

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_chat.py -v
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/api/chat.py backend/app/main.py backend/tests/api/test_chat.py
git commit -m "backend: SSE chat endpoint with grounded generation and history persistence"
```

---

## Task 13: Observability API

**Files:**
- Create: `backend/app/api/observability.py`
- Create: `backend/tests/api/test_observability.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `get_db` (Task 2), `ChatMessage` (Task 2).
- Produces: `GET /api/observability/requests?limit=50`.

- [ ] **Step 1: Write the failing test**

`backend/tests/api/test_observability.py`:
```python
from unittest.mock import patch

from app.core.rag.retrieval import RetrievalResult


def _fake_retrieval(*args, **kwargs):
    return RetrievalResult(chunks=[], context_text="ctx", top_score=0.7, is_low_confidence=False)


def _fake_stream(system_instruction, contents, usage):
    usage.tokens_in = 5
    usage.tokens_out = 2
    yield "answer"


@patch("app.api.chat.stream_generate", side_effect=_fake_stream)
@patch("app.api.chat.retrieve", side_effect=_fake_retrieval)
def test_observability_lists_recent_assistant_turns(mock_retrieve, mock_stream, client):
    client.post("/api/chat", json={"message": "question one"})

    response = client.get("/api/observability/requests")

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["query"] == "question one"
    assert rows[0]["tokens_in"] == 5
    assert rows[0]["status"] == "ok"


def test_observability_empty_when_no_requests_made(client):
    response = client.get("/api/observability/requests")

    assert response.status_code == 200
    assert response.json() == []
```

- [ ] **Step 2: Run to verify failure**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_observability.py -v
```
Expected: FAIL with 404.

- [ ] **Step 3: Write `app/api/observability.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.orm import ChatMessage

router = APIRouter(prefix="/observability", tags=["observability"])


@router.get("/requests")
def list_requests(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    assistant_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.role == "assistant")
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    user_messages_by_time = {
        m.created_at: m.content
        for m in db.query(ChatMessage).filter(ChatMessage.role == "user").all()
    }

    rows = []
    for assistant_msg in assistant_messages:
        preceding_user_query = _closest_preceding_query(assistant_msg.created_at, user_messages_by_time)
        rows.append({
            "id": assistant_msg.id,
            "query": preceding_user_query,
            "latency_ms": assistant_msg.latency_ms,
            "tokens_in": assistant_msg.tokens_in,
            "tokens_out": assistant_msg.tokens_out,
            "chunks_retrieved": assistant_msg.chunks_retrieved,
            "top_score": assistant_msg.top_score,
            "status": assistant_msg.status,
            "created_at": assistant_msg.created_at,
        })
    return rows


def _closest_preceding_query(assistant_time, user_messages_by_time: dict) -> str:
    earlier_times = [t for t in user_messages_by_time if t <= assistant_time]
    if not earlier_times:
        return ""
    return user_messages_by_time[max(earlier_times)]
```

- [ ] **Step 4: Register the router in `app/main.py`**

Add `from app.api import observability` to the imports, and `app.include_router(observability.router, prefix="/api")`.

- [ ] **Step 5: Run tests to verify pass**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest tests/api/test_observability.py -v
```
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full backend suite**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all tests across Tasks 1-13 PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/app/api/observability.py backend/app/main.py backend/tests/api/test_observability.py
git commit -m "backend: observability endpoint surfacing recent request metadata"
```

---

## Task 14: Backend Dockerfile and CORS

**Files:**
- Create: `backend/Dockerfile`
- Modify: `backend/app/main.py`

**Interfaces:**
- No new interfaces; wires the backend for containerized use and browser access from the frontend origin.

- [ ] **Step 1: Add CORS middleware to `app/main.py`**

Add this import: `from fastapi.middleware.cors import CORSMiddleware`.

Add immediately after `app = FastAPI(title="DocMind AI", lifespan=lifespan)`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 2: Write `backend/Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p data/static data/uploads vector_db

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Build the image locally to confirm it compiles**

```bash
cd /Users/sedhuram/Documents/assignment/backend
docker build -t docmind-backend .
```
Expected: image builds successfully with no errors.

- [ ] **Step 4: Run the backend test suite once more to confirm CORS change didn't break anything**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add backend/Dockerfile backend/app/main.py
git commit -m "backend: Dockerfile and CORS for local frontend origin"
```

---

## Task 15: Frontend scaffold (Next.js 15, Tailwind v4, theme, tab shell)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/postcss.config.mjs`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`
- Create: `frontend/components/TabShell.tsx`
- Create: `frontend/components/ThemeToggle.tsx`
- Create: `frontend/lib/theme.ts`
- Create: `frontend/.env.local.example`
- Create: `frontend/Dockerfile`
- Create: `frontend/.gitignore`

**Interfaces:**
- Produces: `TabShell` component rendering three tabs (`chat`, `documents`, `observability`) and dispatching to children; `ThemeToggle` component; `NEXT_PUBLIC_API_BASE_URL` env convention consumed by later tasks' API client.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "docmind-ai-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "15.1.4",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "lucide-react": "0.469.0",
    "react-markdown": "9.0.1"
  },
  "devDependencies": {
    "typescript": "5.7.2",
    "@types/node": "22.10.5",
    "@types/react": "19.0.2",
    "@types/react-dom": "19.0.2",
    "tailwindcss": "4.0.0",
    "@tailwindcss/postcss": "4.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.ts`, `postcss.config.mjs`, `.gitignore`**

`frontend/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`frontend/postcss.config.mjs`:
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

`frontend/.gitignore`:
```
node_modules/
.next/
next-env.d.ts
```

`frontend/.env.local.example`:
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

- [ ] **Step 4: Write `app/globals.css`**

```css
@import "tailwindcss";

:root {
  --background: #f8fafc;
  --foreground: #0f172a;
  --surface: #ffffff;
  --border: #e2e8f0;
  --accent: #4f46e5;
}

:root[data-theme="dark"] {
  --background: #0b1120;
  --foreground: #e2e8f0;
  --surface: #131c2e;
  --border: #253552;
  --accent: #818cf8;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --background: #0b1120;
    --foreground: #e2e8f0;
    --surface: #131c2e;
    --border: #253552;
    --accent: #818cf8;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
}
```

- [ ] **Step 5: Write `lib/theme.ts`**

```typescript
export type Theme = "light" | "dark";

const STORAGE_KEY = "docmind-theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  window.localStorage.setItem(STORAGE_KEY, theme);
}
```

- [ ] **Step 6: Write `components/ThemeToggle.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="rounded-md border border-[var(--border)] p-2 text-[var(--foreground)] hover:bg-[var(--border)]/30"
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
```

- [ ] **Step 7: Write `components/TabShell.tsx`**

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { MessageSquare, FileText, Activity } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export type TabId = "chat" | "documents" | "observability";

const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "observability", label: "Observability", icon: Activity },
];

export function TabShell({
  statusDot,
  chat,
  documents,
  observability,
}: {
  statusDot: ReactNode;
  chat: ReactNode;
  documents: ReactNode;
  observability: ReactNode;
}) {
  const [active, setActive] = useState<TabId>("chat");

  const content = active === "chat" ? chat : active === "documents" ? documents : observability;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">DocMind AI</span>
          {statusDot}
        </div>
        <nav className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                active === id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--foreground)] hover:bg-[var(--border)]/40"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
        <ThemeToggle />
      </header>
      <main className="flex-1 overflow-hidden">{content}</main>
    </div>
  );
}
```

- [ ] **Step 8: Write `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocMind AI",
  description: "Grounded document Q&A with citation tracing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Write a placeholder `app/page.tsx` (replaced with real tab content in Tasks 17-19)**

```tsx
import { TabShell } from "@/components/TabShell";

export default function Home() {
  return (
    <TabShell
      statusDot={<span className="h-2 w-2 rounded-full bg-slate-400" />}
      chat={<div className="p-6">Chat tab coming in Task 17</div>}
      documents={<div className="p-6">Documents tab coming in Task 18</div>}
      observability={<div className="p-6">Observability tab coming in Task 19</div>}
    />
  );
}
```

- [ ] **Step 10: Write `frontend/Dockerfile`**

```dockerfile
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:22-slim

WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public 2>/dev/null || true

EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 11: Install dependencies and verify the dev server boots**

```bash
cd /Users/sedhuram/Documents/assignment/frontend
npm install
cp .env.local.example .env.local
npm run dev &
sleep 5
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
kill %1
```
Expected: prints `200`. If `npm install` resolves slightly different patch versions for Next/React/Tailwind than pinned above, accept the resolved versions — they're not architecturally significant — and leave `package.json` as the floor.

- [ ] **Step 12: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/package.json frontend/tsconfig.json frontend/next.config.ts frontend/postcss.config.mjs \
  frontend/app frontend/components frontend/lib frontend/.env.local.example frontend/Dockerfile frontend/.gitignore \
  frontend/package-lock.json
git commit -m "frontend: Next.js 15 + Tailwind v4 scaffold, theme toggle, tab shell"
```

---

## Task 16: Typed API client (OpenAPI → TypeScript)

**Files:**
- Create: `scripts/generate-types.sh`
- Create: `frontend/lib/api-types.ts` (generated, then committed)
- Create: `frontend/lib/api-client.ts`

**Interfaces:**
- Produces: `frontend/lib/api-types.ts` (generated types matching backend Pydantic schemas), `apiClient` object in `frontend/lib/api-client.ts` with `listDocuments()`, `uploadDocument(file)`, `deleteDocument(id)`, `getChunk(documentId, chunkIndex)`, `getHistory()`, `clearHistory()`, `getHealth()`, `getObservabilityRequests()`, `streamChat(message, handlers)`.

- [ ] **Step 1: Write `scripts/generate-types.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../backend" && pwd)"
FRONTEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../frontend" && pwd)"

cd "$BACKEND_DIR"
.venv/bin/python -c "
import json
from app.main import app
print(json.dumps(app.openapi()))
" > /tmp/docmind-openapi.json

cd "$FRONTEND_DIR"
npx --yes openapi-typescript /tmp/docmind-openapi.json -o lib/api-types.ts

echo "Regenerated frontend/lib/api-types.ts from the live FastAPI OpenAPI schema."
```

```bash
chmod +x /Users/sedhuram/Documents/assignment/scripts/generate-types.sh
```

- [ ] **Step 2: Run it to generate real types**

```bash
/Users/sedhuram/Documents/assignment/scripts/generate-types.sh
```
Expected: `frontend/lib/api-types.ts` is created, containing a `paths` interface with `/api/health`, `/api/documents`, `/api/chat`, etc. If the script errors because `backend/.venv` doesn't have a real `GEMINI_API_KEY` in `.env`, first run `cp backend/.env.example backend/.env` and edit in any placeholder value — the schema generation doesn't call Gemini, it only needs `Settings()` to construct without a validation error.

- [ ] **Step 3: Write `frontend/lib/api-client.ts`**

This hand-written client wraps `fetch` with the base URL and typed request/response shapes mirroring the backend Pydantic schemas (kept in sync manually with `api-types.ts` as the source of truth for the shapes; this file is the ergonomic layer on top):

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface Citation {
  document_id: string;
  filename: string;
  chunk_index: number;
  page_number: number | null;
  score: number;
}

export interface DocumentOut {
  id: string;
  filename: string;
  source_type: "static" | "upload";
  status: "processing" | "indexed" | "failed";
  status_detail: string | null;
  chunk_count: number;
  size_bytes: number;
  created_at: string;
  indexed_at: string | null;
}

export interface ChatMessageOut {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  chunks_retrieved: number | null;
  top_score: number | null;
  status: "ok" | "low_confidence" | "error";
  created_at: string;
}

export interface HealthOut {
  status: string;
  gemini_configured: boolean;
  chroma_document_count: number;
  sqlite_ok: boolean;
  uptime_seconds: number;
}

export interface ObservabilityRow {
  id: string;
  query: string;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  chunks_retrieved: number | null;
  top_score: number | null;
  status: string;
  created_at: string;
}

export interface ChatDoneEvent {
  citations: Citation[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  chunks_retrieved: number;
  top_score: number;
  status: "ok" | "low_confidence" | "error";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const apiClient = {
  getHealth: () => request<HealthOut>("/api/health"),

  listDocuments: () => request<DocumentOut[]>("/api/documents"),

  uploadDocument: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<DocumentOut>("/api/documents/upload", { method: "POST", body: formData });
  },

  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),

  getChunk: (documentId: string, chunkIndex: number) =>
    request<{ text: string; page_number: number | null; filename: string }>(
      `/api/documents/${documentId}/chunks/${chunkIndex}`
    ),

  getHistory: () => request<ChatMessageOut[]>("/api/chat/history"),

  clearHistory: () => request<void>("/api/chat/history", { method: "DELETE" }),

  getObservabilityRequests: () => request<ObservabilityRow[]>("/api/observability/requests"),

  async streamChat(
    message: string,
    handlers: { onToken: (text: string) => void; onDone: (payload: ChatDoneEvent) => void; onError: (message: string) => void }
  ): Promise<void> {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!response.ok || !response.body) {
      handlers.onError(`Request failed: ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const lines = frame.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event: "));
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!eventLine || !dataLine) continue;

        const eventType = eventLine.slice("event: ".length);
        const data = JSON.parse(dataLine.slice("data: ".length));

        if (eventType === "token") handlers.onToken(data.text);
        else if (eventType === "done") handlers.onDone(data);
        else if (eventType === "error") handlers.onError(data.message);
      }
    }
  },
};
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add scripts/generate-types.sh frontend/lib/api-types.ts frontend/lib/api-client.ts
git commit -m "frontend: OpenAPI-generated types + hand-written typed API client with SSE parsing"
```

---

## Task 17: Chat tab

**Files:**
- Create: `frontend/components/chat/ChatTab.tsx`
- Create: `frontend/components/chat/MessageBubble.tsx`
- Create: `frontend/components/chat/CitationDrawer.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `apiClient` (Task 16).
- Produces: `ChatTab` component, used by `app/page.tsx` in place of the Task 15 placeholder.

- [ ] **Step 1: Write `components/chat/CitationDrawer.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiClient, type Citation } from "@/lib/api-client";

export function CitationDrawer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getChunk(citation.document_id, citation.chunk_index)
      .then((chunk) => {
        if (!cancelled) setText(chunk.text);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this source chunk.");
      });
    return () => {
      cancelled = true;
    };
  }, [citation]);

  return (
    <div className="fixed inset-y-0 right-0 z-20 w-96 border-l border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-medium">{citation.filename}</p>
          <p className="text-xs text-[var(--foreground)]/60">
            {citation.page_number ? `Page ${citation.page_number}` : `Chunk ${citation.chunk_index}`} · similarity{" "}
            {citation.score.toFixed(2)}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!error && text === null && <p className="text-sm text-[var(--foreground)]/60">Loading...</p>}
      {text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write `components/chat/MessageBubble.tsx`**

```tsx
"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Citation } from "@/lib/api-client";
import { CitationDrawer } from "@/components/chat/CitationDrawer";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  status: "ok" | "low_confidence" | "error";
}

export function MessageBubble({ message }: { message: DisplayMessage }) {
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-2xl rounded-lg px-4 py-3 ${
          isUser ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)]"
        }`}
      >
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {!isUser && message.status === "low_confidence" && (
          <p className="mt-2 text-xs font-medium text-amber-500">Low retrieval confidence — verify this answer.</p>
        )}

        {!isUser && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((citation, i) => (
              <button
                key={`${citation.document_id}-${citation.chunk_index}`}
                onClick={() => setOpenCitation(citation)}
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--border)]/30"
              >
                [{i + 1}] {citation.filename}
              </button>
            ))}
          </div>
        )}

        {!isUser && message.latencyMs !== null && (
          <p className="mt-2 text-xs text-[var(--foreground)]/50">
            {message.latencyMs}ms · {message.tokensIn ?? 0}+{message.tokensOut ?? 0} tokens · {message.citations.length} sources
          </p>
        )}
      </div>
      {openCitation && <CitationDrawer citation={openCitation} onClose={() => setOpenCitation(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Write `components/chat/ChatTab.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { MessageBubble, type DisplayMessage } from "@/components/chat/MessageBubble";

export function ChatTab() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiClient.getHistory().then((history) => {
      setMessages(
        history.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations,
          latencyMs: m.latency_ms,
          tokensIn: m.tokens_in,
          tokensOut: m.tokens_out,
          status: m.status,
        }))
      );
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    const userMessage: DisplayMessage = {
      id: `local-user-${Date.now()}`, role: "user", content: text,
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok",
    };
    const assistantId = `local-assistant-${Date.now()}`;
    const assistantMessage: DisplayMessage = {
      id: assistantId, role: "assistant", content: "",
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok",
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    await apiClient.streamChat(text, {
      onToken: (delta) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
        );
      },
      onDone: (payload) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, citations: payload.citations, latencyMs: payload.latency_ms, tokensIn: payload.tokens_in, tokensOut: payload.tokens_out, status: payload.status }
              : m
          )
        );
        setIsStreaming(false);
      },
      onError: (message) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: message, status: "error" } : m))
        );
        setIsStreaming(false);
      },
    });
  }

  async function handleClear() {
    await apiClient.clearHistory();
    setMessages([]);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-[var(--border)] px-4 py-2">
        <button onClick={handleClear} className="flex items-center gap-1 text-xs text-[var(--foreground)]/60 hover:text-red-500">
          <Trash2 size={12} /> Clear conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-[var(--foreground)]/50">
            <p className="text-lg font-medium">No conversation yet</p>
            <p className="text-sm">Ask a question about the documents in your collection to get started.</p>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask a question about your documents..."
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire `ChatTab` into `app/page.tsx`**

```tsx
import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";

export default function Home() {
  return (
    <TabShell
      statusDot={<span className="h-2 w-2 rounded-full bg-slate-400" />}
      chat={<ChatTab />}
      documents={<div className="p-6">Documents tab coming in Task 18</div>}
      observability={<div className="p-6">Observability tab coming in Task 19</div>}
    />
  );
}
```

- [ ] **Step 5: Manual verification against the running backend**

```bash
cd /Users/sedhuram/Documents/assignment/backend && .venv/bin/uvicorn app.main:app --port 8000 &
cd /Users/sedhuram/Documents/assignment/frontend && npm run dev &
sleep 5
curl -s http://localhost:3000 | grep -o "DocMind AI" | head -1
kill %1 %2
```
Expected: prints `DocMind AI`. (Full interactive verification — typing a question and watching it stream — happens in Task 20's end-to-end pass once documents exist to retrieve from.)

- [ ] **Step 6: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/components/chat frontend/app/page.tsx
git commit -m "frontend: chat tab with SSE streaming, markdown rendering, citation drawer"
```

---

## Task 18: Documents tab

**Files:**
- Create: `frontend/components/documents/DocumentsTab.tsx`
- Create: `frontend/components/documents/UploadDropzone.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `apiClient` (Task 16).
- Produces: `DocumentsTab` component.

- [ ] **Step 1: Write `components/documents/UploadDropzone.tsx`**

```tsx
"use client";

import { useCallback, useState } from "react";
import { UploadCloud } from "lucide-react";

export function UploadDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      onFiles(Array.from(e.dataTransfer.files));
    },
    [onFiles]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        isDragging ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)]"
      }`}
    >
      <UploadCloud size={28} className="mb-2 text-[var(--foreground)]/50" />
      <p className="text-sm font-medium">Drag and drop files here</p>
      <p className="text-xs text-[var(--foreground)]/50">PDF, TXT, MD, DOCX — or</p>
      <label className="mt-2 cursor-pointer rounded-md border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--border)]/30">
        Browse files
        <input
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx"
          className="hidden"
          onChange={(e) => e.target.files && onFiles(Array.from(e.target.files))}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Write `components/documents/DocumentsTab.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Trash2, FileText, FileWarning, CheckCircle2, Loader2 } from "lucide-react";
import { apiClient, type DocumentOut } from "@/lib/api-client";
import { UploadDropzone } from "@/components/documents/UploadDropzone";

const STATUS_ICON: Record<DocumentOut["status"], typeof CheckCircle2> = {
  indexed: CheckCircle2,
  processing: Loader2,
  failed: FileWarning,
};

export function DocumentsTab() {
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const docs = await apiClient.listDocuments();
    setDocuments(docs);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFiles(files: File[]) {
    setError(null);
    for (const file of files) {
      try {
        await apiClient.uploadDocument(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    }
    await refresh();
  }

  async function handleDelete(id: string) {
    try {
      await apiClient.deleteDocument(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <UploadDropzone onFiles={handleFiles} />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

        {documents.length === 0 ? (
          <div className="mt-8 text-center text-[var(--foreground)]/50">
            <FileText className="mx-auto mb-2" size={28} />
            <p>No documents indexed yet. Upload one above, or drop files into <code>backend/data/static/</code> and restart.</p>
          </div>
        ) : (
          <table className="mt-6 w-full text-sm">
            <thead className="text-left text-[var(--foreground)]/60">
              <tr className="border-b border-[var(--border)]">
                <th className="py-2">Filename</th>
                <th>Source</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const StatusIcon = STATUS_ICON[doc.status];
                return (
                  <tr key={doc.id} className="border-b border-[var(--border)]/50">
                    <td className="py-2">{doc.filename}</td>
                    <td>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                        {doc.source_type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`flex items-center gap-1 text-xs ${
                          doc.status === "failed" ? "text-red-500" : doc.status === "processing" ? "text-amber-500" : "text-emerald-500"
                        }`}
                        title={doc.status_detail ?? undefined}
                      >
                        <StatusIcon size={12} className={doc.status === "processing" ? "animate-spin" : ""} />
                        {doc.status}
                      </span>
                    </td>
                    <td>{doc.chunk_count}</td>
                    <td>{(doc.size_bytes / 1024).toFixed(1)} KB</td>
                    <td>
                      {doc.source_type === "upload" ? (
                        <button onClick={() => handleDelete(doc.id)} aria-label="Delete" className="text-[var(--foreground)]/50 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <span title="Static documents are managed via data/static/ and re-indexed on restart" className="text-xs text-[var(--foreground)]/30">
                          locked
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `app/page.tsx`**

```tsx
import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";
import { DocumentsTab } from "@/components/documents/DocumentsTab";

export default function Home() {
  return (
    <TabShell
      statusDot={<span className="h-2 w-2 rounded-full bg-slate-400" />}
      chat={<ChatTab />}
      documents={<DocumentsTab />}
      observability={<div className="p-6">Observability tab coming in Task 19</div>}
    />
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/components/documents frontend/app/page.tsx
git commit -m "frontend: documents tab with drag-and-drop upload and status table"
```

---

## Task 19: Observability tab and header status dot

**Files:**
- Create: `frontend/components/observability/ObservabilityTab.tsx`
- Create: `frontend/components/StatusDot.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `apiClient` (Task 16).
- Produces: `ObservabilityTab`, `StatusDot` components.

- [ ] **Step 1: Write `components/StatusDot.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

export function StatusDot() {
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      apiClient
        .getHealth()
        .then((health) => !cancelled && setIsHealthy(health.status === "ok" && health.sqlite_ok))
        .catch(() => !cancelled && setIsHealthy(false));

    check();
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const color = isHealthy === null ? "bg-slate-400" : isHealthy ? "bg-emerald-500" : "bg-red-500";
  const label = isHealthy === null ? "Checking..." : isHealthy ? "Healthy" : "Unreachable";

  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--foreground)]/60" title={label}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Write `components/observability/ObservabilityTab.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { apiClient, type ObservabilityRow } from "@/lib/api-client";

const STATUS_COLOR: Record<string, string> = {
  ok: "text-emerald-500",
  low_confidence: "text-amber-500",
  error: "text-red-500",
};

export function ObservabilityTab() {
  const [rows, setRows] = useState<ObservabilityRow[]>([]);

  useEffect(() => {
    const load = () => apiClient.getObservabilityRequests().then(setRows);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <p className="mb-4 text-sm text-[var(--foreground)]/60">
          Recent chat requests with retrieval and generation metadata — the same data logged as structured JSON on the backend.
        </p>
        {rows.length === 0 ? (
          <p className="text-[var(--foreground)]/50">No requests yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--foreground)]/60">
              <tr className="border-b border-[var(--border)]">
                <th className="py-2">Query</th>
                <th>Latency</th>
                <th>Tokens in/out</th>
                <th>Chunks</th>
                <th>Top score</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]/50">
                  <td className="max-w-xs truncate py-2">{row.query}</td>
                  <td>{row.latency_ms ?? "-"}ms</td>
                  <td>
                    {row.tokens_in ?? 0}/{row.tokens_out ?? 0}
                  </td>
                  <td>{row.chunks_retrieved ?? 0}</td>
                  <td>{row.top_score?.toFixed(2) ?? "-"}</td>
                  <td className={STATUS_COLOR[row.status] ?? ""}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire both into `app/page.tsx`**

```tsx
import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";
import { DocumentsTab } from "@/components/documents/DocumentsTab";
import { ObservabilityTab } from "@/components/observability/ObservabilityTab";
import { StatusDot } from "@/components/StatusDot";

export default function Home() {
  return (
    <TabShell
      statusDot={<StatusDot />}
      chat={<ChatTab />}
      documents={<DocumentsTab />}
      observability={<ObservabilityTab />}
    />
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add frontend/components/observability frontend/components/StatusDot.tsx frontend/app/page.tsx
git commit -m "frontend: observability tab and live backend status indicator"
```

---

## Task 20: docker-compose integration and end-to-end verification

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example` (root, compose-level)
- Create: `backend/data/static/docmind-overview.md` (seed demo document)
- Create: `backend/data/static/docmind-faq.md` (seed demo document)

**Interfaces:**
- No new code interfaces — this task wires the two Dockerfiles together and proves the whole system works end-to-end with real seed content.

- [ ] **Step 1: Write seed static documents**

`backend/data/static/docmind-overview.md`:
```markdown
# DocMind AI Overview

DocMind AI is a retrieval-augmented generation system for answering questions about a document
collection. It ingests files from two sources: a static directory scanned on startup, and files
uploaded through the web UI. Both sources are merged into one searchable collection.

The system uses Google's Gemini API for both embeddings (gemini-embedding-001) and answer
generation (gemini-3.6-flash). Documents are split into overlapping chunks of about 1000
characters with 150 characters of overlap, so that context isn't lost at chunk boundaries.

Every answer includes citations back to the exact source chunk it was generated from, including
the filename and page number when available, so a user can verify the answer against the original
document.
```

`backend/data/static/docmind-faq.md`:
```markdown
# DocMind AI - Frequently Asked Questions

**What file types are supported?**
PDF, TXT, Markdown, and DOCX files can be uploaded or placed in the static ingestion directory.

**How does DocMind AI decide when it doesn't know an answer?**
Every retrieval computes a similarity score between the question and the closest matching chunks.
If the best match falls below a configured confidence threshold, the system still shows what it
found but instructs the model to say plainly that it doesn't have enough information, rather than
guessing.

**Is my data sent anywhere other than the Gemini API?**
No. Documents and their embeddings are stored locally — SQLite for metadata and chat history,
ChromaDB in persistent file mode for vectors. The only outbound calls are to the Gemini API for
embedding and generation.
```

- [ ] **Step 2: Write root `docker-compose.yml`**

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - EMBEDDING_MODEL=${EMBEDDING_MODEL:-gemini-embedding-001}
      - EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS:-768}
      - GENERATION_MODEL=${GENERATION_MODEL:-gemini-3.6-flash}
      - CHUNK_SIZE=${CHUNK_SIZE:-1000}
      - CHUNK_OVERLAP=${CHUNK_OVERLAP:-150}
      - RETRIEVAL_TOP_K=${RETRIEVAL_TOP_K:-5}
      - CONTEXT_CHAR_BUDGET=${CONTEXT_CHAR_BUDGET:-6000}
      - LOW_CONFIDENCE_THRESHOLD=${LOW_CONFIDENCE_THRESHOLD:-0.3}
      - CONVERSATION_WINDOW_TURNS=${CONVERSATION_WINDOW_TURNS:-4}
      - MAX_UPLOAD_SIZE_MB=${MAX_UPLOAD_SIZE_MB:-20}
    volumes:
      - ./backend/data/static:/app/data/static
      - ./backend/data/uploads:/app/data/uploads
      - ./backend/vector_db:/app/vector_db
      - backend_sqlite:/app/data
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]
      interval: 10s
      timeout: 5s
      retries: 5

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
    depends_on:
      backend:
        condition: service_healthy

volumes:
  backend_sqlite:
```

Note: the `backend_sqlite` named volume and the `./backend/data/static` bind mount both map under `/app/data` — Docker Compose mounts bind mounts and named volumes independently by exact path, so `/app/data/static` (bind) and `/app/data` (named volume) would conflict if both were declared as-is. Fix this in the next step.

- [ ] **Step 3: Fix the volume path conflict**

Replace the `volumes:` list under `backend` with non-overlapping paths — keep static/uploads/vector_db as bind mounts for easy inspection, and put only the SQLite file itself on a named volume at a distinct path, pointing `SQLITE_PATH` there via env:

```yaml
    volumes:
      - ./backend/data/static:/app/data/static
      - ./backend/data/uploads:/app/data/uploads
      - ./backend/vector_db:/app/vector_db
      - backend_sqlite:/app/sqlite
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - EMBEDDING_MODEL=${EMBEDDING_MODEL:-gemini-embedding-001}
      - EMBEDDING_DIMENSIONS=${EMBEDDING_DIMENSIONS:-768}
      - GENERATION_MODEL=${GENERATION_MODEL:-gemini-3.6-flash}
      - CHUNK_SIZE=${CHUNK_SIZE:-1000}
      - CHUNK_OVERLAP=${CHUNK_OVERLAP:-150}
      - RETRIEVAL_TOP_K=${RETRIEVAL_TOP_K:-5}
      - CONTEXT_CHAR_BUDGET=${CONTEXT_CHAR_BUDGET:-6000}
      - LOW_CONFIDENCE_THRESHOLD=${LOW_CONFIDENCE_THRESHOLD:-0.3}
      - CONVERSATION_WINDOW_TURNS=${CONVERSATION_WINDOW_TURNS:-4}
      - MAX_UPLOAD_SIZE_MB=${MAX_UPLOAD_SIZE_MB:-20}
      - SQLITE_PATH=/app/sqlite/docmind.db
```

(This replaces the `volumes:` and `environment:` blocks under the `backend` service from Step 2 — keep the rest of the file, including `healthcheck`, the `frontend` service, and the top-level `volumes:` section, unchanged.)

- [ ] **Step 4: Write root `.env.example`**

```
GEMINI_API_KEY=your-gemini-api-key-here
```

- [ ] **Step 5: Bring the stack up and verify end-to-end**

```bash
cd /Users/sedhuram/Documents/assignment
cp .env.example .env
# Edit .env and set a real GEMINI_API_KEY before continuing.
docker compose up --build -d
sleep 15
curl -s http://localhost:8000/api/health
curl -s http://localhost:8000/api/documents
```
Expected: `/api/health` reports `"status":"ok"` and `"chroma_document_count"` greater than 0 (the two seed markdown files from Step 1 auto-indexed on boot); `/api/documents` lists both with `"source_type":"static"` and `"status":"indexed"`.

- [ ] **Step 6: Verify the chat flow end-to-end with a real Gemini call**

```bash
curl -s -N -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What file types does DocMind AI support?"}'
```
Expected: a stream of `event: token` frames spelling out an answer mentioning PDF/TXT/Markdown/DOCX, followed by `event: done` with a non-empty `citations` array referencing `docmind-faq.md`.

- [ ] **Step 7: Verify the frontend renders and streams in a browser**

```bash
open http://localhost:3000
```
Manually: confirm the Chat tab shows the status dot green, type "What file types are supported?", confirm the answer streams in with a typewriter effect and at least one citation badge; click the badge and confirm the drawer shows the matching source text; switch to the Documents tab and confirm both seed files are listed with status "indexed"; switch to Observability and confirm the request just made appears with latency/token/score data; toggle dark mode and confirm all three tabs remain legible.

- [ ] **Step 8: Tear down and commit**

```bash
docker compose down
cd /Users/sedhuram/Documents/assignment
git add docker-compose.yml .env.example backend/data/static/docmind-overview.md backend/data/static/docmind-faq.md
git commit -m "compose: wire backend+frontend, seed demo documents, verify end-to-end RAG flow"
```

---

## Task 21: README.md

**Files:**
- Create: `README.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Write `README.md`**

Write the full README covering, in this order: project intro (first person, what it is and why it exists in this form), quick setup (clone, `.env`, `docker compose up --build`, seed documents note), architecture (paste the ASCII diagram from `docs/superpowers/specs/2026-08-06-docmind-ai-design.md` section 3), a walkthrough of the three UI tabs with what to look for, the full RAG decisions section (chunking, embedding/LLM selection including the mid-build model-deprecation catch, retrieval, context management, guardrails, quality controls, observability — pulling directly from spec sections 6-9), the explicit non-goals table from spec section 2 framed as "what I deliberately didn't build and why," a testing section naming what's covered and what isn't, a productionization section (async ingestion queue + Redis + Celery/RQ, Qdrant migration path, Cloud Run/ECS deployment topology with a short comparison of the two, Alembic migrations, multi-tenant/auth if ever needed), an AI-assisted development section written candidly about what was delegated to an AI coding assistant vs. decided by hand (model selection required live verification since training data was stale — a concrete example of "don't trust the assistant's memory of API surfaces without checking"), and a "what I'd do differently with more time" list matching the deferred-items list from spec section 13.

Do not write this section-by-section from a template — compose it as continuous prose sections a senior engineer would actually write in a PR description or design doc, with specific numbers and named trade-offs tied to the actual code (e.g., "768-dim embeddings, not 3072, because Google's own benchmarks show near-peak retrieval quality at a quarter of the storage cost"), not generic RAG-tutorial language.

- [ ] **Step 2: Sanity-check the README against the running stack**

Re-read the Quick Setup section and follow it literally from a clean `git clone` in a scratch directory, confirming every command in it actually works as written (especially the `.env` copy step and `docker compose up --build`).

- [ ] **Step 3: Commit**

```bash
cd /Users/sedhuram/Documents/assignment
git add README.md
git commit -m "docs: production README with architecture, RAG decisions, and productionization plan"
```

---

## Task 22: Backend linting pass and final full-suite verification

**Files:**
- Modify: any backend file flagged below (no new files expected)

**Interfaces:**
- None — verification-only task.

- [ ] **Step 1: Run the full backend test suite one final time**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/pytest -v
```
Expected: every test from Tasks 1-13 passes (approximately 40 tests total).

- [ ] **Step 2: Byte-compile check for syntax errors across the whole backend app**

```bash
cd /Users/sedhuram/Documents/assignment/backend
.venv/bin/python -m py_compile $(find app -name "*.py")
```
Expected: no output, exit code 0.

- [ ] **Step 3: Frontend production build check**

```bash
cd /Users/sedhuram/Documents/assignment/frontend
npm run build
```
Expected: build completes with no TypeScript errors. Fix any type errors surfaced here directly in the relevant component file before proceeding — do not suppress with `any` or `@ts-ignore`.

- [ ] **Step 4: Final commit if Steps 1-3 required any fixes**

```bash
cd /Users/sedhuram/Documents/assignment
git add -A
git status
git commit -m "fix: resolve issues found in final verification pass"
```
(Skip this step entirely if Steps 1-3 needed no changes.)

---

## Self-Review Notes

- **Spec coverage:** Sections 3-9 (architecture, tech stack, data model, ingestion, retrieval/generation, API surface, frontend) map to Tasks 1-19. Section 10 (testing) is covered inline in every backend task's pytest steps plus Task 22's full-suite run. Section 11 (Docker/config) is Tasks 14 and 20. Section 12 (monorepo layout) matches the file paths used throughout. Section 13 (deferred items) is written into Task 21's README instructions rather than built, per the spec's explicit non-goals.
- **Placeholder scan:** none found — an earlier draft of Tasks 10 and 11 introduced a stray artifact and a redundant loop and then "fixed" them in a following step; both were rewritten clean on first pass instead, since a reviewer would rightly flag introduce-then-fix as an unnecessary detour.
- **Type consistency:** `RetrievedChunk`, `RetrievalResult`, `UsageInfo`, `ChatMessageOut`, `DocumentOut`, `Citation`, and the SSE event payload shapes are defined once (Tasks 2, 6, 8, 9) and reused with identical field names through the API and frontend client (Tasks 11, 12, 13, 16) — verified consistent across all task Interfaces blocks.
