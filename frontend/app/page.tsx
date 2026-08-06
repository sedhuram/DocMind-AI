import { TabShell } from "@/components/TabShell";
import { ChatTab } from "@/components/chat/ChatTab";

export default function Home() {
  return (
    <TabShell
      statusDot={<span className="h-2 w-2 rounded-full bg-slate-400" />}
      chat={<ChatTab />}
      documents={<div className="p-6">Documents tab coming in Task 18</div>}
      observability={<div className="p-6">Observability tab coming in Task 19</div>}
    />
  );
}
