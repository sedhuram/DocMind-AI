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
