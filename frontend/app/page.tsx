import { TabShell } from "@/components/TabShell";

export default function Home() {
  return (
    <TabShell
      statusDot={<span className="h-2 w-2 rounded-full bg-slate-400" />}
      chat={<div className="p-6">Chat tab coming in Task 17</div>}
      documents={<div className="p-6">Documents tab coming in Task 18</div>}
      observability={<div className="p-6">Observability tab coming in Task 19</div>}
    />
  );
}
