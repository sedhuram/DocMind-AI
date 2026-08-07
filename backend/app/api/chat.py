import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_active_provider, get_vector_store
from app.core.rag.prompt import SYSTEM_INSTRUCTION, build_contents
from app.core.rag.retrieval import retrieve
from app.db.session import SessionLocal, get_db
from app.core.security import detect_prompt_injection, sanitize_pii
from app.models.orm import ChatMessage, ChatSession, AuditLog, FeatureFlag
from app.models.schemas import (
    ChatMessageOut,
    ChatRequest,
    ChatSessionOut,
    ChatSessionCreate,
    ChatSessionUpdate,
    MessageEditRequest,
    MindmapResponse,
)
from app.services import generation_service, ollama_generation_service
from app.services.generation_service import UsageInfo
from app.services.vector_store import VectorStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# Fallback sent in the SSE `error` frame *and* persisted as the failed turn's content when
# the underlying exception has nothing safe or useful to say to a user.
_ERROR_MESSAGE = "The model is temporarily unavailable. Please try again."


@dataclass(frozen=True)
class HistoryTurn:
    role: str
    content: str


# Rate limiting tracking (sliding 60-second window per client)
_RATE_LIMIT_STORE: dict[str, list[float]] = {}


@router.post("")
def chat(
    payload: ChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
    provider: str = Depends(get_active_provider),
) -> StreamingResponse:
    # Character limit check
    if len(payload.message) > 4000:
        def error_len_gen():
            yield f"event: error\ndata: {json.dumps({'message': 'Prompt length exceeds max limit of 4000 characters.'})}\n\n"
        return StreamingResponse(error_len_gen(), media_type="text/event-stream")

    # Prompt Injection Check
    if detect_prompt_injection(payload.message):
        log_entry = AuditLog(
            id=f"log-{uuid4().hex[:8]}",
            user_email="system@security",
            action="SECURITY_ALERT",
            details=f"Blocked prompt injection: {payload.message[:60]}...",
            ip_address=request.client.host if request.client else "127.0.0.1",
        )
        db.add(log_entry)
        db.commit()

        def error_inj_gen():
            yield f"event: error\ndata: {json.dumps({'message': 'Security Guardrail: Prompt injection attempt detected.'})}\n\n"
        return StreamingResponse(error_inj_gen(), media_type="text/event-stream")

    # Rate limiting check if enabled
    rl_flag = db.query(FeatureFlag).filter_by(name="enable_rate_limiting").first()
    client_ip = request.client.host if request.client else "127.0.0.1"
    if rl_flag and rl_flag.enabled and client_ip != "testclient":
        now = time.time()
        timestamps = [t for t in _RATE_LIMIT_STORE.get(client_ip, []) if now - t < 60]
        if len(timestamps) >= 10:
            def error_rl_gen():
                yield f"event: error\ndata: {json.dumps({'message': 'Rate limit exceeded (max 10 requests/min). Please wait a moment.'})}\n\n"
            return StreamingResponse(error_rl_gen(), media_type="text/event-stream")
        timestamps.append(now)
        _RATE_LIMIT_STORE[client_ip] = timestamps

    # PII Scrubbing
    sanitized_message = sanitize_pii(payload.message)

    # Ensure session exists
    session = db.query(ChatSession).filter_by(id=payload.session_id).first()
    if not session:
        session = ChatSession(id=payload.session_id, title="New Chat")
        db.add(session)
        db.commit()

    history = db.query(ChatMessage).filter_by(session_id=payload.session_id).order_by(ChatMessage.created_at).all()
    history_snapshot = [HistoryTurn(role=turn.role, content=turn.content) for turn in history]

    user_message = ChatMessage(
        id=str(uuid4()), session_id=payload.session_id, role="user", content=sanitized_message,
        status="ok", created_at=datetime.now(timezone.utc),
    )
    db.add(user_message)

    # Audit query event
    log_entry = AuditLog(
        id=f"log-{uuid4().hex[:8]}",
        user_email="user@docmind.ai",
        action="CHAT_QUERY",
        details=f"Prompt query submitted ({len(sanitized_message)} chars)",
        ip_address="127.0.0.1",
    )
    db.add(log_entry)
    db.commit()

    def event_stream():
        start = time.perf_counter()
        usage = UsageInfo()
        full_text: list[str] = []
        retrieval = None
        status = "error"

        generate_fn = ollama_generation_service.stream_generate if provider == "ollama" else generation_service.stream_generate

        try:
            retrieval = retrieve(payload.message, vector_store, document_ids=payload.document_ids)
            contents = build_contents(payload.message, retrieval, history_snapshot)
            status = "low_confidence" if retrieval.is_low_confidence else "ok"

            for delta in generate_fn(SYSTEM_INSTRUCTION, contents, usage):
                full_text.append(delta)
                yield f"event: token\ndata: {json.dumps({'text': delta})}\n\n"
        except Exception as exc:
            logger.exception("Chat generation failed")
            status = "error"
            error_message = str(exc) if isinstance(exc, ConnectionError) and str(exc) else _ERROR_MESSAGE
            full_text = [error_message]
            yield f"event: error\ndata: {json.dumps({'message': error_message})}\n\n"

        latency_ms = int((time.perf_counter() - start) * 1000)
        citations = [
            {
                "document_id": c.document_id, "filename": c.filename,
                "chunk_index": c.chunk_index, "page_number": c.page_number,
                "score": round(c.score, 4),
                "source_name": c.source_name,
                "chunk_id": c.chunk_id,
                "upload_timestamp": c.upload_timestamp,
            }
            for c in retrieval.chunks
        ] if retrieval is not None else []

        chunks_retrieved = len(retrieval.chunks) if retrieval is not None else 0
        top_score = retrieval.top_score if retrieval is not None else 0.0

        db_local = SessionLocal()
        assistant_message = ChatMessage(
            id=str(uuid4()), session_id=payload.session_id, role="assistant", content="".join(full_text),
            citations=json.dumps(citations), latency_ms=latency_ms,
            tokens_in=usage.tokens_in, tokens_out=usage.tokens_out,
            chunks_retrieved=chunks_retrieved, top_score=top_score,
            status=status, provider=provider, created_at=datetime.now(timezone.utc),
        )
        db_local.add(assistant_message)
        db_local.commit()
        db_local.close()

        done_payload = {
            "citations": citations, "tokens_in": usage.tokens_in, "tokens_out": usage.tokens_out,
            "latency_ms": latency_ms, "chunks_retrieved": chunks_retrieved,
            "top_score": round(top_score, 4), "status": status, "provider": provider,
        }
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
def get_history(session_id: str = "default", db: Session = Depends(get_db)) -> list[dict]:
    messages = db.query(ChatMessage).filter_by(session_id=session_id).order_by(ChatMessage.created_at).all()
    return [_to_schema(m) for m in messages]


