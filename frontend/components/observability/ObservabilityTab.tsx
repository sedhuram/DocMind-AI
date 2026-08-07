"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiClient, type ObservabilityRow } from "@/lib/api-client";

const STATUS_COLOR: Record<string, string> = {
  ok: "text-emerald-500",
  low_confidence: "text-amber-500",
  error: "text-red-500",
};

export function ObservabilityTab() {
  const [rows, setRows] = useState<ObservabilityRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let hasLoadedOnce = false;

    const load = () =>
      apiClient
        .getObservabilityRequests()
        .then((data) => {
          if (cancelled) return;
          setRows(data);
          setLoadError(null);
          hasLoadedOnce = true;
        })
        .catch((err) => {
          if (cancelled) return;
          // A transient failure on a background poll shouldn't clobber the table with
          // an error banner — just keep showing the last known good data. Only surface
          // an error if we've never successfully loaded anything yet.
          if (!hasLoadedOnce) {
            setLoadError(err instanceof Error ? err.message : "Couldn't reach the backend. Is it running?");
          }
        });

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <p className="mb-4 text-sm text-[var(--foreground)]/60">
          Recent chat requests with retrieval and generation metadata — the same data logged as structured JSON on the backend.
        </p>
        {loadError && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
            <span>{loadError}</span>
            <button
              onClick={() => setLoadError(null)}
              aria-label="Dismiss error"
              className="shrink-0 text-red-500/70 hover:text-red-500"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {rows.length === 0 && !loadError ? (
          <p className="text-[var(--foreground)]/50">No requests yet.</p>
        ) : rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--foreground)]/60">
              <tr className="border-b border-[var(--border)]">
                <th className="py-2">Query</th>
                <th>Latency</th>
                <th>Tokens in/out</th>
                <th>Chunks</th>
                <th>Top score</th>
                <th>Status</th>
                <th>Provider</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)]/50">
                  <td className="max-w-xs truncate py-2">{row.query}</td>
                  <td>{row.latency_ms ?? "-"}ms</td>
                  <td>
                    {row.tokens_in ?? 0}/{row.tokens_out ?? 0}
                  </td>
                  <td>{row.chunks_retrieved ?? 0}</td>
                  <td>{row.top_score?.toFixed(2) ?? "-"}</td>
                  <td className={STATUS_COLOR[row.status] ?? ""}>{row.status}</td>
                  <td>{row.provider ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
