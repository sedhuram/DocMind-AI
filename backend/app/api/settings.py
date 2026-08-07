from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/settings", tags=["settings"])

Provider = Literal["gemini", "ollama"]


class ProviderInfo(BaseModel):
    id: str
    label: str
    # `None` means "not checked on this request", which is different from `False`
    # ("checked, and it isn't there"). PATCH deliberately skips probing the provider it
    # isn't switching to, and reporting that as a definitive `false` was a fabricated
    # fact: clients would render a perfectly healthy provider as unreachable. GET always
    # probes, so it never returns `None`.
    reachable: bool | None


class SettingsOut(BaseModel):
    active_llm_provider: str
    available_providers: list[ProviderInfo]


class SettingsUpdate(BaseModel):
    # A Literal rather than `str`: FastAPI rejects anything else with its standard 422
    # HTTPValidationError before this handler runs, so an unknown provider can never
    # reach app.state.
    llm_provider: Provider


def _ollama_reachable() -> bool:
    try:
        response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
        return response.status_code == 200
    except Exception:
        return False


def _gemini_info() -> ProviderInfo:
    # Gemini's "reachability" is just whether a key is configured - no network call, so
    # it's always cheap enough to compute on every request.
    return ProviderInfo(id="gemini", label="Gemini", reachable=bool(settings.gemini_api_key))


def _ollama_info(reachable: bool | None) -> ProviderInfo:
    return ProviderInfo(id="ollama", label=f"Ollama ({settings.ollama_model})", reachable=reachable)


def _build_settings_out(active_provider: str, ollama_reachable: bool | None = None) -> SettingsOut:
    """GET-shaped response: Ollama is probed unless the caller already has a fresh result.

    Callers that deliberately did *not* probe must not route through here - they should
    build the `ProviderInfo` list directly with `reachable=None`, because the omitted
    argument here means "probe for me", not "unknown".
    """
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
    # Only probe Ollama when it's actually the switch target - reachability of the
    # *other* provider has no bearing on whether this switch succeeds, and probing it
    # would add real network latency for no reason. The un-probed provider is reported
    # as `reachable: null` ("we didn't look"), never a made-up `false`.
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
