const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface Citation {
  document_id: string;
  filename: string;
  chunk_index: number;
  page_number: number | null;
  score: number;
}

export interface DocumentOut {
  id: string;
  filename: string;
  source_type: "static" | "upload";
  status: "processing" | "indexed" | "failed";
  status_detail: string | null;
  chunk_count: number;
  size_bytes: number;
  created_at: string;
  indexed_at: string | null;
}

export interface ChatMessageOut {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  chunks_retrieved: number | null;
  top_score: number | null;
  status: "ok" | "low_confidence" | "error";
  created_at: string;
}

export interface HealthOut {
  status: string;
  gemini_configured: boolean;
  chroma_document_count: number;
  sqlite_ok: boolean;
  uptime_seconds: number;
}

export interface ObservabilityRow {
  id: string;
  query: string;
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  chunks_retrieved: number | null;
  top_score: number | null;
  status: string;
  created_at: string;
}

export interface ChatDoneEvent {
  citations: Citation[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  chunks_retrieved: number;
  top_score: number;
  status: "ok" | "low_confidence" | "error";
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
    request<{
      document_id: string;
      filename: string;
      chunk_index: number;
      page_number: number | null;
      text: string;
    }>(`/api/documents/${documentId}/chunks/${chunkIndex}`),

  getHistory: () => request<ChatMessageOut[]>("/api/chat/history"),

  clearHistory: () => request<void>("/api/chat/history", { method: "DELETE" }),

  getObservabilityRequests: () => request<ObservabilityRow[]>("/api/observability/requests"),

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
