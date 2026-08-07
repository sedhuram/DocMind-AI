"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiClient, type Citation } from "@/lib/api-client";

export function CitationDrawer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    apiClient
      .getChunk(citation.document_id, citation.chunk_index)
      .then((chunk) => {
        if (!cancelled) setText(chunk.text);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this source chunk.");
      });
    return () => {
      cancelled = true;
    };
  }, [citation]);

  return (
    <div className="fixed inset-y-0 right-0 z-20 w-96 border-l border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-medium">{citation.filename}</p>
          <p className="text-xs text-[var(--foreground)]/60">
            {citation.page_number ? `Page ${citation.page_number}` : `Chunk ${citation.chunk_index}`} · similarity{" "}
            {citation.score.toFixed(2)}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!error && text === null && <p className="text-sm text-[var(--foreground)]/60">Loading...</p>}
      {text && (
        <div className="flex flex-col h-[calc(100%-60px)] justify-between">
          <div className="overflow-y-auto flex-1 pr-1">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]/80">{text}</p>
          </div>
          <div className="mt-4 pt-3 border-t border-[var(--border)] text-[10px] text-[var(--foreground)]/50 space-y-1 bg-[var(--surface)] shrink-0">
            <p><span className="font-bold text-[var(--foreground)]/70">Source:</span> {citation.source_name || citation.filename}</p>
            <p><span className="font-bold text-[var(--foreground)]/70">Chunk ID:</span> {citation.chunk_id || `${citation.document_id}_${citation.chunk_index}`}</p>
            {citation.upload_timestamp && (
              <p><span className="font-bold text-[var(--foreground)]/70">Indexed At:</span> {new Date(citation.upload_timestamp).toLocaleString()}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
