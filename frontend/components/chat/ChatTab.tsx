"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Trash2, X, Loader2, CheckCircle2, Plus, Edit2, Check, MessageSquare } from "lucide-react";
import { apiClient, ApiError, type Citation } from "@/lib/api-client";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { CitationDrawer } from "@/components/chat/CitationDrawer";
import { useChat } from "@/lib/chat-context";

export function ChatTab() {
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    messages,
    isStreaming,
    sendMessage,
    createSession,
    deleteSession,
    renameSession,
    clearActiveSessionHistory,
    isPastingUpload,
    setIsPastingUpload,
    pastedFilename,
    setPastedFilename,
    pasteSuccess,
    setPasteSuccess,
    addToast
  } = useChat();

  const [input, setInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  // Inline edit state for renaming sessions
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleStartRename = (id: string, currentTitle: string) => {
    setEditingSessionId(id);
    setEditingTitle(currentTitle);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingTitle.trim()) return;
    await renameSession(id, editingTitle.trim());
    setEditingSessionId(null);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    await sendMessage(text);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData("text");
    if (pastedText.length > 150 || pastedText.includes("\n")) {
      e.preventDefault();

      try {
        const docs = await apiClient.listDocuments();
        if (docs.length >= 10) {
          addToast("Limit of 10 documents reached. Please delete some.", "error");
          return;
        }
      } catch {
        // Skip check if API offline, backend will validate anyway
      }

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const dateStr = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
      const filename = `Pasted Text (${dateStr} ${timeStr}).txt`;
      const file = new File([pastedText], filename, { type: "text/plain" });

      setIsPastingUpload(true);
      setPastedFilename(filename);
      setPasteSuccess(false);

      try {
        await apiClient.uploadDocument(file);
        setPasteSuccess(true);
        // Refresh document list in other panes via simple custom event trigger
        window.dispatchEvent(new CustomEvent("refreshDocuments"));
        setTimeout(() => setPasteSuccess(false), 5000);
      } catch (err) {
        let msg = "Failed to upload pasted text.";
        if (err instanceof ApiError && err.detail) {
          msg = err.detail;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        addToast(msg, "error");
      } finally {
        setIsPastingUpload(false);
      }
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Inner Sidebar: Chat Sessions */}
      <aside className="w-52 border-r border-[var(--border)]/70 bg-[var(--surface)]/30 flex flex-col h-full overflow-hidden shrink-0">
        <div className="p-3 border-b border-[var(--border)]/60">
          <button
            onClick={() => createSession()}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 py-2 px-3 text-xs font-semibold text-[var(--foreground)] transition-all duration-200 cursor-pointer"
          >
            <Plus size={13} />
            <span>New Chat</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isEditing = session.id === editingSessionId;

            return (
              <div
                key={session.id}
                className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--foreground)]/70 hover:bg-[var(--border)]/30 hover:text-[var(--foreground)]"
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveRename(session.id)}
                      onBlur={() => handleSaveRename(session.id)}
                      autoFocus
                      className="w-full bg-[var(--surface)] border border-[var(--accent)]/50 rounded px-1 py-0.5 text-xs outline-none text-[var(--foreground)]"
                    />
                    <button
                      onClick={() => handleSaveRename(session.id)}
                      className="text-emerald-500 p-0.5"
                    >
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setActiveSessionId(session.id)}
                    onDoubleClick={() => handleStartRename(session.id, session.title)}
                    className="flex-1 text-left truncate font-semibold pr-2 select-none"
                    title="Double-click to rename"
                  >
                    {session.title}
                  </button>
                )}

                {!isEditing && (
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={() => handleStartRename(session.id, session.title)}
                      className="text-[var(--foreground)]/40 hover:text-[var(--foreground)]"
                      title="Rename session"
                    >
                      <Edit2 size={10} />
                    </button>
                    {session.id !== "default" && (
                      <button
                        onClick={() => deleteSession(session.id)}
                        className="text-[var(--foreground)]/40 hover:text-red-500"
                        title="Delete session"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Chat Panel */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-[var(--background)]">
        <div className="flex items-center justify-between border-b border-[var(--border)]/70 px-4 py-2 bg-[var(--surface)]/20 shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={13} className="text-[var(--accent)]" />
            <span className="text-xs font-bold text-[var(--foreground)]">
              {sessions.find((s) => s.id === activeSessionId)?.title || "Chat Session"}
            </span>
          </div>
          <button
            onClick={clearActiveSessionHistory}
            className="flex items-center gap-1 text-[10px] font-bold text-[var(--foreground)]/50 hover:text-red-500 transition-colors"
          >
            <Trash2 size={11} /> Clear history
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
            <div className="flex flex-col items-center justify-center py-4 px-4 max-w-3xl mx-auto">
              <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-md overflow-hidden transition-all duration-300">
                <div className="bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 px-8 py-5 border-b border-[var(--border)]">
                  <h2 className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-pink-400">
                    Welcome to DocMind AI
                  </h2>
                  <p className="text-xs text-[var(--foreground)]/60 mt-1">
                    Your intelligent local RAG assistant. Query, analyze, and cite from your custom document collections.
                  </p>
                </div>

                <div className="p-6 space-y-5">
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--foreground)]/50 mb-2.5">
                      System Capabilities
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--background)]/40 p-2.5">
                        <span className="text-base shrink-0">📝</span>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[var(--foreground)]">Multi-format Ingestion</span>
                          <span className="text-[10px] text-[var(--foreground)]/60 mt-0.5 leading-relaxed">Upload PDF, TXT, MD, and DOCX (up to 3MB per file).</span>
                        </div>
                      </div>
                      <div className="flex gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--background)]/40 p-2.5">
                        <span className="text-base shrink-0">🔍</span>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[var(--foreground)]">Precise Citation Tracing</span>
                          <span className="text-[10px] text-[var(--foreground)]/60 mt-0.5 leading-relaxed">View similarity scores and jump directly to exact document text blocks.</span>
                        </div>
                      </div>
                      <div className="flex gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--background)]/40 p-2.5">
                        <span className="text-base shrink-0">⚡</span>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[var(--foreground)]">Dual Engines</span>
                          <span className="text-[10px] text-[var(--foreground)]/60 mt-0.5 leading-relaxed">Switch between Google Gemini (GA) and local Ollama model options.</span>
                        </div>
                      </div>
                      <div className="flex gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--background)]/40 p-2.5">
                        <span className="text-base shrink-0">📊</span>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[var(--foreground)]">Real-time Observability</span>
                          <span className="text-[10px] text-[var(--foreground)]/60 mt-0.5 leading-relaxed">Audit exact query latencies, token consumption, and chunks retrieved.</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[var(--border)]/60 pt-5">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--foreground)]/50 mb-2.5">
                      Quick Walkthrough
                    </h3>
                    <ol className="text-[11px] text-[var(--foreground)]/70 space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold text-[9px] shrink-0 mt-0.5">1</span>
                        <span>Use the <strong>Documents</strong> panel on the left to index files (Max 10 files total).</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold text-[9px] shrink-0 mt-0.5">2</span>
                        <span>Pasting block texts (&gt;150 chars) in the chat input instantly indexes it as a TXT file.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold text-[9px] shrink-0 mt-0.5">3</span>
                        <span>Enter your query in the input below. The engine retrieves relevant chunks and displays cited answers.</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-semibold text-[9px] shrink-0 mt-0.5">4</span>
                        <span>Click citation badges in chat responses to inspect exact retrieved text and tags.</span>
                      </li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="w-full mt-5 space-y-2">
                <p className="text-xs font-bold text-[var(--foreground)]/50 text-left">Suggested Queries:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "What is DocMind AI and how does it work?",
                    "What file types does this system support?",
                    "Tell me about the system's vector search configuration."
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => setInput(q)}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--border)]/20 px-3 py-1.5 text-xs text-[var(--foreground)]/80 text-left transition-colors duration-200 cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                onOpenCitation={setOpenCitation}
                isStreaming={isStreaming && index === messages.length - 1 && message.role === "assistant"}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {openCitation && <CitationDrawer citation={openCitation} onClose={() => setOpenCitation(null)} />}

        {/* Paste-to-file indexing status banner */}
        {(isPastingUpload || pasteSuccess) && (
          <div className="mx-auto w-full max-w-3xl px-4 py-2 flex items-center gap-2 text-xs border-t border-[var(--border)] bg-[var(--background)]/35 shadow-sm shrink-0">
            {isPastingUpload ? (
              <>
                <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
                <span className="text-[var(--foreground)]/60 font-semibold">
                  Uploading and indexing pasted text: <span className="text-[var(--foreground)]">{pastedFilename}</span>...
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 size={12} className="text-emerald-500" />
                <span className="text-emerald-600 font-bold animate-pulse">
                  Pasted text successfully indexed as <span className="underline">{pastedFilename}</span>!
                </span>
              </>
            )}
          </div>
        )}

        <div className="border-t border-[var(--border)] p-4 shrink-0 bg-[var(--surface)]/10">
          <div className="mx-auto flex max-w-3xl gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              onPaste={handlePaste}
              placeholder="Ask a question about your documents..."
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] text-[var(--foreground)]"
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-40 cursor-pointer"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
