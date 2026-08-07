import json
import logging
import time
from dataclasses import dataclass
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Sent in the SSE `error` frame *and* persisted as the failed turn's content. Persisting a
# non-empty placeholder matters for two reasons: an empty-text turn replayed into Gemini's
# `contents` on the next request is rejected with a 400 (so one transient failure would
# cascade into every later turn), and a reloaded conversation would otherwise render the
# failed turn as an unexplained blank bubble.
_ERROR_MESSAGE = "The model is temporarily unavailable. Please try again."


@dataclass(frozen=True)
class HistoryTurn:
    """Session-independent snapshot of a ChatMessage's role/content.

    `build_contents` (Task 8, frozen) only reads `.role`/`.content` off each
    history item. We copy those two fields out of the ORM objects before
    `db.commit()` runs, because that commit expires every object already
    loaded in the session's identity map (SQLAlchemy default
    `expire_on_commit=True`). Without this snapshot, `event_stream()` -
    which runs after the request's `db` session has been closed by FastAPI -
    would trigger a `DetachedInstanceError` trying to lazily refresh the
    expired attributes on the second and every subsequent message of a
    conversation.
    """

    role: str
    content: str


@router.post("")
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> StreamingResponse:
    history = db.query(ChatMessage).order_by(ChatMessage.created_at).all()
    # Snapshot before `db.commit()` below: that commit expires every ORM
    # object already loaded in this session's identity map (including every
    # item in `history`), and `event_stream()` runs after FastAPI has closed
    # this `db` session, so any lazy-refresh of expired attributes would
    # raise `DetachedInstanceError`. `HistoryTurn` copies out only what
    # `build_contents` reads (`.role`, `.content`) while the objects are
    # still live.
    history_snapshot = [HistoryTurn(role=turn.role, content=turn.content) for turn in history]

    user_message = ChatMessage(
        id=str(uuid4()), role="user", content=payload.message,
        status="ok", created_at=datetime.now(timezone.utc),
    )
    db.add(user_message)
    db.commit()

    def event_stream():
        start = time.perf_counter()
        usage = UsageInfo()
        full_text: list[str] = []
        retrieval = None
        status = "error"

        try:
            retrieval = retrieve(payload.message, vector_store)
            contents = build_contents(payload.message, retrieval, history_snapshot)
            status = "low_confidence" if retrieval.is_low_confidence else "ok"

            for delta in stream_generate(SYSTEM_INSTRUCTION, contents, usage):
                full_text.append(delta)
                yield f"event: token\ndata: {json.dumps({'text': delta})}\n\n"
        except Exception:
            logger.exception("Chat generation failed")
            status = "error"
            # Replace (not append to) whatever partially streamed: a truncated grounded
            # answer replayed as conversation history is worse than an explicit failure
            # marker, and this guarantees the persisted content is never empty.
            full_text = [_ERROR_MESSAGE]
            yield f"event: error\ndata: {json.dumps({'message': _ERROR_MESSAGE})}\n\n"

        latency_ms = int((time.perf_counter() - start) * 1000)
        citations = [
            {
                "document_id": c.document_id, "filename": c.filename,
                "chunk_index": c.chunk_index, "page_number": c.page_number,
                "score": round(c.score, 4),
            }
            for c in retrieval.chunks
        ] if retrieval is not None else []

        chunks_retrieved = len(retrieval.chunks) if retrieval is not None else 0
        top_score = retrieval.top_score if retrieval is not None else 0.0

        # A fresh session is required here: the `db` dependency injected above is closed by
        # FastAPI once this generator is returned to StreamingResponse, not when it finishes.
        db_local = SessionLocal()
        assistant_message = ChatMessage(
            id=str(uuid4()), role="assistant", content="".join(full_text),
            citations=json.dumps(citations), latency_ms=latency_ms,
            tokens_in=usage.tokens_in, tokens_out=usage.tokens_out,
            chunks_retrieved=chunks_retrieved, top_score=top_score,
            status=status, created_at=datetime.now(timezone.utc),
        )
        db_local.add(assistant_message)
        db_local.commit()
        db_local.close()

        done_payload = {
            "citations": citations, "tokens_in": usage.tokens_in, "tokens_out": usage.tokens_out,
            "latency_ms": latency_ms, "chunks_retrieved": chunks_retrieved,
            "top_score": round(top_score, 4), "status": status,
        }
        # One structured record per completed turn, emitted through the app's JsonFormatter
        # (see app/core/logging.py) so the happy path - not just exception handlers -
        # produces machine-readable operational data.
        logger.info(
            "chat_turn_completed",
            extra={
                "latency_ms": latency_ms,
                "tokens_in": usage.tokens_in,
                "tokens_out": usage.tokens_out,
                "chunks_retrieved": chunks_retrieved,
                "top_score": round(top_score, 4),
                "status": status,
            },
        )
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
