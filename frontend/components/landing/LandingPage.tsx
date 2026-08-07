"use client";

import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet,
  Network,
  Cpu,
  Activity,
  Layers,
  Lock,
  Bot,
  Zap,
} from "lucide-react";

export function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans overflow-x-hidden selection:bg-[var(--accent)] selection:text-white">
      {/* Top Header Navigation */}
      <header className="w-full max-w-7xl mx-auto px-6 py-4 flex items-center justify-between border-b border-[var(--border)]/60">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-pink-600 to-amber-500 flex items-center justify-center text-white font-black shadow-md">
            <Bot size={20} />
          </div>
          <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-pink-400">
            DocMind AI
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            <Zap size={12} />
            Engine v2.4 Live
          </span>
          <button
            onClick={onLaunch}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-bold shadow-lg hover:bg-[var(--accent)]/90 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
          >
            <span>Launch Workspace</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-16 pb-20 px-6 max-w-5xl mx-auto text-center flex flex-col items-center">
        {/* Glow backdrop */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-gradient-to-r from-indigo-500/20 via-pink-500/20 to-amber-500/20 blur-3xl rounded-full pointer-events-none -z-10" />

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)] text-xs font-extrabold mb-6 animate-[fadeIn_0.3s_ease-out]">
          <Sparkles size={14} />
          <span>Next-Gen RAG & Document Intelligence</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-[var(--foreground)] leading-[1.15] max-w-3xl">
          Instant Context Intelligence for Every{" "}
          <span className="bg-gradient-to-r from-indigo-600 via-pink-600 to-amber-500 bg-clip-text text-transparent dark:from-indigo-400 dark:via-pink-400 dark:to-amber-400">
            Document & Spreadsheet
          </span>
        </h1>

        <p className="mt-6 text-sm sm:text-base text-[var(--foreground)]/70 max-w-2xl leading-relaxed font-normal">
          Upload PDFs, Word docs, CSVs, and Excel files. Query with strict guardrails, zero hallucinations, interactive citation badges, and visual AI mindmaps.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={onLaunch}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[var(--accent)] text-white text-sm font-bold shadow-xl hover:bg-[var(--accent)]/90 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
          >
            <span>Open DocMind Workspace</span>
            <ArrowRight size={16} />
          </button>
        </div>

        {/* Live Preview Specs Pill Bar */}
        <div className="mt-12 w-full max-w-3xl grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-md shadow-lg text-left">
          <div className="p-2.5">
            <span className="text-[10px] font-bold text-[var(--foreground)]/50 uppercase block">RAG Engine</span>
            <span className="text-xs font-black text-[var(--foreground)] mt-0.5 block">ChromaDB + Cosine</span>
          </div>
          <div className="p-2.5">
            <span className="text-[10px] font-bold text-[var(--foreground)]/50 uppercase block">LLM Models</span>
            <span className="text-xs font-black text-[var(--foreground)] mt-0.5 block">Gemini 3.6 & Ollama</span>
          </div>
          <div className="p-2.5">
            <span className="text-[10px] font-bold text-[var(--foreground)]/50 uppercase block">File Formats</span>
            <span className="text-xs font-black text-[var(--foreground)] mt-0.5 block">PDF, DOCX, CSV, XLSX</span>
          </div>
          <div className="p-2.5">
            <span className="text-[10px] font-bold text-[var(--foreground)]/50 uppercase block">Security</span>
            <span className="text-xs font-black text-emerald-500 mt-0.5 block">Injection Firewall</span>
          </div>
        </div>
      </section>

      {/* Feature Capabilities Grid */}
      <section className="w-full max-w-6xl mx-auto px-6 py-12 border-t border-[var(--border)]/50">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-black text-[var(--foreground)]">Engineered for Technical Excellence</h2>
          <p className="text-xs text-[var(--foreground)]/60 mt-1">Full control over context window, vector search parameters, and security policies</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--accent)]/40 transition-all">
            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-4">
              <FileSpreadsheet size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Spreadsheet & Document RAG</h3>
            <p className="text-xs text-[var(--foreground)]/60 mt-1.5 leading-relaxed">
              Parse Excel worksheets and CSV rows into structured markdown blocks. Select specific document subsets per chat session.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--accent)]/40 transition-all">
            <div className="h-10 w-10 rounded-lg bg-pink-500/10 text-pink-500 flex items-center justify-center mb-4">
              <Network size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">AI Mindmap Concept Studio</h3>
            <p className="text-xs text-[var(--foreground)]/60 mt-1.5 leading-relaxed">
              Generate interactive visual concept trees with SVG cubic bezier connections, node zoom controls, and HTML summary downloads.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--accent)]/40 transition-all">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-4">
              <ShieldCheck size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Prompt Injection Firewall & PII</h3>
            <p className="text-xs text-[var(--foreground)]/60 mt-1.5 leading-relaxed">
              Automatic regex jailbreak detection and PII scrubbing (SSNs, credit card numbers, phones) before external API generation.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--accent)]/40 transition-all">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center mb-4">
              <Cpu size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Hot-Reload Engine Control Panel</h3>
            <p className="text-xs text-[var(--foreground)]/60 mt-1.5 leading-relaxed">
              Update Gemini API keys, local Ollama URLs, top-K retrieval counts, and chunk sizes dynamically with instant backend hot-reloading.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--accent)]/40 transition-all">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center mb-4">
              <Activity size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Observability & Audit Logs</h3>
            <p className="text-xs text-[var(--foreground)]/60 mt-1.5 leading-relaxed">
              Monitor latency, token counts, and vector similarity scores in real-time. SQLite audit logging tracks all user actions.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--accent)]/40 transition-all">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center mb-4">
              <Layers size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--foreground)]">Non-Blocking Multi-Session Chat</h3>
            <p className="text-xs text-[var(--foreground)]/60 mt-1.5 leading-relaxed">
              Switch between concurrent chat sessions seamlessly while in-progress responses stream smoothly in the background.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto w-full border-t border-[var(--border)]/60 py-6 text-center text-xs text-[var(--foreground)]/50">
        DocMind AI &copy; 2026 • Autonomous RAG Document Intelligence System
      </footer>
    </div>
  );
}
