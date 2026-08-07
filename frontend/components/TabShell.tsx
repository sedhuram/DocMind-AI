"use client";

import { useState, type ReactNode } from "react";
import { MessageSquare, FileText, Activity } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export type TabId = "chat" | "documents" | "observability";

const TABS: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "documents", label: "Documents", icon: FileText },
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
  const [active, setActive] = useState<TabId>("chat");

  const content = active === "chat" ? chat : active === "documents" ? documents : observability;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">DocMind AI</span>
          {statusDot}
        </div>
        <div className="flex flex-1 justify-center">{providerSwitcher}</div>
        <nav className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                active === id
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--foreground)] hover:bg-[var(--border)]/40"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>
        <ThemeToggle />
      </header>
      <main className="flex-1 overflow-hidden">{content}</main>
    </div>
  );
}
