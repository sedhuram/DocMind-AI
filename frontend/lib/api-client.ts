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

export type ObservabilityRow = Concrete<Schemas["ObservabilityRow"]> & {
  provider: string | null;
};

export type MessageStatus = "ok" | "low_confidence" | "error";

export type ProviderInfo = Concrete<Schemas["ProviderInfo"]>;

export type SettingsOut = Concrete<Schemas["SettingsOut"]>;

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
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

  getHistory: () => request<ChatMessageOut[]>("/api/chat/history"),

  clearHistory: () => request<void>("/api/chat/history", { method: "DELETE" }),

  getObservabilityRequests: () => request<ObservabilityRow[]>("/api/observability/requests"),

  getSettings: () => request<SettingsOut>("/api/settings"),

  updateSettings: (provider: string) =>
    request<SettingsOut>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_provider: provider }),
    }),

  async streamChat(
    message: string,
    handlers: { onToken: (text: string) => void; onDone: (payload: ChatDoneEvent) => void; onError: (message: string) => void }
  ): Promise<void> {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
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
