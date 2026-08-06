"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

export function StatusDot() {
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      apiClient
        .getHealth()
        .then((health) => !cancelled && setIsHealthy(health.status === "ok" && health.sqlite_ok))
        .catch(() => !cancelled && setIsHealthy(false));

    check();
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const color = isHealthy === null ? "bg-slate-400" : isHealthy ? "bg-emerald-500" : "bg-red-500";
  const label = isHealthy === null ? "Checking..." : isHealthy ? "Healthy" : "Unreachable";

  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--foreground)]/60" title={label}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
