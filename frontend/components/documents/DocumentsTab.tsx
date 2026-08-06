"use client";

import { useEffect, useState } from "react";
import { Trash2, FileText, FileWarning, CheckCircle2, Loader2, X } from "lucide-react";
import { apiClient, type DocumentOut } from "@/lib/api-client";
import { UploadDropzone } from "@/components/documents/UploadDropzone";

const STATUS_ICON: Record<DocumentOut["status"], typeof CheckCircle2> = {
  indexed: CheckCircle2,
  processing: Loader2,
  failed: FileWarning,
};

export function DocumentsTab() {
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function refresh() {
    try {
      const docs = await apiClient.listDocuments();
      setDocuments(docs);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't reach the backend. Is it running?");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFiles(files: File[]) {
    if (isUploading || files.length === 0) return;
    setIsUploading(true);
    setError(null);
    for (const file of files) {
      try {
        await apiClient.uploadDocument(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
      }
    }
    await refresh();
    setIsUploading(false);
  }

  async function handleDelete(id: string) {
    try {
      await apiClient.deleteDocument(id);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <UploadDropzone onFiles={handleFiles} disabled={isUploading} />
        {isUploading && <p className="mt-2 text-sm text-[var(--foreground)]/60">Uploading…</p>}
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        {loadError && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
            <span>{loadError}</span>
            <button
              onClick={() => setLoadError(null)}
              aria-label="Dismiss error"
              className="shrink-0 text-red-500/70 hover:text-red-500"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {documents.length === 0 ? (
          <div className="mt-8 text-center text-[var(--foreground)]/50">
            <FileText className="mx-auto mb-2" size={28} />
            <p>No documents indexed yet. Upload one above, or drop files into <code>backend/data/static/</code> and restart.</p>
          </div>
        ) : (
          <table className="mt-6 w-full text-sm">
            <thead className="text-left text-[var(--foreground)]/60">
              <tr className="border-b border-[var(--border)]">
                <th className="py-2">Filename</th>
                <th>Source</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const StatusIcon = STATUS_ICON[doc.status];
                return (
                  <tr key={doc.id} className="border-b border-[var(--border)]/50">
                    <td className="py-2">{doc.filename}</td>
                    <td>
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                        {doc.source_type}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`flex items-center gap-1 text-xs ${
                          doc.status === "failed" ? "text-red-500" : doc.status === "processing" ? "text-amber-500" : "text-emerald-500"
                        }`}
                        title={doc.status_detail ?? undefined}
                      >
                        <StatusIcon size={12} className={doc.status === "processing" ? "animate-spin" : ""} />
                        {doc.status}
                      </span>
                    </td>
                    <td>{doc.chunk_count}</td>
                    <td>{(doc.size_bytes / 1024).toFixed(1)} KB</td>
                    <td>
                      {doc.source_type === "upload" ? (
                        <button onClick={() => handleDelete(doc.id)} aria-label="Delete" className="text-[var(--foreground)]/50 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <span title="Static documents are managed via data/static/ and re-indexed on restart" className="text-xs text-[var(--foreground)]/30">
                          locked
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
