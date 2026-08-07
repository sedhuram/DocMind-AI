"use client";

import { useEffect, useState } from "react";
import { ChatProvider } from "@/lib/chat-context";
import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";
import { DocumentsTab } from "@/components/documents/DocumentsTab";
import { ObservabilityTab } from "@/components/observability/ObservabilityTab";
import { StatusDot } from "@/components/StatusDot";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";
import { LandingPage } from "@/components/landing/LandingPage";

export default function Home() {
  const [view, setView] = useState<"landing" | "workspace">("landing");

  if (view === "landing") {
    return <LandingPage onLaunch={() => setView("workspace")} />;
  }

  return (
    <ChatProvider>
      <TabShell
        statusDot={<StatusDot />}
        providerSwitcher={<ProviderSwitcher />}
        chat={<ChatTab />}
        documents={<DocumentsTab />}
        observability={<ObservabilityTab />}
        onOpenLanding={() => setView("landing")}
      />
    </ChatProvider>
  );
}

