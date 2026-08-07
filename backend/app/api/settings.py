import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/settings", tags=["settings"])

_KNOWN_PROVIDERS = {"gemini", "ollama"}


class ProviderInfo(BaseModel):
    id: str
    label: str
    reachable: bool


class SettingsOut(BaseModel):
    active_llm_provider: str
    available_providers: list[ProviderInfo]


class SettingsUpdate(BaseModel):
    llm_provider: str


def _ollama_reachable() -> bool:
    try:
        response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
        return response.status_code == 200
    except Exception:
        return False


def _build_settings_out(active_provider: str) -> SettingsOut:
    return SettingsOut(
        active_llm_provider=active_provider,
        available_providers=[
            ProviderInfo(id="gemini", label="Gemini", reachable=bool(settings.gemini_api_key)),
            ProviderInfo(id="ollama", label=f"Ollama ({settings.ollama_model})", reachable=_ollama_reachable()),
        ],
    )


@router.get("", response_model=SettingsOut)
def get_settings(request: Request) -> SettingsOut:
    return _build_settings_out(request.app.state.active_llm_provider)


@router.patch("", response_model=SettingsOut)
def update_settings(payload: SettingsUpdate, request: Request) -> SettingsOut:
    if payload.llm_provider not in _KNOWN_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"Unknown provider: {payload.llm_provider}")

    candidate = _build_settings_out(request.app.state.active_llm_provider)
    target = next(p for p in candidate.available_providers if p.id == payload.llm_provider)
    if not target.reachable:
        raise HTTPException(
            status_code=400,
            detail=f"{target.label} could not be reached. Is it running and configured correctly?",
        )

    request.app.state.active_llm_provider = payload.llm_provider
    return _build_settings_out(payload.llm_provider)
