"use client";

import { useEffect, useState } from "react";
import { Trash2, FileText, FileWarning, CheckCircle2, Loader2, X } from "lucide-react";
import { apiClient, type DocumentOut } from "@/lib/api-client";
import { UploadDropzone } from "@/components/documents/UploadDropzone";
import { useChat } from "@/lib/chat-context";
import { DocumentPreviewModal } from "@/components/documents/DocumentPreviewModal";

const STATUS_ICON: Record<DocumentOut["status"], typeof CheckCircle2> = {
  indexed: CheckCircle2,
  processing: Loader2,
  failed: FileWarning,
};

export function DocumentsTab() {
  const [documents, setDocuments] = useState<DocumentOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentOut | null>(null);

  const { selectedDocumentIds, setSelectedDocumentIds } = useChat();

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

  useEffect(() => {
    const handleRefresh = () => {
      refresh();
    };
    window.addEventListener("refreshDocuments", handleRefresh);
    return () => window.removeEventListener("refreshDocuments", handleRefresh);
  }, []);

  const toggleDocSelection = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedDocumentIds.includes(docId)) {
      setSelectedDocumentIds(selectedDocumentIds.filter((id) => id !== docId));
    } else {
      setSelectedDocumentIds([...selectedDocumentIds, docId]);
    }
  };

  async function handleFiles(files: File[]) {
    if (isBusy || files.length === 0) return;
    setIsBusy(true);
    setError(null);
    try {
      if (documents.length + files.length > 10) {
        throw new Error(`Uploading files would exceed the limit of 10 documents (currently: ${documents.length}/10).`);
      }

      for (const file of files) {
        if (file.size > 3 * 1024 * 1024) {
          throw new Error(`"${file.name}" exceeds the 3MB size limit.`);
        }
        await apiClient.uploadDocument(file);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await apiClient.deleteDocument(id);
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setIsBusy(false);
    }
  }

  const limitReached = documents.length >= 10;

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--border)]/70 pb-2.5 shrink-0">
        <div className="flex flex-col">
          <h2 className="text-xs font-bold text-[var(--foreground)]">Documents</h2>
          <p className="text-[9px] text-[var(--foreground)]/50 font-medium">Index & select files for RAG context</p>
        </div>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${limitReached ? "bg-amber-500/15 text-amber-600" : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"}`}>
          {documents.length} / 10
        </span>
      </div>

      <div className="shrink-0 mb-3">
        <UploadDropzone onFiles={handleFiles} disabled={isBusy} limitReached={limitReached} />
      </div>

      {isBusy && (
        <div className="shrink-0 mb-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xs animate-pulse">
          <Loader2 className="animate-spin text-[var(--accent)] shrink-0" size={14} />
          <div className="flex flex-col">
            <span className="text-[11px] font-bold leading-tight">Processing document...</span>
            <span className="text-[9px] text-[var(--foreground)]/50 mt-0.5 leading-tight">Parsing, chunking and embedding</span>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 mb-3 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="p-0.5 hover:opacity-75">
            <X size={12} />
          </button>
        </div>
      )}

      {loadError && (
        <div className="shrink-0 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          {loadError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin">
        {documents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[var(--foreground)]/40">
            <FileText size={24} className="mb-2 opacity-50" />
            <p className="text-xs font-semibold">No documents indexed</p>
            <p className="text-[9px] mt-0.5 text-[var(--foreground)]/40">Upload files above to start context querying.</p>
          </div>
        ) : (
          documents.map((doc) => {
            const StatusIcon = STATUS_ICON[doc.status];
            const isSelected = selectedDocumentIds.length === 0 || selectedDocumentIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                className={`relative rounded-lg border p-2.5 shadow-xs transition-all duration-150 group cursor-pointer ${
                  isSelected
                    ? "border-[var(--accent)]/50 bg-[var(--surface)] hover:bg-[var(--accent)]/5"
                    : "border-[var(--border)]/50 bg-[var(--surface)]/50 opacity-60 hover:opacity-100"
                }`}
                onClick={() => setPreviewDoc(doc)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleDocSelection(doc.id, e as any)}
                      onClick={(e) => e.stopPropagation()}
                      title="Include this document in chat RAG query context"
                      className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-0 cursor-pointer h-3.5 w-3.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1 pr-2">
                      <h4 className="text-[11px] font-bold text-[var(--foreground)] truncate group-hover:text-[var(--accent)] transition-colors" title={doc.filename}>
                        {doc.filename}
                      </h4>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="rounded bg-[var(--border)] px-1 py-0.5 text-[8px] font-bold text-[var(--foreground)]/50 uppercase">
                          {doc.source_type}
                        </span>
                        <span className={`inline-flex items-center gap-0.5 text-[8px] font-bold ${
                          doc.status === "failed" ? "text-red-500" : doc.status === "processing" ? "text-amber-500" : "text-emerald-500"
                        }`}>
                          <StatusIcon size={8} className={doc.status === "processing" ? "animate-spin" : ""} />
                          {doc.status}
                        </span>
                      </div>
                      <p className="text-[8px] text-[var(--foreground)]/45 mt-1 font-medium">
                        {(doc.size_bytes / 1024).toFixed(1)} KB · {doc.chunk_count} chunks
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center justify-center">
                    {doc.source_type === "upload" ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(doc.id);
                        }}
                        disabled={isBusy}
                        aria-label="Delete"
                        className="text-[var(--foreground)]/45 hover:text-red-500 transition-colors disabled:opacity-40 p-1 rounded hover:bg-[var(--border)]/20 cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : (
                      <span title="Static document (locked)" className="text-[9px] text-[var(--foreground)]/30 select-none mr-1.5">
                        🔒
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {previewDoc && <DocumentPreviewModal document={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </div>
  );
}
