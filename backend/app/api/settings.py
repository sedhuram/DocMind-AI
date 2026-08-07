import time
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings, update_and_persist

router = APIRouter(prefix="/settings", tags=["settings"])

Provider = Literal["gemini", "ollama"]


class ProviderInfo(BaseModel):
    id: str
    label: str
    reachable: bool | None


class SettingsOut(BaseModel):
    active_llm_provider: str
    available_providers: list[ProviderInfo]


class SettingsUpdate(BaseModel):
    llm_provider: Provider


class FullConfigOut(BaseModel):
    active_llm_provider: str
    gemini_api_key_masked: str
    generation_model: str
    ollama_base_url: str
    ollama_model: str
    retrieval_top_k: int
    chunk_size: int
    chunk_overlap: int
    low_confidence_threshold: float
    available_providers: list[ProviderInfo]


class FullConfigUpdate(BaseModel):
    llm_provider: Provider | None = None
    gemini_api_key: str | None = None
    generation_model: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str | None = None
    retrieval_top_k: int | None = None
    chunk_size: int | None = None
    chunk_overlap: int | None = None
    low_confidence_threshold: float | None = None


class ProviderHealthOut(BaseModel):
    provider: str
    healthy: bool
    latency_ms: int
    message: str


def _ollama_reachable() -> bool:
    try:
        response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
        return response.status_code == 200
    except Exception:
        return False


def _gemini_info() -> ProviderInfo:
    return ProviderInfo(id="gemini", label="Gemini", reachable=bool(settings.gemini_api_key))


def _ollama_info(reachable: bool | None) -> ProviderInfo:
    return ProviderInfo(id="ollama", label=f"Ollama ({settings.ollama_model})", reachable=reachable)


def _build_settings_out(active_provider: str, ollama_reachable: bool | None = None) -> SettingsOut:
    if ollama_reachable is None:
        ollama_reachable = _ollama_reachable()
    return SettingsOut(
        active_llm_provider=active_provider,
        available_providers=[_gemini_info(), _ollama_info(ollama_reachable)],
    )


@router.get("", response_model=SettingsOut)
def get_settings(request: Request) -> SettingsOut:
    return _build_settings_out(request.app.state.active_llm_provider)


@router.patch("", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, request: Request) -> SettingsOut:
    gemini = _gemini_info()
    ollama = _ollama_info(_ollama_reachable() if payload.llm_provider == "ollama" else None)

    target = gemini if payload.llm_provider == "gemini" else ollama
    if not target.reachable:
        raise HTTPException(
            status_code=400,
            detail=f"{target.label} could not be reached. Is it running and configured correctly?",
        )

    request.app.state.active_llm_provider = payload.llm_provider
    return SettingsOut(active_llm_provider=payload.llm_provider, available_providers=[gemini, ollama])


@router.get("/health", response_model=ProviderHealthOut)
def check_health(request: Request) -> ProviderHealthOut:
    start = time.time()
    provider = getattr(request.app.state, "active_llm_provider", settings.default_llm_provider)

    if provider == "gemini":
        healthy = bool(settings.gemini_api_key)
        msg = "Gemini API key configured" if healthy else "Gemini API key missing"
    else:
        healthy = _ollama_reachable()
        msg = f"Ollama reachable at {settings.ollama_base_url}" if healthy else f"Cannot reach Ollama at {settings.ollama_base_url}"

    latency = int((time.time() - start) * 1000)
    return ProviderHealthOut(provider=provider, healthy=healthy, latency_ms=latency, message=msg)


@router.get("/config", response_model=FullConfigOut)
def get_full_config(request: Request) -> FullConfigOut:
    key = settings.gemini_api_key
    masked = (key[:4] + "..." + key[-4:]) if len(key) >= 8 else ("***" if key else "")
    return FullConfigOut(
        active_llm_provider=getattr(request.app.state, "active_llm_provider", "gemini"),
        gemini_api_key_masked=masked,
        generation_model=settings.generation_model,
        ollama_base_url=settings.ollama_base_url,
        ollama_model=settings.ollama_model,
        retrieval_top_k=settings.retrieval_top_k,
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        low_confidence_threshold=settings.low_confidence_threshold,
        available_providers=[_gemini_info(), _ollama_info(_ollama_reachable())],
    )


@router.patch("/config", response_model=FullConfigOut)
def update_full_config(payload: FullConfigUpdate, request: Request) -> FullConfigOut:
    updates: dict[str, str | int | float] = {}
    if payload.llm_provider is not None:
        request.app.state.active_llm_provider = payload.llm_provider
        updates["default_llm_provider"] = payload.llm_provider
    if payload.gemini_api_key is not None and payload.gemini_api_key.strip():
        updates["gemini_api_key"] = payload.gemini_api_key.strip()
    if payload.generation_model is not None:
        updates["generation_model"] = payload.generation_model
    if payload.ollama_base_url is not None:
        updates["ollama_base_url"] = payload.ollama_base_url
    if payload.ollama_model is not None:
        updates["ollama_model"] = payload.ollama_model
    if payload.retrieval_top_k is not None:
        updates["retrieval_top_k"] = payload.retrieval_top_k
    if payload.chunk_size is not None:
        updates["chunk_size"] = payload.chunk_size
    if payload.chunk_overlap is not None:
        updates["chunk_overlap"] = payload.chunk_overlap
    if payload.low_confidence_threshold is not None:
        updates["low_confidence_threshold"] = payload.low_confidence_threshold

    if updates:
        update_and_persist(updates)

    return get_full_config(request)
