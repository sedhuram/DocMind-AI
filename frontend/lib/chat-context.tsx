"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { apiClient, type ChatSession, type Citation, type MindmapResponse, ApiError } from "./api-client";
import { type DisplayMessage } from "@/components/chat/MessageBubble";

export interface Note {
  id: string;
  query: string;
  content: string;
  timestamp: string;
}

export interface Toast {
  id: string;
  message: string;
  type: "success" | "info" | "error";
}

export interface ChatContextType {
  sessions: ChatSession[];
  activeSessionId: string;
  setActiveSessionId: (id: string) => void;
  messages: DisplayMessage[];
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>;
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  deleteSession: (id: string) => Promise<void>;
  clearActiveSessionHistory: () => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  
  // Document context filtering
  selectedDocumentIds: string[];
  setSelectedDocumentIds: (ids: string[]) => void;

  // Message Editing & Copying
  editAndResubmitMessage: (messageId: string, newText: string) => Promise<void>;

  // AI Mindmap Studio
  activeMindmap: MindmapResponse | null;
  isMindmapLoading: boolean;
  activeRightSidebarTab: "pin" | "mindmap";
  setActiveRightSidebarTab: (tab: "pin" | "mindmap") => void;
  triggerMindmap: (topic: string) => Promise<void>;

  // Scratchpad (Pin Board)
  notes: Note[];
  pinToNotes: (query: string, content: string) => void;
  deleteNote: (id: string) => void;
  exportNotesToMarkdown: () => void;

  // Paste to file states
  isPastingUpload: boolean;
  setIsPastingUpload: (val: boolean) => void;
  pastedFilename: string;
  setPastedFilename: (val: string) => void;
  pasteSuccess: boolean;
  setPasteSuccess: (val: boolean) => void;

