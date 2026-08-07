from fastapi import Request

from app.services.vector_store import VectorStore


def get_vector_store(request: Request) -> VectorStore:
    return request.app.state.vector_store


def get_active_provider(request: Request) -> str:
    return request.app.state.active_llm_provider
