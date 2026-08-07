"use client";

import { useEffect, useState } from "react";
import { ApiError, apiClient, type SettingsOut } from "@/lib/api-client";

const SWITCH_FAILED = "Couldn't switch provider.";

export function ProviderSwitcher() {
  const [settingsState, setSettingsState] = useState<SettingsOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    apiClient
      .getSettings()
      .then(setSettingsState)
      .catch(() => setError("Couldn't load provider settings."));
  }, []);

  async function handleSelect(providerId: string) {
    if (!settingsState || settingsState.active_llm_provider === providerId || isSwitching) return;
    setError(null);
    setIsSwitching(true);
    try {
      const updated = await apiClient.updateSettings(providerId);
      // The PATCH response only freshly probes the switch target's reachability;
      // the other provider's `reachable` comes back as null ("not checked"). Follow
      // up with a GET so both providers' reachability reflects reality, not just
      // the one we happened to switch to.
      try {
        const fresh = await apiClient.getSettings();
        setSettingsState(fresh);
      } catch {
        // Fall back to the PATCH response rather than leaving stale/no state.
        setSettingsState(updated);
      }
    } catch (err) {
      // `err.message` is the full `400 Bad Request: {"detail":"..."}` form, which puts
      // raw JSON in front of the user. ApiError.detail is the sentence the backend's
      // HTTPException actually wrote; anything else (non-JSON body, 422 validation
      // array, network failure) falls back to a plain generic line.
      setError(err instanceof ApiError ? (err.detail ?? SWITCH_FAILED) : SWITCH_FAILED);
    } finally {
      setIsSwitching(false);
    }
  }

  if (!settingsState) {
    // Even without settings loaded, surface a load failure instead of rendering nothing —
    // an early `return null` here would silently swallow the error set in the effect above.
    return error ? <span className="text-xs text-red-500">{error}</span> : null;
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1 rounded-md border border-[var(--border)] p-0.5">
        {settingsState.available_providers.map((p) => {
          // `reachable` is now three-valued: true, false, or null ("the backend didn't
          // probe it on this response"). Only a confirmed `true` enables the button —
          // offering a switch we can't vouch for just trades a disabled button for a
          // failed request. In practice null is visible for at most one render frame,
          // between the PATCH response and the follow-up GET above.
          const unavailable = p.reachable !== true;
          return (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              disabled={unavailable || isSwitching}
              title={
                p.reachable === true
                  ? p.label
                  : p.reachable === false
                    ? `${p.label} is unreachable`
                    : `Checking whether ${p.label} is reachable…`
              }
              className={`rounded px-2 py-1 text-xs transition-colors ${
                settingsState.active_llm_provider === p.id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--foreground)]/70 hover:bg-[var(--border)]/40"
              } ${unavailable || isSwitching ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
