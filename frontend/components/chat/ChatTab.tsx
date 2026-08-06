"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2, X } from "lucide-react";
import { apiClient, type Citation } from "@/lib/api-client";
import { MessageBubble, type DisplayMessage } from "@/components/chat/MessageBubble";
import { CitationDrawer } from "@/components/chat/CitationDrawer";

export function ChatTab() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiClient
      .getHistory()
      .then((history) => {
        setLoadError(null);
        setMessages(
          history.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            citations: m.citations,
            latencyMs: m.latency_ms,
            tokensIn: m.tokens_in,
            tokensOut: m.tokens_out,
            status: m.status,
          }))
        );
      })
      .catch(() => {
        setLoadError("Couldn't reach the backend. Is it running?");
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    const userMessage: DisplayMessage = {
      id: `local-user-${Date.now()}`, role: "user", content: text,
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok",
    };
    const assistantId = `local-assistant-${Date.now()}`;
    const assistantMessage: DisplayMessage = {
      id: assistantId, role: "assistant", content: "",
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok",
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    await apiClient.streamChat(text, {
      onToken: (delta) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
        );
      },
      onDone: (payload) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, citations: payload.citations, latencyMs: payload.latency_ms, tokensIn: payload.tokens_in, tokensOut: payload.tokens_out, status: payload.status }
              : m
          )
        );
        setIsStreaming(false);
      },
      onError: (message) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: message, status: "error" } : m))
        );
        setIsStreaming(false);
      },
    });
  }

  async function handleClear() {
    try {
      await apiClient.clearHistory();
      setMessages([]);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't reach the backend. Is it running?");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end border-b border-[var(--border)] px-4 py-2">
        <button onClick={handleClear} className="flex items-center gap-1 text-xs text-[var(--foreground)]/60 hover:text-red-500">
          <Trash2 size={12} /> Clear conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loadError && (
          <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
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
        {messages.length === 0 && !loadError && (
          <div className="flex h-full flex-col items-center justify-center text-center text-[var(--foreground)]/50">
            <p className="text-lg font-medium">No conversation yet</p>
            <p className="text-sm">Ask a question about the documents in your collection to get started.</p>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onOpenCitation={setOpenCitation} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {openCitation && <CitationDrawer citation={openCitation} onClose={() => setOpenCitation(null)} />}

      <div className="border-t border-[var(--border)] p-4">
        <div className="mx-auto flex max-w-3xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask a question about your documents..."
            className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
