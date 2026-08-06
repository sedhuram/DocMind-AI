"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Citation } from "@/lib/api-client";
import { CitationDrawer } from "@/components/chat/CitationDrawer";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  status: "ok" | "low_confidence" | "error";
}

export function MessageBubble({ message }: { message: DisplayMessage }) {
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-2xl rounded-lg px-4 py-3 ${
          isUser ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)]"
        }`}
      >
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {!isUser && message.status === "low_confidence" && (
          <p className="mt-2 text-xs font-medium text-amber-500">Low retrieval confidence — verify this answer.</p>
        )}

        {!isUser && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((citation, i) => (
              <button
                key={`${citation.document_id}-${citation.chunk_index}`}
                onClick={() => setOpenCitation(citation)}
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--border)]/30"
              >
                [{i + 1}] {citation.filename}
              </button>
            ))}
          </div>
        )}

        {!isUser && message.latencyMs !== null && (
          <p className="mt-2 text-xs text-[var(--foreground)]/50">
            {message.latencyMs}ms · {message.tokensIn ?? 0}+{message.tokensOut ?? 0} tokens · {message.citations.length} sources
          </p>
        )}
      </div>
      {openCitation && <CitationDrawer citation={openCitation} onClose={() => setOpenCitation(null)} />}
    </div>
  );
}
