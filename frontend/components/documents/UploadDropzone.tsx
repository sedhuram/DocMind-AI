"use client";

import { useCallback, useState } from "react";
import { UploadCloud } from "lucide-react";

export function UploadDropzone({
  onFiles,
  disabled,
  limitReached,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  limitReached?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled || limitReached) return;
      onFiles(Array.from(e.dataTransfer.files));
    },
    [onFiles, disabled, limitReached]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !limitReached) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        isDragging ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)]"
      } ${disabled || limitReached ? "opacity-60 bg-[var(--border)]/5" : ""}`}
    >
      <UploadCloud size={28} className={`mb-2 ${limitReached ? "text-amber-500" : "text-[var(--foreground)]/50"}`} />
      {limitReached ? (
        <>
          <p className="text-sm font-semibold text-amber-500">Document Limit Reached</p>
          <p className="text-xs text-[var(--foreground)]/60 mt-1">Maximum of 10 indexed documents has been reached. Please delete some files to upload more.</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">Drag and drop files here</p>
          <p className="text-xs text-[var(--foreground)]/55 mt-0.5">PDF, TXT, MD, DOCX (Max 3MB per file)</p>
          <label className={`mt-3 cursor-pointer rounded-md border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--border)]/30 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
            Browse files
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.docx"
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                if (e.target.files) onFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}
