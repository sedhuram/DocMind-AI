"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Edit2, Check, X } from "lucide-react";
import type { Citation, MessageStatus } from "@/lib/api-client";
import { useChat } from "@/lib/chat-context";

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
  isStreaming?: boolean;
}

export function MessageBubble({ message, onOpenCitation, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isError = !isUser && message.status === "error";
  const isLoading = !isUser && message.content === "" && message.status === "ok";

  const { pinToNotes, messages: allMessages, editAndResubmitMessage, triggerMindmap } = useChat();

  // Edit and copy states
  const [isEditing, setIsEditing] = useState(false);
  const [editVal, setEditVal] = useState(message.content);
  const [copied, setCopied] = useState(false);

  const handlePin = () => {
    const idx = allMessages.findIndex((m) => m.id === message.id);
    const userQuery = idx > 0 ? allMessages[idx - 1].content : "Pinned Note";
    pinToNotes(userQuery, message.content);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text", err);
    }
  };

  const handleSaveEdit = async () => {
    if (!editVal.trim() || editVal.trim() === message.content) {
      setIsEditing(false);
      return;
    }
    await editAndResubmitMessage(message.id, editVal.trim());
    setIsEditing(false);
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} group relative`}>
      {/* Hover action bar for user messages */}
      {isUser && !isEditing && (
        <div className="absolute right-4 -top-3.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 shadow-sm">
          <button
            onClick={handleCopy}
            title="Copy question"
            className="text-[var(--foreground)]/50 hover:text-[var(--foreground)] p-0.5 rounded transition-colors"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
          <button
            onClick={() => {
              setIsEditing(true);
              setEditVal(message.content);
            }}
            title="Edit question"
            className="text-[var(--foreground)]/50 hover:text-[var(--foreground)] p-0.5 rounded transition-colors"
          >
            <Edit2 size={12} />
          </button>
          <button
            onClick={() => triggerMindmap(message.content)}
            className="rounded bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)] transition-all duration-150 cursor-pointer"
          >
            mindmap
          </button>
        </div>
      )}

      <div
        className={`max-w-2xl rounded-lg px-4 py-3 ${
          isUser
            ? "bg-[var(--accent)] text-white"
            : isError
              ? "border border-red-500/40 bg-red-500/5"
              : "border border-[var(--border)] bg-[var(--surface)]"
        }`}
      >
        {isEditing ? (
          <div className="flex flex-col gap-2 min-w-[280px]">
            <textarea
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSaveEdit()}
              rows={2}
              className="w-full bg-[var(--surface)] border border-[var(--border)] rounded p-2 text-xs outline-none text-[var(--foreground)] focus:border-[var(--accent)] resize-y"
            />
            <div className="flex justify-end gap-1.5">
              <button
                onClick={() => setIsEditing(false)}
                className="rounded border border-[var(--border)] hover:bg-[var(--border)]/20 p-1 text-[var(--foreground)]"
                title="Cancel"
              >
                <X size={13} />
              </button>
              <button
                onClick={handleSaveEdit}
                className="rounded bg-emerald-500 text-white hover:bg-emerald-600 p-1"
                title="Save & Resubmit"
              >
                <Check size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`prose prose-sm max-w-none ${isUser ? "prose-invert" : "dark:prose-invert"} ${
              isError ? "text-[var(--foreground)]/60 italic" : ""
            }`}
          >
            {isLoading ? (
              <div className="flex space-x-1.5 py-2 items-center justify-start">
                <div className="h-2 w-2 bg-[var(--foreground)]/40 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="h-2 w-2 bg-[var(--foreground)]/40 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="h-2 w-2 bg-[var(--foreground)]/40 rounded-full animate-bounce"></div>
              </div>
            ) : (
              <>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="mb-2 last:mb-0 last:inline">{children}</p>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                {isStreaming && (
                  <span className="inline-block h-3.5 w-1.5 bg-[var(--accent)] ml-1.5 align-middle animate-pulse" />
                )}
              </>
            )}
          </div>
        )}

        {isError && (
          <p className="mt-2 text-xs font-medium text-red-500">This turn failed — no answer was generated.</p>
        )}

        {!isUser && message.status === "low_confidence" && (
          <p className="mt-2 text-xs font-medium text-amber-500">Low retrieval confidence — verify this answer.</p>
        )}

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
          <div className="mt-3 pt-2 border-t border-[var(--border)]/40 flex items-center justify-between gap-4 text-[10px] text-[var(--foreground)]/50">
            <div>
              {message.latencyMs}ms · {message.tokensIn ?? 0}+{message.tokensOut ?? 0} tokens ·{" "}
              {message.citations.length} sources retrieved
            </div>
            <button
              onClick={handlePin}
              title="Pin response to Pin Board"
              className="flex items-center gap-1 font-bold text-[var(--accent)] hover:text-[var(--accent)]/85 transition-colors duration-150 rounded px-1.5 py-0.5 bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10 cursor-pointer"
            >
              Pin to Notes
            </button>
          </div>
        )}

        {!isUser && message.provider && (
          <p className="mt-1 text-[9px] text-[var(--foreground)]/40 text-right">via {message.provider}</p>
        )}
      </div>
    </div>
  );
}
