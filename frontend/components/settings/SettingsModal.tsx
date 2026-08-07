"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  X,
  Save,
  Key,
  Cpu,
  Sliders,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Lock,
  ListFilter,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ShieldAlert,
} from "lucide-react";
import {
  apiClient,
  type FullConfigOut,
  type AuditLogOut,
  type FeatureFlagOut,
} from "@/lib/api-client";
import { useChat } from "@/lib/chat-context";

export function SettingsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"llm" | "rag" | "admin" | "roadmap">("llm");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userRole, setUserRole] = useState<string>("admin");

  // Admin authentication state
  const [adminPasscode, setAdminPasscode] = useState("");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminError, setAdminError] = useState("");

  // Audit Logs & Feature Flags state
  const [auditLogs, setAuditLogs] = useState<AuditLogOut[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlagOut[]>([]);

  const { addToast } = useChat();

  // Form states
  const [provider, setProvider] = useState<"gemini" | "ollama">("gemini");
  const [geminiKey, setGeminiKey] = useState("");
  const [generationModel, setGenerationModel] = useState("gemini-3.6-flash");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3.6:35b");
  const [topK, setTopK] = useState(5);
  const [chunkSize, setChunkSize] = useState(1000);
  const [chunkOverlap, setChunkOverlap] = useState(150);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.3);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const savedUser = localStorage.getItem("docmind_user");
      if (savedUser) {
        try {
          const u = JSON.parse(savedUser);
          setUserRole(u.role || "user");
          if (u.role !== "admin" && activeTab === "admin") {
            setActiveTab("llm");
          }
        } catch {
          setUserRole("admin");
        }
      } else {
        setUserRole("admin");
      }

      const cfg = await apiClient.getFullConfig();
      setProvider(cfg.active_llm_provider as any);
      setGenerationModel(cfg.generation_model);
      setOllamaUrl(cfg.ollama_base_url);
      setOllamaModel(cfg.ollama_model);
      setTopK(cfg.retrieval_top_k);
      setChunkSize(cfg.chunk_size);
      setChunkOverlap(cfg.chunk_overlap);
      setConfidenceThreshold(cfg.low_confidence_threshold);

      // Load feature flags
      const flags = await apiClient.getFeatureFlags();
      setFeatureFlags(flags);
    } catch (err) {
      console.error("Failed to fetch full config", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      loadConfig();
    };
    window.addEventListener("openSettingsModal", handleOpen);
    return () => window.removeEventListener("openSettingsModal", handleOpen);
  }, []);

  const handleUnlockAdmin = async () => {
    setAdminError("");
    try {
      const res = await apiClient.verifyAdminPasscode(adminPasscode);
      if (res.verified) {
        setIsAdminUnlocked(true);
        localStorage.setItem("docmind_admin_token", res.admin_token);
        const logs = await apiClient.getAuditLogs();
        setAuditLogs(logs);
        addToast("Admin Control Panel unlocked!", "success");
      }
    } catch {
      setAdminError("Invalid Admin Passcode. Please check key.");
    }
  };

  const handleToggleFlag = async (name: string, currentEnabled: boolean) => {
    try {
      const updated = await apiClient.toggleFeatureFlag(name, !currentEnabled);
      setFeatureFlags((prev) => prev.map((f) => (f.name === name ? updated : f)));
      addToast(`Feature "${name}" ${!currentEnabled ? "enabled" : "disabled"}`, "info");
    } catch {
      addToast("Failed to update feature flag.", "error");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.updateFullConfig({
        llm_provider: provider,
        gemini_api_key: geminiKey.trim() || undefined,
        generation_model: generationModel,
        ollama_base_url: ollamaUrl,
        ollama_model: ollamaModel,
        retrieval_top_k: Number(topK),
        chunk_size: Number(chunkSize),
        chunk_overlap: Number(chunkOverlap),
        low_confidence_threshold: Number(confidenceThreshold),
      });

      addToast("Backend environment hot-reloaded!", "success");
      setIsOpen(false);
      setGeminiKey("");
    } catch {
      addToast("Failed to update backend configuration.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-pink-500/10 shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="text-[var(--accent)]" size={18} />
            <div>
              <h2 className="text-sm font-bold text-[var(--foreground)]">Engine & Feature Control Panel</h2>
              <p className="text-[10px] text-[var(--foreground)]/50 font-medium">Configure LLM keys, RAG parameters, & Admin Controls</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-[var(--foreground)]/50 hover:text-[var(--foreground)] p-1 rounded-md transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[var(--border)] bg-[var(--surface)] px-4 gap-1 pt-2 shrink-0 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab("llm")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
              activeTab === "llm"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            <Cpu size={13} />
            LLM Provider & Keys
          </button>
          <button
            onClick={() => setActiveTab("rag")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
              activeTab === "rag"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            <Sliders size={13} />
            RAG Vector Engine
          </button>
          {userRole === "admin" && (
            <button
              onClick={() => setActiveTab("admin")}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
                activeTab === "admin"
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
              }`}
            >
              <ShieldCheck size={13} className="text-emerald-500" />
              Admin & Features
            </button>
          )}
          <button
            onClick={() => setActiveTab("roadmap")}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-all whitespace-nowrap ${
              activeTab === "roadmap"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--foreground)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            <Sparkles size={13} className="text-amber-500" />
            Coming Soon
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 scrollbar-thin">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-[var(--foreground)]/50">
              <Loader2 className="animate-spin text-[var(--accent)] mb-2" size={24} />
              <span className="text-xs font-semibold">Loading control panel...</span>
            </div>
          ) : activeTab === "llm" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[var(--foreground)] mb-1.5">Active LLM Provider</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setProvider("gemini")}
                    className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                      provider === "gemini"
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--foreground)]/70 hover:bg-[var(--border)]/20"
                    }`}
                  >
                    <span className="text-xs font-bold">Google Gemini</span>
                    {provider === "gemini" && <CheckCircle2 size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvider("ollama")}
                    className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                      provider === "ollama"
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--foreground)]/70 hover:bg-[var(--border)]/20"
                    }`}
                  >
                    <span className="text-xs font-bold">Local Ollama</span>
                    {provider === "ollama" && <CheckCircle2 size={14} />}
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-3">
                <h4 className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                  <Key size={13} className="text-amber-500" />
                  Gemini API Configuration
                </h4>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--foreground)]/70 mb-1">
                    API Key (leave blank to keep current)
                  </label>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--foreground)]/70 mb-1">
                    Generation Model
                  </label>
                  <select
                    value={generationModel}
                    onChange={(e) => setGenerationModel(e.target.value)}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)]"
                  >
                    <option value="gemini-3.6-flash">gemini-3.6-flash (Default Fast)</option>
                    <option value="gemini-1.5-pro">gemini-1.5-pro (High Reasoning)</option>
                    <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-3">
                <h4 className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                  <Cpu size={13} className="text-indigo-500" />
                  Ollama Local Configuration
                </h4>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--foreground)]/70 mb-1">
                    Ollama Base URL
                  </label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--foreground)]/70 mb-1">
                    Ollama Model Tag
                  </label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
              </div>
            </div>
          ) : activeTab === "rag" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--foreground)] mb-1">Retrieval Top-K Chunks</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={topK}
                    onChange={(e) => setTopK(Number(e.target.value))}
                    className="w-full bg-[var(--background)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--foreground)] mb-1">Low Confidence Threshold</label>
                  <input
                    type="number"
                    step={0.05}
                    min={0.0}
                    max={1.0}
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                    className="w-full bg-[var(--background)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[var(--foreground)] mb-1">Chunk Size (Chars)</label>
                  <input
                    type="number"
                    step={100}
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Number(e.target.value))}
                    className="w-full bg-[var(--background)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[var(--foreground)] mb-1">Chunk Overlap (Chars)</label>
                  <input
                    type="number"
                    step={25}
                    value={chunkOverlap}
                    onChange={(e) => setChunkOverlap(Number(e.target.value))}
                    className="w-full bg-[var(--background)] border border-[var(--border)] rounded px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)] text-[var(--foreground)] font-mono"
                  />
                </div>
              </div>
            </div>
          ) : activeTab === "admin" ? (
            <div className="space-y-4">
              {!isAdminUnlocked ? (
                <div className="p-6 border border-emerald-500/30 bg-emerald-500/5 rounded-xl text-center space-y-3">
                  <Lock className="mx-auto text-emerald-500" size={32} />
                  <h3 className="text-sm font-bold text-[var(--foreground)]">Admin Verification Required</h3>
                  <p className="text-xs text-[var(--foreground)]/60 max-w-sm mx-auto">
                    Enter the Admin Secret Passcode to unlock executive feature controls and audit accountability logs.
                  </p>
                  <div className="max-w-xs mx-auto flex gap-2 pt-2">
                    <input
                      type="password"
                      value={adminPasscode}
                      onChange={(e) => setAdminPasscode(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleUnlockAdmin()}
                      placeholder="DocMind#Admin2026!Secure"
                      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-1.5 text-xs font-mono outline-none focus:border-emerald-500 text-[var(--foreground)]"
                    />
                    <button
                      onClick={handleUnlockAdmin}
                      className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-bold hover:bg-emerald-600 transition-colors shrink-0"
                    >
                      Unlock
                    </button>
                  </div>
                  {adminError && <p className="text-xs text-red-500 font-medium">{adminError}</p>}
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Feature Controls */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider text-[var(--foreground)]/50">
                      Feature Control Switches
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {featureFlags.map((flag) => (
                        <div
                          key={flag.name}
                          className="p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] flex items-center justify-between"
                        >
                          <div>
                            <span className="text-xs font-bold text-[var(--foreground)] font-mono block">{flag.name}</span>
                            <span className="text-[9.5px] text-[var(--foreground)]/50 leading-tight block mt-0.5">{flag.description}</span>
                          </div>
                          <button
                            onClick={() => handleToggleFlag(flag.name, flag.enabled)}
                            className="text-[var(--accent)] hover:opacity-80 transition-opacity ml-2 shrink-0 cursor-pointer"
                          >
                            {flag.enabled ? <ToggleRight size={24} className="text-emerald-500" /> : <ToggleLeft size={24} className="text-gray-400" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Audit Logs Table */}
                  <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                    <h4 className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider text-[var(--foreground)]/50 flex items-center justify-between">
                      <span>User Activity & Security Audit Log</span>
                      <span className="text-[9px] font-mono text-[var(--foreground)]/40">{auditLogs.length} Records</span>
                    </h4>
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] overflow-hidden max-h-56 overflow-y-auto scrollbar-thin">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[9.5px] font-bold text-[var(--foreground)]/60 uppercase">
                            <th className="p-2">Action</th>
                            <th className="p-2">User Email</th>
                            <th className="p-2">Details</th>
                            <th className="p-2">IP</th>
                            <th className="p-2">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]/40 text-[10px]">
                          {auditLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-[var(--surface)]/50 font-mono">
                              <td className="p-2">
                                <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold ${
                                  log.action === "SECURITY_ALERT"
                                    ? "bg-red-500/10 text-red-500"
                                    : log.action === "LOGIN"
                                      ? "bg-emerald-500/10 text-emerald-500"
                                      : "bg-indigo-500/10 text-indigo-500"
                                }`}>
                                  {log.action}
                                </span>
                              </td>
                              <td className="p-2 font-semibold text-[var(--foreground)]">{log.user_email}</td>
                              <td className="p-2 text-[var(--foreground)]/70 max-w-[160px] truncate">{log.details}</td>
                              <td className="p-2 text-[var(--foreground)]/50">{log.ip_address}</td>
                              <td className="p-2 text-[var(--foreground)]/40">{new Date(log.timestamp).toLocaleTimeString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
                <Sparkles className="text-amber-500 shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="text-xs font-bold text-[var(--foreground)]">Product Roadmap & Upcoming Capabilities</h3>
                  <p className="text-[10px] text-[var(--foreground)]/60 mt-0.5 leading-relaxed">
                    Preview features currently in active design and engineering for future releases of DocMind AI.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--foreground)]">🎙️ Voice AI Assistant</span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 text-[8.5px] font-bold uppercase">In Progress</span>
                  </div>
                  <p className="text-[10px] text-[var(--foreground)]/60 leading-normal">
                    Real-time speech-to-text input and natural audio voice responses for hands-free context querying.
                  </p>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--foreground)]">🖼️ Multimodal Diagram Vision</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[8.5px] font-bold uppercase">Planned</span>
                  </div>
                  <p className="text-[10px] text-[var(--foreground)]/60 leading-normal">
                    OCR, chart extraction, and architecture visual analysis directly from uploaded images and PDFs.
                  </p>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--foreground)]">🔍 Real-Time Web Search</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[8.5px] font-bold uppercase">Planned</span>
                  </div>
                  <p className="text-[10px] text-[var(--foreground)]/60 leading-normal">
                    Hybrid RAG pipeline supplementing local document chunks with live web search results.
                  </p>
                </div>

                <div className="p-3.5 rounded-lg border border-[var(--border)] bg-[var(--background)] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--foreground)]">📄 Doc Diff Engine</span>
                    <span className="px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-500 text-[8.5px] font-bold uppercase">Planned</span>
                  </div>
                  <p className="text-[10px] text-[var(--foreground)]/60 leading-normal">
                    Side-by-side automated document comparison, clause analysis, and structural variance tracking.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[var(--border)] bg-[var(--surface)] flex justify-end gap-2 shrink-0">
          <button
            onClick={() => setIsOpen(false)}
            className="px-4 py-1.5 text-xs font-bold rounded-md border border-[var(--border)] hover:bg-[var(--border)]/30 text-[var(--foreground)]/70 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-md bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="animate-spin" size={13} /> : <Save size={13} />}
            <span>Save & Hot-Reload Engine</span>
          </button>
        </div>
      </div>
    </div>
  );
}
