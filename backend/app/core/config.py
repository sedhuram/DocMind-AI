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
