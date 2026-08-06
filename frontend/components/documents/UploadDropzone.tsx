"use client";

import { useCallback, useState } from "react";
import { UploadCloud } from "lucide-react";

export function UploadDropzone({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      onFiles(Array.from(e.dataTransfer.files));
    },
    [onFiles, disabled]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        isDragging ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)]"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <UploadCloud size={28} className="mb-2 text-[var(--foreground)]/50" />
      <p className="text-sm font-medium">Drag and drop files here</p>
      <p className="text-xs text-[var(--foreground)]/50">PDF, TXT, MD, DOCX — or</p>
      <label className="mt-2 cursor-pointer rounded-md border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--border)]/30">
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
    </div>
  );
}
