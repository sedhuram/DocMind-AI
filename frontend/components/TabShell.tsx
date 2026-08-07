"use client";

import { useState, type ReactNode, useEffect, useRef } from "react";
import { MessageSquare, Activity, Pin, Trash2, X, Settings } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useChat } from "@/lib/chat-context";
import { MindmapStudio } from "./chat/MindmapStudio";
import { LlmHealthBadge } from "@/components/LlmHealthBadge";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { GoogleSignInBadge } from "@/components/auth/GoogleSignInBadge";

export type TabId = "workspace" | "observability";

const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "workspace", label: "Workspace", icon: MessageSquare },
  { id: "observability", label: "Observability", icon: Activity },
];

export function TabShell({
  statusDot,
  providerSwitcher,
  chat,
  documents,
  observability,
}: {
  statusDot: ReactNode;
  providerSwitcher: ReactNode;
  chat: ReactNode;
  documents: ReactNode;
  observability: ReactNode;
}) {
  const [active, setActive] = useState<TabId>("workspace");
  const [isPinBoardOpen, setIsPinBoardOpen] = useState(true);

  // Resizable Sidebars width states
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(340);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  const {
    toasts,
    removeToast,
    notes,
    deleteNote,
    exportNotesToMarkdown,
    activeRightSidebarTab,
    setActiveRightSidebarTab
  } = useChat();

  // Load saved sidebar widths
  useEffect(() => {
    const savedLeft = localStorage.getItem("docmind_left_width");
    if (savedLeft) setLeftWidth(Math.max(240, Math.min(500, parseInt(savedLeft, 10))));

    const savedRight = localStorage.getItem("docmind_right_width");
    if (savedRight) setRightWidth(Math.max(260, Math.min(600, parseInt(savedRight, 10))));
  }, []);

  const handleTabSelect = (tabId: TabId) => {
    setActive(tabId);
    localStorage.setItem("docmind_active_tab", tabId);
    window.dispatchEvent(new CustomEvent("tabChange", { detail: tabId }));
  };

  useEffect(() => {
    localStorage.setItem("docmind_active_tab", active);
  }, [active]);

  // Open right sidebar automatically when mindmap starts generating
  useEffect(() => {
    const handleOpenSidebar = () => {
      setIsPinBoardOpen(true);
    };
    window.addEventListener("openRightSidebar", handleOpenSidebar);
    return () => window.removeEventListener("openRightSidebar", handleOpenSidebar);
  }, []);

  // Mouse move / up handlers for drag resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingLeft.current) {
        const newW = Math.max(220, Math.min(520, e.clientX));
        setLeftWidth(newW);
        localStorage.setItem("docmind_left_width", newW.toString());
      } else if (isDraggingRight.current) {
        const newW = Math.max(240, Math.min(650, window.innerWidth - e.clientX));
        setRightWidth(newW);
        localStorage.setItem("docmind_right_width", newW.toString());
      }
    };

    const handleMouseUp = () => {
      isDraggingLeft.current = false;
      isDraggingRight.current = false;
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden relative">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-2.5 bg-[var(--surface)] shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-pink-400">DocMind AI</span>
          <LlmHealthBadge />
          {statusDot}
        </div>
        <div className="flex flex-1 justify-center">{providerSwitcher}</div>
        <nav className="flex gap-1.5 items-center mr-3">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabSelect(id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-all duration-200 ${
                active === id
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "text-[var(--foreground)]/80 hover:bg-[var(--border)]/40 hover:text-[var(--foreground)]"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-l border-[var(--border)] pl-4">
          <GoogleSignInBadge />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("openSettingsModal"))}
            title="Open Engine & Control Panel"
            className="rounded-md border border-[var(--border)] p-2 text-[var(--foreground)]/70 hover:bg-[var(--border)]/30 hover:text-[var(--accent)] transition-all cursor-pointer"
          >
            <Settings size={16} />
          </button>

          {active === "workspace" && (
            <button
              onClick={() => setIsPinBoardOpen(!isPinBoardOpen)}
              title="Toggle Right Panel"
              className={`rounded-md border p-2 transition-all duration-200 cursor-pointer ${
                isPinBoardOpen
                  ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--foreground)]/70 hover:bg-[var(--border)]/30"
              }`}
            >
              <Pin size={16} />
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-hidden min-h-0 bg-[var(--background)]">
        {active === "workspace" ? (
          <div className="flex h-full w-full overflow-hidden relative">
            {/* Left Sidebar: Document Management */}
            <aside
              style={{ width: `${leftWidth}px` }}
              className="bg-[var(--surface)] flex flex-col h-full overflow-hidden shrink-0 select-none"
            >
              {documents}
            </aside>

            {/* Left Drag Resize Handle */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                isDraggingLeft.current = true;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              className="w-1.5 hover:w-2 bg-transparent hover:bg-[var(--accent)]/50 cursor-col-resize shrink-0 h-full border-r border-[var(--border)] transition-colors z-20 group relative"
              title="Drag to resize left panel"
            >
              <div className="absolute top-1/2 left-0 -translate-y-1/2 w-full h-8 bg-[var(--border)] group-hover:bg-[var(--accent)] transition-colors rounded-full" />
            </div>

            {/* Center Main Area: Streaming Chat */}
            <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 bg-[var(--background)]">
              {chat}
            </div>

            {/* Right Drag Resize Handle */}
            {isPinBoardOpen && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingRight.current = true;
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                className="w-1.5 hover:w-2 bg-transparent hover:bg-[var(--accent)]/50 cursor-col-resize shrink-0 h-full border-l border-[var(--border)] transition-colors z-20 group relative"
                title="Drag to resize right panel"
              >
                <div className="absolute top-1/2 left-0 -translate-y-1/2 w-full h-8 bg-[var(--border)] group-hover:bg-[var(--accent)] transition-colors rounded-full" />
              </div>
            )}

            {/* Right Sidebar: Studio Panel */}
            {isPinBoardOpen && (
              <aside
                style={{ width: `${rightWidth}px` }}
                className="bg-[var(--surface)] flex flex-col h-full overflow-hidden shrink-0 animate-[slideIn_0.15s_ease-out]"
              >
                {/* Tabbed Studio Panel Header */}
                <div className="p-2 border-b border-[var(--border)] bg-gradient-to-r from-pink-500/5 to-indigo-500/5 flex items-center justify-between shrink-0">
                  <div className="flex bg-[var(--border)]/20 p-0.5 rounded-lg">
                    <button
                      onClick={() => setActiveRightSidebarTab("pin")}
                      className={`px-3 py-1 text-[10px] font-extrabold rounded-md transition-all cursor-pointer ${
                        activeRightSidebarTab === "pin"
                          ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                          : "text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
                      }`}
                    >
                      📌 Pin Board
                    </button>
                    <button
                      onClick={() => setActiveRightSidebarTab("mindmap")}
                      className={`px-3 py-1 text-[10px] font-extrabold rounded-md transition-all cursor-pointer ${
                        activeRightSidebarTab === "mindmap"
                          ? "bg-[var(--surface)] text-[var(--foreground)] shadow-xs"
                          : "text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
                      }`}
                    >
                      🗺️ Mindmap
                    </button>
                  </div>
                  {activeRightSidebarTab === "pin" && (
                    <button
                      onClick={exportNotesToMarkdown}
                      title="Export all notes to Markdown"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--border)]/40 px-2 py-0.5 text-[9px] font-bold text-[var(--foreground)]/80 flex items-center gap-1 transition-all duration-200 cursor-pointer"
                    >
                      Export (.md)
                    </button>
                  )}
                </div>

                {/* Studio Content Switch */}
                {activeRightSidebarTab === "pin" ? (
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {notes.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-4 text-[var(--foreground)]/40">
                        <span className="text-2xl mb-2">📓</span>
                        <p className="text-xs font-semibold">Your scratchpad is empty</p>
                        <p className="text-[10px] mt-1 text-[var(--foreground)]/50">Click "Pin to Notes" on chat responses to save them here.</p>
                      </div>
                    ) : (
                      notes.map((note) => (
                        <div key={note.id} className="group relative rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm hover:border-[var(--accent)]/40 transition-all duration-200">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <span className="text-xs font-bold text-[var(--foreground)] pr-4 break-words leading-tight">{note.query}</span>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="absolute top-2.5 right-2.5 opacity-0 group-hover:opacity-100 text-[var(--foreground)]/40 hover:text-red-500 transition-all duration-150"
                              title="Remove note"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <div className="text-[11px] text-[var(--foreground)]/70 line-clamp-6 whitespace-pre-wrap leading-relaxed border-t border-[var(--border)]/40 pt-1.5 max-h-36 overflow-hidden">
                            {note.content}
                          </div>
                          <div className="text-[9px] text-[var(--foreground)]/45 text-right mt-2 font-medium">{note.timestamp}</div>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="flex-1 overflow-hidden">
                    <MindmapStudio />
                  </div>
                )}
              </aside>
            )}
          </div>
        ) : (
          observability
        )}
      </main>

      {/* Global Settings Control Panel Modal */}
      <SettingsModal />

      {/* Global Sleek Top-Center Toast Notifications Banner */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none w-full max-w-md px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 w-full rounded-xl px-4 py-2.5 text-xs font-bold shadow-xl border backdrop-blur-md transition-all duration-200 animate-[slideDown_0.25s_cubic-bezier(0.16,1,0.3,1)] ${
              toast.type === "success"
                ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-600 dark:text-emerald-400 shadow-emerald-500/10"
                : toast.type === "error"
                  ? "bg-red-500/15 border-red-500/35 text-red-600 dark:text-red-400 shadow-red-500/10"
                  : "bg-[var(--surface)]/90 border-[var(--border)] text-[var(--foreground)] shadow-black/10"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm">
                {toast.type === "success" ? "✨" : toast.type === "error" ? "⚠️" : "🔔"}
              </span>
              <span>{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-[var(--foreground)]/50 hover:text-[var(--foreground)] shrink-0 p-0.5 rounded transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

