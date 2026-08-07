"use client";

import { useEffect, useState } from "react";
import { Activity, ShieldAlert, ShieldCheck } from "lucide-react";
import { apiClient, type ProviderHealthOut } from "@/lib/api-client";

export function LlmHealthBadge() {
  const [health, setHealth] = useState<ProviderHealthOut | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const data = await apiClient.getProviderHealth();
      setHealth(data);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleClick = () => {
    window.dispatchEvent(new CustomEvent("openSettingsModal"));
  };

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)]/50 animate-pulse">
        <Activity size={12} className="animate-spin" />
        <span>Checking LLM...</span>
      </div>
    );
  }

  const isHealthy = health?.healthy ?? false;
  const providerName = health?.provider ? health.provider.toUpperCase() : "LLM";

  return (
    <button
      onClick={handleClick}
      title={health?.message || "Click to configure LLM settings"}
      className={`group flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold transition-all duration-200 cursor-pointer shadow-2xs ${
        isHealthy
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
          : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 animate-pulse"
      }`}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
            isHealthy ? "bg-emerald-400 animate-ping" : "bg-red-400 animate-ping"
          }`}
        />
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            isHealthy ? "bg-emerald-500" : "bg-red-500"
          }`}
        />
      </span>
      <span>{providerName}</span>
      <span className="text-[9px] opacity-75 font-mono">
        {isHealthy ? `${health?.latency_ms}ms` : "OFFLINE"}
      </span>
    </button>
  );
}
