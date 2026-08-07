"use client";

import ReactMarkdown from "react-markdown";
import type { Citation, MessageStatus } from "@/lib/api-client";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  status: MessageStatus;
  provider: string | null;
}

export interface MessageBubbleProps {
  message: DisplayMessage;
  onOpenCitation: (citation: Citation) => void;
}

export function MessageBubble({ message, onOpenCitation }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = !isUser && message.status === "error";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-2xl rounded-lg px-4 py-3 ${
          isUser
            ? "bg-[var(--accent)] text-white"
            : isError
              ? // A failed turn is persisted with a placeholder message, so on reload it must
                // read as a failure rather than as a normal (or merely low-confidence) answer.
                "border border-red-500/40 bg-red-500/5"
              : "border border-[var(--border)] bg-[var(--surface)]"
        }`}
      >
        <div
          className={`prose prose-sm max-w-none dark:prose-invert ${
            isError ? "text-[var(--foreground)]/60 italic" : ""
          }`}
        >
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {isError && (
          <p className="mt-2 text-xs font-medium text-red-500">This turn failed — no answer was generated.</p>
        )}

        {!isUser && message.status === "low_confidence" && (
          <p className="mt-2 text-xs font-medium text-amber-500">Low retrieval confidence — verify this answer.</p>
        )}

        {/* These badges are every chunk that was *retrieved* and handed to the model as
            context - not a verified list of chunks the model actually referenced in its
            answer. The model may ground its response in only one of them. Labelling them
            honestly ("sources retrieved") avoids overclaiming; deriving true citations
            would mean parsing the [Source N] markers back out of the finished answer. */}
        {!isUser && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((citation, i) => (
              <button
                key={`${citation.document_id}-${citation.chunk_index}`}
                onClick={() => onOpenCitation(citation)}
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs hover:bg-[var(--border)]/30"
              >
                [{i + 1}] {citation.filename}
              </button>
            ))}
          </div>
        )}

        {!isUser && message.latencyMs !== null && (
          <p className="mt-2 text-xs text-[var(--foreground)]/50">
            {message.latencyMs}ms · {message.tokensIn ?? 0}+{message.tokensOut ?? 0} tokens ·{" "}
            {message.citations.length} sources retrieved
          </p>
        )}

        {!isUser && message.provider && (
          <p className="mt-0.5 text-xs text-[var(--foreground)]/40">via {message.provider}</p>
        )}
      </div>
    </div>
  );
}
