import os
from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    generation_model: str = "gemini-3.6-flash"
    default_llm_provider: Literal["gemini", "ollama"] = "gemini"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.6:35b"
    chunk_size: int = 1000
    chunk_overlap: int = 150
    retrieval_top_k: int = 5
    context_char_budget: int = 6000
    low_confidence_threshold: float = 0.3
    conversation_window_turns: int = 4
    max_upload_size_mb: int = 3
    max_total_documents: int = 10
    static_dir: str = "data/static"
    uploads_dir: str = "data/uploads"
    vector_db_dir: str = "vector_db"
    sqlite_path: str = "data/docmind.db"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def update_and_persist(updates: dict[str, str | int | float]) -> Settings:
    global settings
    for key, val in updates.items():
        if hasattr(settings, key):
            setattr(settings, key, val)

    env_path = ".env"
    env_dict: dict[str, str] = {}
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_dict[k.strip()] = v.strip()

    for k, v in updates.items():
        env_dict[k.upper()] = str(v)

    with open(env_path, "w", encoding="utf-8") as f:
        for k, v in env_dict.items():
            f.write(f"{k}={v}\n")

    get_settings.cache_clear()
    return settings

