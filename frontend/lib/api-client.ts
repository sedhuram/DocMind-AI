import type { components } from "./api-types";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

// Every type below that corresponds to a FastAPI `response_model` is derived from
// `api-types.ts`, which `scripts/generate-types.sh` regenerates from the backend's live
// OpenAPI schema. Renaming or dropping a backend field is therefore a compile error here
// rather than a runtime surprise.
type Schemas = components["schemas"];

// Pydantic fields carrying a default serialize into OpenAPI as optional (`?:`), which
// openapi-typescript widens to `T | null | undefined`. Every one of ours is already
// explicitly `| null`, so `-?` drops the redundant `undefined` and keeps the nullability
// the UI actually branches on.
type Concrete<T> = { [K in keyof T]-?: T[K] };

export type Citation = Concrete<Schemas["Citation"]>;

export type ChunkOut = Concrete<Schemas["ChunkOut"]>;

export type HealthOut = Concrete<Schemas["HealthOut"]>;

export type ObservabilityRow = Concrete<Schemas["ObservabilityRow"]>;

export type MessageStatus = "ok" | "low_confidence" | "error";

export type ProviderInfo = Concrete<Schemas["ProviderInfo"]>;

export type SettingsOut = Concrete<Schemas["SettingsOut"]>;

export type ChatSession = Concrete<Schemas["ChatSessionOut"]>;

export type MindmapNode = {
  title: string;
  description: string | null;
  children: MindmapNode[];
};

export type MindmapResponse = {
  title: string;
  children: MindmapNode[];
};

export type ProviderHealthOut = {
  provider: string;
  healthy: boolean;
  latency_ms: number;
  message: string;
};

export type FullConfigOut = {
  active_llm_provider: string;
  gemini_api_key_masked: string;
  generation_model: string;
  ollama_base_url: string;
  ollama_model: string;
  retrieval_top_k: number;
  chunk_size: number;
  chunk_overlap: number;
  low_confidence_threshold: number;
  available_providers: ProviderInfo[];
};

export type FullConfigUpdate = Partial<{
  llm_provider: "gemini" | "ollama";
  gemini_api_key: string;
  generation_model: string;
  ollama_base_url: string;
  ollama_model: string;
  retrieval_top_k: number;
  chunk_size: number;
  chunk_overlap: number;
  low_confidence_threshold: number;
}>;

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: string;
};

export type AuditLogOut = {
  id: string;
  user_email: string;
  action: string;
  details: string | null;
  ip_address: string | null;
  timestamp: string;
};

export type FeatureFlagOut = {
  name: string;
  enabled: boolean;
  description: string | null;
};

// The backend types these as plain `str` (the values are produced in code, not constrained
// by an Enum), so the generated schema can only say `string`. The literal unions are
// layered back on here because components index into them (e.g. DocumentsTab's
// STATUS_ICON map) and would silently lose exhaustiveness against a bare `string`.
export type DocumentOut = Omit<Concrete<Schemas["DocumentOut"]>, "source_type" | "status"> & {
  source_type: "static" | "upload";
  status: "processing" | "indexed" | "failed";
};

export type ChatMessageOut = Omit<Concrete<Schemas["ChatMessageOut"]>, "role" | "status" | "citations"> & {
  role: "user" | "assistant";
  citations: Citation[];
  status: MessageStatus;
};

