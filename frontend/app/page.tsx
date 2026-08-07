import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";
import { DocumentsTab } from "@/components/documents/DocumentsTab";
import { ObservabilityTab } from "@/components/observability/ObservabilityTab";
import { StatusDot } from "@/components/StatusDot";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";

export default function Home() {
  return (
    <TabShell
      statusDot={<StatusDot />}
      providerSwitcher={<ProviderSwitcher />}
      chat={<ChatTab />}
      documents={<DocumentsTab />}
      observability={<ObservabilityTab />}
    />
  );
}
