"use client";

import { useEffect, useState } from "react";
import { ChatProvider } from "@/lib/chat-context";
import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";
import { DocumentsTab } from "@/components/documents/DocumentsTab";
import { ObservabilityTab } from "@/components/observability/ObservabilityTab";
import { StatusDot } from "@/components/StatusDot";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent)] border-t-transparent" />
          <span className="text-xs font-bold font-mono text-[var(--foreground)]/70">Loading DocMind AI Workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <ChatProvider>
      <TabShell
        statusDot={<StatusDot />}
        providerSwitcher={<ProviderSwitcher />}
        chat={<ChatTab />}
        documents={<DocumentsTab />}
        observability={<ObservabilityTab />}
      />
    </ChatProvider>
  );
}