  // Toast Notifications
  toasts: Toast[];
  addToast: (message: string, type?: Toast["type"]) => void;
  removeToast: (id: string) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("default");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);

  // Mindmap Studio state
  const [activeMindmap, setActiveMindmap] = useState<MindmapResponse | null>(null);
  const [isMindmapLoading, setIsMindmapLoading] = useState(false);
  const [activeRightSidebarTab, setActiveRightSidebarTab] = useState<"pin" | "mindmap">("pin");

  // Paste states
  const [isPastingUpload, setIsPastingUpload] = useState(false);
  const [pastedFilename, setPastedFilename] = useState("");
  const [pasteSuccess, setPasteSuccess] = useState(false);

  // Background sessions streaming storage
  const sessionMessagesRef = useRef<Map<string, DisplayMessage[]>>(new Map());
  const activeStreamsRef = useRef<Set<string>>(new Set());

  // Sync activeSessionId with background streaming status
  const currentActiveSessionRef = useRef<string>(activeSessionId);
  useEffect(() => {
    currentActiveSessionRef.current = activeSessionId;
    setIsStreaming(activeStreamsRef.current.has(activeSessionId));
  }, [activeSessionId]);

  // Load initial sessions & notes from localStorage
  useEffect(() => {
    apiClient.listSessions()
      .then((res) => {
        setSessions(res);
        if (res.length > 0 && !res.some(s => s.id === "default")) {
          setActiveSessionId(res[0].id);
        }
      })
      .catch((err) => console.error("Failed to load sessions:", err));

    const savedNotes = localStorage.getItem("docmind_scratchpad_notes");
    if (savedNotes) {
      try {
        setNotes(JSON.parse(savedNotes));
      } catch (e) {
        console.error("Failed to parse scratchpad notes:", e);
      }
    }
  }, []);

  // Fetch messages when active session changes
  useEffect(() => {
    if (!activeSessionId) return;

    // Check if session has in-memory streaming messages
    if (sessionMessagesRef.current.has(activeSessionId)) {
      setMessages([...(sessionMessagesRef.current.get(activeSessionId) || [])]);
    } else {
      apiClient.getHistory(activeSessionId)
        .then((res) => {
          const mapped: DisplayMessage[] = res.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            citations: typeof m.citations === "string" ? JSON.parse(m.citations) : (m.citations || []),
            latencyMs: m.latency_ms,
            tokensIn: m.tokens_in,
            tokensOut: m.tokens_out,
            status: (m.status as any) || "ok",
            provider: m.provider || null,
          }));
          sessionMessagesRef.current.set(activeSessionId, mapped);
          setMessages(mapped);
        })
        .catch((err) => console.error(`Failed to load messages for session ${activeSessionId}:`, err));
    }
  }, [activeSessionId]);

  // Toast Actions
  const addToast = (message: string, type: Toast["type"] = "info") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => removeToast(id), 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Sessions CRUD
  const createSession = async (title?: string) => {
    try {
      const session = await apiClient.createSession(title);
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      addToast(`Created session: "${session.title}"`, "success");
      return session.id;
    } catch (err) {
      addToast("Failed to create chat session.", "error");
      throw err;
    }
  };

  const renameSession = async (id: string, title: string) => {
    try {
      const updated = await apiClient.updateSession(id, title);
      setSessions((prev) => prev.map((s) => (s.id === id ? updated : s)));
      addToast("Renamed session.", "success");
    } catch (err) {
      addToast("Failed to rename session.", "error");
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await apiClient.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      sessionMessagesRef.current.delete(id);
      addToast("Deleted chat session.", "success");
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        if (remaining.length > 0) {
          setActiveSessionId(remaining[0].id);
        } else {
          setActiveSessionId("default");
        }
      }
    } catch (err) {
      addToast("Failed to delete session.", "error");
    }
  };

  const clearActiveSessionHistory = async () => {
    try {
      await apiClient.clearHistory(activeSessionId);
      sessionMessagesRef.current.set(activeSessionId, []);
      setMessages([]);
      addToast("Cleared history.", "success");
    } catch {
      addToast("Failed to clear chat history.", "error");
    }
  };

  // Resubmit Stream (used after editing message)
  const resubmitStream = async (text: string) => {
    const targetSessionId = activeSessionId;
    activeStreamsRef.current.add(targetSessionId);
    if (currentActiveSessionRef.current === targetSessionId) {
      setIsStreaming(true);
    }

    const assistantId = `local-assistant-${Date.now()}`;
    const assistantMessage: DisplayMessage = {
      id: assistantId, role: "assistant", content: "",
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok", provider: null,
    };

    const currentMsgs = sessionMessagesRef.current.get(targetSessionId) || [];
    const updatedMsgs = [...currentMsgs, assistantMessage];
    sessionMessagesRef.current.set(targetSessionId, updatedMsgs);

    if (currentActiveSessionRef.current === targetSessionId) {
      setMessages([...updatedMsgs]);
    }

    const docFilter = selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined;

    apiClient.streamChat(text, targetSessionId, {
      onToken: (delta) => {
        const msgs = sessionMessagesRef.current.get(targetSessionId) || [];
        const nextMsgs = msgs.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
        sessionMessagesRef.current.set(targetSessionId, nextMsgs);

        if (currentActiveSessionRef.current === targetSessionId) {
          setMessages([...nextMsgs]);
        }
      },
      onDone: (payload) => {
        const msgs = sessionMessagesRef.current.get(targetSessionId) || [];
        const nextMsgs = msgs.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                citations: payload.citations,
                latencyMs: payload.latency_ms,
                tokensIn: payload.tokens_in,
                tokensOut: payload.tokens_out,
                status: payload.status,
                provider: payload.provider,
              }
            : m
        );
        sessionMessagesRef.current.set(targetSessionId, nextMsgs);
        activeStreamsRef.current.delete(targetSessionId);

        if (currentActiveSessionRef.current === targetSessionId) {
          setMessages([...nextMsgs]);
          setIsStreaming(false);
        } else {
          const sessObj = sessions.find(s => s.id === targetSessionId);
          addToast(`Response ready in session "${sessObj?.title || targetSessionId}"`, "success");
        }
      },
      onError: (message) => {
        const msgs = sessionMessagesRef.current.get(targetSessionId) || [];
        const nextMsgs = msgs.map((m) => (m.id === assistantId ? { ...m, content: message, status: "error" as const } : m));
        sessionMessagesRef.current.set(targetSessionId, nextMsgs);
        activeStreamsRef.current.delete(targetSessionId);

        if (currentActiveSessionRef.current === targetSessionId) {
          setMessages([...nextMsgs]);
          setIsStreaming(false);
        }
        addToast("Error generating response.", "error");
      },
    }, docFilter);
  };

  // Edit Message
  const editAndResubmitMessage = async (messageId: string, newText: string) => {
    if (!newText.trim() || isStreaming) return;
    try {
      await apiClient.editMessage(messageId, newText);
      const currentMsgs = sessionMessagesRef.current.get(activeSessionId) || [];
      const idx = currentMsgs.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        const truncated = currentMsgs.slice(0, idx + 1);
        truncated[idx] = { ...truncated[idx], content: newText };
        sessionMessagesRef.current.set(activeSessionId, truncated);
        setMessages([...truncated]);
      }

      // Trigger the assistant reply stream in timeout
      setTimeout(() => {
        resubmitStream(newText);
      }, 50);

      addToast("Question updated. Regenerating...", "success");
    } catch {
      addToast("Failed to edit question.", "error");
    }
  };

  // Mindmap trigger
  const triggerMindmap = async (topic: string) => {
    if (isMindmapLoading) return;
    setIsMindmapLoading(true);
    setActiveRightSidebarTab("mindmap");
    // Dispatch event to slide right panel open in TabShell
    window.dispatchEvent(new CustomEvent("openRightSidebar"));
    addToast("Analyzing sources to build mindmap...", "info");

    try {
      const response = await apiClient.generateMindmap(topic);
      setActiveMindmap(response);
      addToast("AI Mindmap generated successfully!", "success");
    } catch (err) {
      addToast("Failed to generate AI Mindmap.", "error");
    } finally {
      setIsMindmapLoading(false);
    }
  };

  // Streaming generation (Initial query)
  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    const targetSessionId = activeSessionId;
    activeStreamsRef.current.add(targetSessionId);
    if (currentActiveSessionRef.current === targetSessionId) {
      setIsStreaming(true);
    }

    const userMsgId = `local-user-${Date.now()}`;
    const userMessage: DisplayMessage = {
      id: userMsgId, role: "user", content: text,
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok", provider: null,
    };
    const assistantId = `local-assistant-${Date.now()}`;
    const assistantMessage: DisplayMessage = {
      id: assistantId, role: "assistant", content: "",
      citations: [], latencyMs: null, tokensIn: null, tokensOut: null, status: "ok", provider: null,
    };

    const currentMsgs = sessionMessagesRef.current.get(targetSessionId) || messages;
    const updatedMsgs = [...currentMsgs, userMessage, assistantMessage];
    sessionMessagesRef.current.set(targetSessionId, updatedMsgs);

    if (currentActiveSessionRef.current === targetSessionId) {
      setMessages([...updatedMsgs]);
    }

    const docFilter = selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined;

    apiClient.streamChat(text, targetSessionId, {
      onToken: (delta) => {
        const msgs = sessionMessagesRef.current.get(targetSessionId) || [];
        const nextMsgs = msgs.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
        sessionMessagesRef.current.set(targetSessionId, nextMsgs);

        if (currentActiveSessionRef.current === targetSessionId) {
          setMessages([...nextMsgs]);
        }
      },
      onDone: (payload) => {
        const msgs = sessionMessagesRef.current.get(targetSessionId) || [];
        const nextMsgs = msgs.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                citations: payload.citations,
                latencyMs: payload.latency_ms,
                tokensIn: payload.tokens_in,
                tokensOut: payload.tokens_out,
                status: payload.status,
                provider: payload.provider,
              }
            : m
        );
        sessionMessagesRef.current.set(targetSessionId, nextMsgs);
        activeStreamsRef.current.delete(targetSessionId);

        if (currentActiveSessionRef.current === targetSessionId) {
          setMessages([...nextMsgs]);
          setIsStreaming(false);
        } else {
          const sessObj = sessions.find(s => s.id === targetSessionId);
          addToast(`Response ready in session "${sessObj?.title || targetSessionId}"`, "success");
        }

        // Auto-rename session title based on prompt
        const currentSession = sessions.find(s => s.id === targetSessionId);
        if (currentSession && (currentSession.title === "New Chat" || currentSession.title === "Default Chat")) {
          const newTitle = text.length > 25 ? text.substring(0, 25) + "..." : text;
          renameSession(targetSessionId, newTitle);
        }
      },
      onError: (message) => {
        const msgs = sessionMessagesRef.current.get(targetSessionId) || [];
        const nextMsgs = msgs.map((m) => (m.id === assistantId ? { ...m, content: message, status: "error" as const } : m));
        sessionMessagesRef.current.set(targetSessionId, nextMsgs);
        activeStreamsRef.current.delete(targetSessionId);

        if (currentActiveSessionRef.current === targetSessionId) {
          setMessages([...nextMsgs]);
          setIsStreaming(false);
        }
        addToast("Error generating response.", "error");
      },
    }, docFilter);
  };

  // Scratchpad operations
  const pinToNotes = (query: string, content: string) => {
    const newNote: Note = {
      id: Math.random().toString(36).substring(2, 9),
      query: query,
      content: content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " - " + new Date().toLocaleDateString([], { month: "short", day: "numeric" }),
    };

    setNotes((prev) => {
      const updated = [newNote, ...prev];
      localStorage.setItem("docmind_scratchpad_notes", JSON.stringify(updated));
      return updated;
    });
    addToast("Answer pinned to Pin Board!", "success");
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => {
      const updated = prev.filter((n) => n.id !== id);
      localStorage.setItem("docmind_scratchpad_notes", JSON.stringify(updated));
      return updated;
    });
    addToast("Note removed.", "info");
  };

  const exportNotesToMarkdown = () => {
    if (notes.length === 0) {
      addToast("Scratchpad is empty. Nothing to export.", "info");
      return;
    }

    let markdown = `# DocMind AI Scratchpad Notes\n\n`;
    markdown += `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}\n\n---\n\n`;

    notes.forEach((note, index) => {
      markdown += `## Note ${notes.length - index}: ${note.query}\n`;
      markdown += `*Pinned at: ${note.timestamp}*\n\n`;
      markdown += `${note.content}\n\n`;
      markdown += `---\n\n`;
    });

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `docmind_scratchpad_notes_${new Date().toISOString().slice(0,10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    addToast("Notes exported successfully!", "success");
  };

  return (
    <ChatContext.Provider
      value={{
        sessions,
        activeSessionId,
        setActiveSessionId,
        messages,
        setMessages,
        isStreaming,
        sendMessage,
        createSession,
        deleteSession,
        renameSession,
        clearActiveSessionHistory,
        selectedDocumentIds,
        setSelectedDocumentIds,
        
        editAndResubmitMessage,

        activeMindmap,
        isMindmapLoading,
        activeRightSidebarTab,
        setActiveRightSidebarTab,
        triggerMindmap,

        notes,
        pinToNotes,
        deleteNote,
        exportNotesToMarkdown,

        isPastingUpload,
        setIsPastingUpload,
        pastedFilename,
        setPastedFilename,
        pasteSuccess,
        setPasteSuccess,

        toasts,
        addToast,
        removeToast,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
