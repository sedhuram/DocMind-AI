"use client";

import { useEffect, useState } from "react";
import { FileText, X, Loader2, Layers, HardDrive } from "lucide-react";
import { apiClient, type DocumentOut, type ChunkOut } from "@/lib/api-client";

export function DocumentPreviewModal({
  document,
  onClose,
}: {
  document: DocumentOut | null;
  onClose: () => void;
}) {
  const [chunk, setChunk] = useState<ChunkOut | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!document) return;
    setLoading(true);
    apiClient
      .getChunk(document.id, 0)
      .then((c) => setChunk(c))
      .catch(() => setChunk(null))
      .finally(() => setLoading(false));
  }, [document]);

  if (!document) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-pink-500/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-4">
            <FileText className="text-[var(--accent)] shrink-0" size={18} />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[var(--foreground)] truncate">{document.filename}</h2>
              <div className="flex items-center gap-3 text-[10px] text-[var(--foreground)]/50 font-medium mt-0.5">
                <span className="flex items-center gap-1">
                  <HardDrive size={10} />
                  {(document.size_bytes / 1024).toFixed(1)} KB
                </span>
                <span className="flex items-center gap-1">
                  <Layers size={10} />
                  {document.chunk_count} Chunks
                </span>
                <span className="uppercase font-mono text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)]">
                  {document.source_type}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--foreground)]/50 hover:text-[var(--foreground)] p-1 rounded-md transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Text Chunk Preview Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-3">
          <h3 className="text-xs font-bold text-[var(--foreground)] flex items-center justify-between">
            <span>Parsed Vector Chunk #0 Preview</span>
            <span className="text-[9.5px] font-normal text-[var(--foreground)]/40 font-mono">
              Status: {document.status}
            </span>
          </h3>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-[var(--foreground)]/50">
              <Loader2 className="animate-spin text-[var(--accent)] mb-2" size={24} />
              <span className="text-xs font-semibold">Loading chunk text...</span>
            </div>
          ) : chunk ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-xs font-mono text-[var(--foreground)]/80 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto select-text scrollbar-thin">
              {chunk.text}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-[var(--foreground)]/40 italic">
              No text chunks available for preview.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--border)] bg-[var(--surface)] flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-bold rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 transition-all cursor-pointer"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
