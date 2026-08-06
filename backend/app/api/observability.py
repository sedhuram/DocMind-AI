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
