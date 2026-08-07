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
        # `with` guarantees the session is returned to the pool even when `execute`
        # raises; the previous manual `db.close()` only ran on the success path, so a
        # failing health check leaked a connection on every poll.
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
