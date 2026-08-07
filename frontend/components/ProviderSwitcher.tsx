"use client";

import { useEffect, useState } from "react";
import { apiClient, type SettingsOut } from "@/lib/api-client";

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
      setSettingsState(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch provider.");
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
        {settingsState.available_providers.map((p) => (
          <button
            key={p.id}
            onClick={() => handleSelect(p.id)}
            disabled={!p.reachable || isSwitching}
            title={p.reachable ? p.label : `${p.label} is unreachable`}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              settingsState.active_llm_provider === p.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--foreground)]/70 hover:bg-[var(--border)]/40"
            } ${!p.reachable || isSwitching ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
