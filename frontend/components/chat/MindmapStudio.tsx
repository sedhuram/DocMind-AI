"use client";

import { useState, useRef, useEffect } from "react";
import { ZoomIn, ZoomOut, Download, Loader2, FileWarning } from "lucide-react";
import { useChat } from "@/lib/chat-context";

export function MindmapStudio() {
  const { activeMindmap, isMindmapLoading } = useChat();
  const [zoom, setZoom] = useState(1);
  const [activeTooltip, setActiveTooltip] = useState<{ title: string; desc: string | null; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom when mindmap changes
  useEffect(() => {
    setZoom(1);
    setActiveTooltip(null);
  }, [activeMindmap]);

  if (isMindmapLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[var(--foreground)]/60">
        <Loader2 className="animate-spin text-[var(--accent)] mb-3" size={28} />
        <h3 className="text-sm font-semibold">Generating AI Mindmap</h3>
        <p className="text-xs text-[var(--foreground)]/50 mt-1 leading-relaxed px-4">
          Synthesizing core concepts and relationships from your indexed sources...
        </p>
      </div>
    );
  }

  if (!activeMindmap) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[var(--foreground)]/40">
        <span className="text-3xl mb-3">🗺️</span>
        <h3 className="text-sm font-semibold">Mindmap Studio</h3>
        <p className="text-xs text-[var(--foreground)]/50 mt-1 leading-relaxed px-4">
          Click the <strong className="text-[var(--accent)]">mindmap</strong> button on any user question in your chat to extract and map concepts visually.
        </p>
      </div>
    );
  }

  const nodesCount = activeMindmap.children?.length || 0;
  // Dynamic height based on node count to prevent overlapping
  const mapHeight = Math.max(360, nodesCount * 76 + 60);

  // Position coordinates:
  // Central node: x = 20, width = 160, height = 48. Right edge x = 180, cy = height / 2
  // Sub-nodes: x = 260, width = 180, height = 36. Left edge x = 260, cy_i = padding + i * spacing
  const centralNodeWidth = 160;
  const centralNodeHeight = 52;
  const centralNodeX = 15;
  const centralNodeY = mapHeight / 2 - centralNodeHeight / 2;

  const subNodeWidth = 175;
  const subNodeHeight = 36;
  const subNodeX = 245;

  const paddingY = 40;
  const spacingY = nodesCount > 1 ? (mapHeight - paddingY * 2 - subNodeHeight) / (nodesCount - 1) : 0;

  const handleDownload = () => {
    if (!containerRef.current) return;
    
    // We convert the mindmap elements into a clean HTML/SVG printable document
    const title = activeMindmap.title;
    let exportHTML = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; }
            .title { font-size: 20px; font-weight: bold; margin-bottom: 20px; border-bottom: 1px solid #334155; padding-bottom: 10px; }
            .node { background: #1e293b; border: 1px solid #475569; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
            .node-title { font-weight: bold; font-size: 14px; color: #818cf8; }
            .node-desc { font-size: 12px; color: #94a3b8; margin-top: 4px; }
          </style>
        </head>
        <body>
          <div class="title">DocMind AI Mindmap: ${title}</div>
          <div style="margin-bottom: 20px;">Central Theme: <strong>${title}</strong></div>
          <h3>Key Branches:</h3>
    `;

    activeMindmap.children.forEach((child) => {
      exportHTML += `
        <div class="node">
          <div class="node-title">${child.title}</div>
          ${child.description ? `<div class="node-desc">${child.description}</div>` : ""}
        </div>
      `;
    });

    exportHTML += `</body></html>`;

    const blob = new Blob([exportHTML], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mindmap_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden relative" ref={containerRef}>
      {/* Mindmap Title Panel */}
      <div className="p-3.5 border-b border-[var(--border)] bg-gradient-to-r from-indigo-500/5 to-pink-500/5 shrink-0 flex items-center justify-between">
        <div className="flex-1 min-w-0 pr-2">
          <h3 className="text-xs font-bold text-[var(--foreground)] truncate">{activeMindmap.title}</h3>
          <p className="text-[9px] text-[var(--foreground)]/50 font-medium">Topic Map · {nodesCount} Branches</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
            className="p-1 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--border)]/30 text-[var(--foreground)]/70 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut size={12} />
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
            className="p-1 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--border)]/30 text-[var(--foreground)]/70 transition-colors"
            title="Zoom In"
          >
            <ZoomIn size={12} />
          </button>
          <button
            onClick={handleDownload}
            className="p-1 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--border)]/30 text-[var(--foreground)]/70 transition-colors"
            title="Download Mindmap Summary"
          >
            <Download size={12} />
          </button>
        </div>
      </div>

      {/* Main Pan Container */}
      <div className="flex-1 overflow-auto bg-[var(--surface)]/10 p-4 relative scrollbar-thin">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            height: `${mapHeight}px`,
            width: "440px",
            transition: "transform 0.15s ease-out",
          }}
          className="relative"
        >
          {/* SVG Curves Drawing Layer */}
          <svg className="absolute inset-0 pointer-events-none w-full h-full">
            {activeMindmap.children.map((child, index) => {
              const startX = centralNodeX + centralNodeWidth;
              const startY = centralNodeY + centralNodeHeight / 2;
              
              const endX = subNodeX;
              const endY = paddingY + index * spacingY + subNodeHeight / 2;

              // Cubic bezier control points: pull horizontal curves out
              const controlPointX1 = startX + 40;
              const controlPointY1 = startY;
              const controlPointX2 = endX - 40;
              const controlPointY2 = endY;

              return (
                <path
                  key={index}
                  d={`M ${startX},${startY} C ${controlPointX1},${controlPointY1} ${controlPointX2},${controlPointY2} ${endX},${endY}`}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="1.5"
                  strokeOpacity="0.4"
                  className="transition-all duration-300"
                />
              );
            })}
          </svg>

          {/* Central Root Node Card */}
          <div
            style={{
              left: `${centralNodeX}px`,
              top: `${centralNodeY}px`,
              width: `${centralNodeWidth}px`,
              height: `${centralNodeHeight}px`,
            }}
            className="absolute rounded-lg border border-[var(--accent)]/45 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 p-2.5 shadow-sm flex items-center justify-center text-center backdrop-blur-xs select-none"
          >
            <span className="text-[10px] font-extrabold text-[var(--foreground)] uppercase tracking-wide leading-tight line-clamp-3">
              {activeMindmap.title}
            </span>
          </div>

          {/* Branch Sub-Nodes Cards */}
          {activeMindmap.children.map((child, index) => {
            const nodeY = paddingY + index * spacingY;
            return (
              <div
                key={index}
                style={{
                  left: `${subNodeX}px`,
                  top: `${nodeY}px`,
                  width: `${subNodeWidth}px`,
                  height: `${subNodeHeight}px`,
                }}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  if (rect && containerRect) {
                    setActiveTooltip({
                      title: child.title,
                      desc: child.description,
                      x: rect.left - containerRect.left - 10,
                      y: rect.top - containerRect.top + subNodeHeight / 2,
                    });
                  }
                }}
                onMouseLeave={() => setActiveTooltip(null)}
                className="absolute rounded-md border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 shadow-xs p-2 flex items-center gap-1.5 transition-all duration-150 cursor-help"
              >
                <span className="text-[10px] shrink-0">⚡</span>
                <span className="text-[9.5px] font-bold text-[var(--foreground)]/80 truncate leading-snug">
                  {child.title}
                </span>
                <span className="text-[8px] text-[var(--foreground)]/40 ml-auto shrink-0 select-none">▶</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip Overlay */}
      {activeTooltip && activeTooltip.desc && (
        <div
          style={{
            left: `${Math.max(10, activeTooltip.x - 220)}px`,
            top: `${activeTooltip.y - 45}px`,
          }}
          className="absolute z-20 w-52 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-md animate-[slideIn_0.1s_ease-out] backdrop-blur-xs pointer-events-none"
        >
          <h4 className="text-[10px] font-bold text-[var(--accent)] mb-0.5">{activeTooltip.title}</h4>
          <p className="text-[9px] text-[var(--foreground)]/70 leading-relaxed font-medium">
            {activeTooltip.desc}
          </p>
        </div>
      )}
    </div>
  );
}