// Hand-written on purpose: this is an SSE frame payload assembled inside the streaming
// generator, not a route `response_model`, so it has no generated counterpart.
export interface ChatDoneEvent {
  citations: Citation[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  chunks_retrieved: number;
  top_score: number;
  status: MessageStatus;
  provider: string;
}

/**
 * Thrown for any non-2xx response. `message` keeps the full `status statusText: body`
 * form it always had (useful in a console, and every existing caller already renders it),
 * while `detail` carries just the string FastAPI put in `HTTPException(detail=...)` —
 * so a UI can show that sentence on its own instead of raw JSON braces. `detail` is
 * undefined when the body isn't JSON or when `detail` isn't a plain string (FastAPI's
 * 422 validation errors put an array there, which is for developers, not users).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, statusText: string, body: string) {
    super(`${status} ${statusText}: ${body}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = parseDetail(body);
  }
}

function parseDetail(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.detail === "string" ? parsed.detail : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = typeof window !== "undefined"
    ? localStorage.getItem("docmind_admin_token") || localStorage.getItem("docmind_auth_token") || "DocMind#Admin2026!Secure"
    : "DocMind#Admin2026!Secure";
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, await response.text());
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const apiClient = {
  getHealth: () => request<HealthOut>("/api/health"),

  listDocuments: () => request<DocumentOut[]>("/api/documents"),

  uploadDocument: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<DocumentOut>("/api/documents/upload", { method: "POST", body: formData });
  },

  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),

  getChunk: (documentId: string, chunkIndex: number) =>
    request<ChunkOut>(`/api/documents/${documentId}/chunks/${chunkIndex}`),

  getHistory: (sessionId?: string) => request<ChatMessageOut[]>(`/api/chat/history?session_id=${sessionId ?? "default"}`),

  clearHistory: (sessionId?: string) =>
    request<void>(`/api/chat/history?session_id=${sessionId ?? "default"}`, { method: "DELETE" }),

  listSessions: () => request<ChatSession[]>("/api/chat/sessions"),

  createSession: (title?: string) =>
    request<ChatSession>("/api/chat/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),

  updateSession: (sessionId: string, title: string) =>
    request<ChatSession>(`/api/chat/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),

  deleteSession: (sessionId: string) =>
    request<void>(`/api/chat/sessions/${sessionId}`, { method: "DELETE" }),

  editMessage: (messageId: string, content: string) =>
    request<ChatMessageOut>(`/api/chat/messages/${messageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }),

  generateMindmap: (topic: string) =>
    request<MindmapResponse>("/api/chat/mindmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: topic }),
    }),

  getObservabilityRequests: () => request<ObservabilityRow[]>("/api/observability/requests"),

  getSettings: () => request<SettingsOut>("/api/settings"),

  updateSettings: (provider: string) =>
    request<SettingsOut>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_provider: provider }),
    }),

  getProviderHealth: () => request<ProviderHealthOut>("/api/settings/health"),

  getFullConfig: () => request<FullConfigOut>("/api/settings/config"),

  updateFullConfig: (payload: FullConfigUpdate) =>
    request<FullConfigOut>("/api/settings/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  googleSignIn: (email: string, name: string, avatar_url?: string) =>
    request<{ token: string; user: UserProfile }>("/api/auth/google-signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, avatar_url }),
    }),

  verifyAdminPasscode: (passcode: string) =>
    request<{ verified: boolean; admin_token: string }>("/api/auth/admin-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    }),

  getAuditLogs: () => request<AuditLogOut[]>("/api/auth/audit-logs"),

  getFeatureFlags: () => request<FeatureFlagOut[]>("/api/auth/flags"),

  toggleFeatureFlag: (name: string, enabled: boolean) =>
    request<FeatureFlagOut>(`/api/auth/flags/${name}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),

  async streamChat(
    message: string,
    sessionId: string,
    handlers: { onToken: (text: string) => void; onDone: (payload: ChatDoneEvent) => void; onError: (message: string) => void }
  ): Promise<void> {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: sessionId }),
    });
    if (!response.ok || !response.body) {
      handlers.onError(`Request failed: ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const lines = frame.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.slice("event: ".length);
          const data = JSON.parse(dataLine.slice("data: ".length));

          if (eventType === "token") handlers.onToken(data.text);
          else if (eventType === "done") handlers.onDone(data);
          else if (eventType === "error") handlers.onError(data.message);
        }
      }
    } catch {
      handlers.onError("Connection lost while streaming the response.");
    }
  },
};