@router.delete("/history", status_code=204)
def clear_history(session_id: str = "default", db: Session = Depends(get_db)) -> None:
    db.query(ChatMessage).filter_by(session_id=session_id).delete()
    db.commit()


@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(db: Session = Depends(get_db)) -> list[ChatSession]:
    default_session = db.query(ChatSession).filter_by(id="default").first()
    if not default_session:
        default_session = ChatSession(id="default", title="Default Chat")
        db.add(default_session)
        db.commit()
    return db.query(ChatSession).order_by(ChatSession.created_at.desc()).all()


@router.post("/sessions", response_model=ChatSessionOut)
def create_session(payload: ChatSessionCreate, db: Session = Depends(get_db)) -> ChatSession:
    session_id = str(uuid4())
    title = payload.title or "New Chat"
    session = ChatSession(id=session_id, title=title)
    db.add(session)
    db.commit()
    return session


@router.patch("/sessions/{session_id}", response_model=ChatSessionOut)
def update_session(session_id: str, payload: ChatSessionUpdate, db: Session = Depends(get_db)) -> ChatSession:
    session = db.query(ChatSession).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.title = payload.title
    db.commit()
    return session


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_db)) -> None:
    session = db.query(ChatSession).filter_by(id=session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.query(ChatMessage).filter_by(session_id=session_id).delete()
    db.delete(session)
    db.commit()
@router.put("/messages/{message_id}", response_model=ChatMessageOut)
def edit_message(message_id: str, payload: MessageEditRequest, db: Session = Depends(get_db)) -> dict:
    message = db.query(ChatMessage).filter_by(id=message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Delete all messages in the same session created after this message
    db.query(ChatMessage).filter(
        ChatMessage.session_id == message.session_id,
        ChatMessage.created_at > message.created_at
    ).delete()

    message.content = payload.content
    db.commit()

    return _to_schema(message)


@router.post("/mindmap", response_model=MindmapResponse)
def generate_mindmap(
    payload: MessageEditRequest,
    db: Session = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
    provider: str = Depends(get_active_provider),
) -> dict:
    topic = payload.content
    retrieval = retrieve(topic, vector_store)
    context = retrieval.context_text or "(no relevant sources found in the document collection)"

    system_instruction = (
        "You are an expert AI data architect. Your goal is to analyze the provided sources and build an "
        "interactive mindmap of the topic: '" + topic + "'.\n"
        "You MUST output ONLY a valid JSON object matching the following structure:\n"
        "{\n"
        "  \"title\": \"Central theme\",\n"
        "  \"children\": [\n"
        "    { \"title\": \"Subtopic title\", \"description\": \"One-sentence summary\", \"children\": [] }\n"
        "  ]\n"
        "}\n"
        "Provide 4 to 6 main children branches based strictly on the text. Keep description text concise. "
        "Do not return any markdown code blocks, wrap with backticks, or write explanations outside the JSON."
    )

    contents = [{"role": "user", "content": f"Sources:\n{context}\n\nBuild a JSON mindmap for the topic: {topic}"}]
    usage = UsageInfo()

    generate_fn = ollama_generation_service.stream_generate if provider == "ollama" else generation_service.stream_generate

    try:
        full_text = []
        for delta in generate_fn(system_instruction, contents, usage):
            full_text.append(delta)

        raw_response = "".join(full_text).strip()
        if raw_response.startswith("```json"):
            raw_response = raw_response[7:]
        if raw_response.startswith("```"):
            raw_response = raw_response[3:]
        if raw_response.endswith("```"):
            raw_response = raw_response[:-3]
        raw_response = raw_response.strip()

        parsed_json = json.loads(raw_response)
        return parsed_json
    except Exception as exc:
        logger.exception("Mindmap generation failed")
        return {
            "title": topic,
            "children": [
                {
                    "title": "Error generating mindmap",
                    "description": "Could not connect to model or parse JSON response.",
                    "children": []
                }
            ]
        }


def _to_schema(message: ChatMessage) -> dict:
    return {
        "id": message.id, "session_id": message.session_id, "role": message.role, "content": message.content,
        "citations": json.loads(message.citations) if message.citations else [],
        "latency_ms": message.latency_ms, "tokens_in": message.tokens_in,
        "tokens_out": message.tokens_out, "chunks_retrieved": message.chunks_retrieved,
        "top_score": message.top_score, "status": message.status, "provider": message.provider,
        "created_at": message.created_at,
    }
