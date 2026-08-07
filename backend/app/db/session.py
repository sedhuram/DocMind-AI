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
    db = SessionLocal()
    try:
        from app.models.orm import FeatureFlag, User
        if db.query(FeatureFlag).count() == 0:
            default_flags = [
                FeatureFlag(name="enable_mindmap", enabled=True, description="AI Mindmap visual topic tree generator"),
                FeatureFlag(name="enable_rate_limiting", enabled=True, description="Sliding window LLM abuse & prompt throttling guardrails"),
                FeatureFlag(name="enable_scratchpad_export", enabled=True, description="Export pinned notes to Markdown (.md) documents"),
                FeatureFlag(name="enable_paste_upload", enabled=True, description="Instant paste-to-file automatic document upload"),
            ]
            db.add_all(default_flags)
            db.commit()

        if db.query(User).filter_by(email="admin@docmind.ai").first() is None:
            admin_user = User(
                id="user-admin-default",
                email="admin@docmind.ai",
                name="System Administrator",
                avatar_url="https://lh3.googleusercontent.com/a/default-user=s96-c",
                role="admin"
            )
            db.add(admin_user)
            db.commit()
    finally:
        db.close()


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()

