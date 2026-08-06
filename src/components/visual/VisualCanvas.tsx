import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import katex from "katex";
import type { VisualElement } from "../../../server/src/types";

function SafeMathText({ value }: { value: string }) {
  if (!value) return null;
  const parts: Array<{ kind: "text" | "math"; value: string; displayMode?: boolean }> = [];
  const pattern = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+?\$)/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    const raw = match[0];
    if (index > cursor) {
      parts.push({ kind: "text", value: value.slice(cursor, index) });
    }
    const displayMode = raw.startsWith("\\[") || raw.startsWith("$$");
    const delimiterLength = raw.startsWith("\\") ? 2 : displayMode ? 2 : 1;
    parts.push({
      kind: "math",
      displayMode,
      value: raw.slice(delimiterLength, -delimiterLength).trim(),
    });
    cursor = index + raw.length;
  }
  if (cursor < value.length) {
    parts.push({ kind: "text", value: value.slice(cursor) });
  }
  const finalParts: Array<{ kind: "text" | "math"; value: string; displayMode?: boolean }> =
    parts.length ? parts : [{ kind: "text", value }];

  return (
    <span>
      {finalParts.map((part, idx) =>
        part.kind === "text" ? (
          <span key={idx}>{part.value}</span>
        ) : (
          <span
            key={idx}
            style={{ margin: "0 2px" }}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.value, {
                displayMode: part.displayMode,
                output: "htmlAndMathml",
                strict: "ignore",
                throwOnError: false,
              }),
            }}
          />
        ),
      )}
    </span>
  );
}

function RenderedTable({ content }: { content: string }) {
  const parsed = useMemo(() => {
    const lines = content
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const rows = lines
      .map((line) =>
        line
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
      .filter((row) => row.length > 0);

    if (rows.length < 2) return null;
    const headerRow = rows[0];
    const dataRows = rows
      .slice(1)
      .filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));

    return { headerRow, dataRows };
  }, [content]);

  if (!parsed) {
    return (
      <div style={{ padding: "12px", borderRadius: "8px", background: "var(--color-surface-subtle)" }}>
        <SafeMathText value={content} />
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", margin: "8px 0", borderRadius: "10px", border: "1px solid var(--color-border)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.88rem" }}>
        <thead>
          <tr style={{ background: "var(--color-surface-subtle)", borderBottom: "2px solid var(--color-border)" }}>
            {parsed.headerRow.map((col, idx) => (
              <th key={idx} style={{ padding: "10px 14px", fontWeight: 700, color: "var(--color-accent)" }}>
                <SafeMathText value={col} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parsed.dataRows.map((row, rIdx) => (
            <tr
              key={rIdx}
              style={{
                borderBottom: rIdx < parsed.dataRows.length - 1 ? "1px solid var(--color-border-subtle)" : "none",
                background: rIdx % 2 === 1 ? "rgba(0,0,0,0.015)" : "transparent",
              }}
            >
              {row.map((cell, cIdx) => (
                <td key={cIdx} style={{ padding: "10px 14px", color: "var(--color-text)", lineHeight: 1.5 }}>
                  <SafeMathText value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RenderedMermaid({ content }: { content: string }) {
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");

  const parsed = useMemo(() => {
    const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
    const nodes: Array<{ id: string; label: string; isDecision: boolean }> = [];
    const edges: Array<{ from: string; to: string; label?: string }> = [];
    const nodeMap = new Map<string, { id: string; label: string; isDecision: boolean }>();

    for (const line of lines) {
      if (line.startsWith("graph") || line.startsWith("flowchart")) continue;

      const nodeMatches = line.matchAll(/([A-Za-z0-9_]+)(?:\[(.*?)\]|\{(.*?)\})/g);
      for (const m of nodeMatches) {
        const id = m[1];
        const label = m[2] || m[3] || id;
        const isDecision = Boolean(m[3]);
        if (!nodeMap.has(id)) {
          const obj = { id, label, isDecision };
          nodeMap.set(id, obj);
          nodes.push(obj);
        }
      }

      const edgeMatch = line.match(/([A-Za-z0-9_]+)\s*(?:--\s*(.*?)\s*-->|-->|->)\s*([A-Za-z0-9_]+)/);
      if (edgeMatch) {
        edges.push({ from: edgeMatch[1], to: edgeMatch[3], label: edgeMatch[2] });
      }
    }

    return { nodes, edges };
  }, [content]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginBottom: "8px" }}>
        <button
          onClick={() => setViewMode("diagram")}
          style={{
            padding: "3px 10px",
            borderRadius: "6px",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
            background: viewMode === "diagram" ? "var(--color-accent)" : "var(--color-surface-subtle)",
            color: viewMode === "diagram" ? "#fff" : "var(--color-text-muted)",
            border: "none",
          }}
        >
          🖼️ 可视化拓扑图
        </button>
        <button
          onClick={() => setViewMode("code")}
          style={{
            padding: "3px 10px",
            borderRadius: "6px",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
            background: viewMode === "code" ? "var(--color-accent)" : "var(--color-surface-subtle)",
            color: viewMode === "code" ? "#fff" : "var(--color-text-muted)",
            border: "none",
          }}
        >
          📜 DSL 源码
        </button>
      </div>

      {viewMode === "code" ? (
        <pre style={{ margin: 0, fontSize: "0.85rem", fontFamily: "monospace", padding: "12px", background: "#1e1e2e", color: "#cdd6f4", borderRadius: "8px", overflowX: "auto" }}>
          {content}
        </pre>
      ) : (
        <div style={{ padding: "16px", background: "var(--color-surface-subtle)", borderRadius: "12px", border: "1px solid var(--color-border-subtle)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
            {parsed.nodes.map((node, i) => {
              const incoming = parsed.edges.filter((e) => e.to === node.id);
              return (
                <React.Fragment key={node.id}>
                  {i > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "var(--color-accent)" }}>
                      {incoming[0]?.label && (
                        <span style={{ fontSize: "0.72rem", background: "var(--color-accent-subtle)", padding: "1px 6px", borderRadius: "4px", marginBottom: "2px" }}>
                          {incoming[0].label}
                        </span>
                      )}
                      <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>↓</span>
                    </div>
                  )}
                  <div
                    style={{
                      padding: node.isDecision ? "10px 18px" : "10px 20px",
                      borderRadius: node.isDecision ? "20px" : "10px",
                      background: node.isDecision ? "rgba(245, 158, 11, 0.12)" : "var(--color-surface)",
                      border: node.isDecision ? "2px solid #f59e0b" : "2px solid var(--color-accent)",
                      fontWeight: 600,
                      fontSize: "0.88rem",
                      color: "var(--color-text)",
                      textAlign: "center",
                      maxWidth: "380px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                    }}
                  >
                    <SafeMathText value={node.label} />
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function DynamicVisualDispatcher({ element }: { element: VisualElement }) {
  if (element.format === "latex") {
    return (
      <div
        className="visual-latex-box"
        style={{
          padding: "16px",
          borderRadius: "12px",
          background: "var(--color-surface-subtle)",
          border: "1px solid var(--color-border-subtle)",
          fontSize: "1.1rem",
          color: "var(--color-text)",
          textAlign: "center",
          overflowX: "auto",
        }}
      >
        <span style={{ fontSize: "0.75rem", color: "var(--color-accent)", display: "block", marginBottom: "6px", fontWeight: 700 }}>
          ∑ 矢量数学表达
        </span>
        <SafeMathText value={element.content.startsWith("$") ? element.content : `$$\n${element.content}\n$$`} />
      </div>
    );
  }

  if (element.format === "mermaid") {
    return <RenderedMermaid content={element.content} />;
  }

  if (element.format === "table") {
    return <RenderedTable content={element.content} />;
  }

  if (element.format === "code") {
    return (
      <div
        className="visual-code-box"
        style={{
          borderRadius: "12px",
          background: "#1e1e2e",
          color: "#cdd6f4",
          padding: "16px",
          overflowX: "auto",
          fontFamily: "monospace",
          fontSize: "0.88rem",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {element.language && (
          <div style={{ fontSize: "0.75rem", color: "#89b4fa", textTransform: "uppercase", marginBottom: "8px", fontWeight: 700 }}>
            {element.language}
          </div>
        )}
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{element.content}</pre>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--color-surface-subtle)", color: "var(--color-text)" }}>
      <SafeMathText value={element.content} />
    </div>
  );
}

export function VisualCanvasCard({ element }: { element: VisualElement }) {
  if (!element || !element.content) return null;

  return (
    <section
      className="panel-card visual-canvas-card"
      style={{
        padding: "18px",
        borderRadius: "16px",
        background: "var(--color-surface-raised)",
        border: "1px solid var(--color-border)",
        margin: "14px 0",
        boxShadow: "var(--shadow-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-accent)" }} />
          <h4 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
            {element.caption || "概念表达拓展"}
          </h4>
        </div>
        <span
          style={{
            fontSize: "0.72rem",
            padding: "2px 8px",
            borderRadius: "10px",
            background: "var(--color-accent-subtle)",
            color: "var(--color-accent)",
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          {element.format.toUpperCase()}
        </span>
      </div>

      <DynamicVisualDispatcher element={element} />
    </section>
  );
}

export function FlashCardSuite({ cards }: { cards: Array<{ front: string; back: string }> }) {
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const toggleFlip = (index: number) => {
    setFlipped((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const openPreview = (index: number) => {
    setPreviewIndex(index);
  };

  const closePreview = () => {
    setPreviewIndex(null);
  };

  // 弹窗打开时锁住页面滚动；Esc 关闭；组件卸载时恢复滚动
  useEffect(() => {
    if (previewIndex === null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewIndex]);

  if (!cards.length) return null;

  return (
    <section className="flashcard-suite-container" style={{ marginTop: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
        <span style={{ fontSize: "1rem" }}>📇</span>
        <h3 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
          本节核心复盘闪卡 <small style={{ fontWeight: 500, color: "var(--color-text-muted)", fontSize: "0.82rem" }}>（点击卡片翻转，点击 ⛶ 预览完整内容）</small>
        </h3>
      </div>

      <div
        className="flashcard-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "14px",
        }}
      >
        {cards.map((card, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleFlip(i)}
            aria-pressed={Boolean(flipped[i])}
            aria-label={`${flipped[i] ? "查看问题" : "查看答案"}：${card.front}`}
            style={{
              height: "130px",
              perspective: "1000px",
              cursor: "pointer",
              border: 0,
              padding: 0,
              background: "transparent",
              textAlign: "left",
              position: "relative",
            }}
          >
            <span
              style={{
                display: "block",
                position: "relative",
                width: "100%",
                height: "100%",
                transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                transformStyle: "preserve-3d",
                transform: flipped[i] ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              {/* Card Front */}
              <span
                style={{
                  boxSizing: "border-box",
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  padding: "16px",
                  borderRadius: "14px",
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "var(--shadow-1)",
                }}
              >
                <span style={{ fontSize: "0.75rem", color: "var(--color-accent)", fontWeight: 600 }}>✦ 点击翻转查看记忆点</span>
                <span
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    margin: 0,
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    color: "var(--color-text)",
                    lineHeight: 1.4,
                  }}
                >
                  <SafeMathText value={card.front} />
                </span>
              </span>

              {/* Card Back */}
              <span
                style={{
                  boxSizing: "border-box",
                  position: "absolute",
                  inset: 0,
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                  padding: "16px",
                  borderRadius: "14px",
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid #10b981",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 700 }}>✓ 精确记忆标准</span>
                <span
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    margin: 0,
                    fontSize: "0.86rem",
                    color: "var(--color-text)",
                    lineHeight: 1.4,
                  }}
                >
                  <SafeMathText value={card.back} />
                </span>
              </span>
            </span>
            {/* 预览按钮：独立于翻转，点击打开完整内容弹窗 */}
            <span
              role="button"
              tabIndex={0}
              aria-label={`预览完整内容：${card.front}`}
              title="预览完整内容"
              onClick={(event) => {
                event.stopPropagation();
                openPreview(i);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  openPreview(i);
                }
              }}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                zIndex: 2,
                width: "26px",
                height: "26px",
                display: "grid",
                placeItems: "center",
                borderRadius: "8px",
                background: "var(--color-surface-subtle)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-muted)",
                fontSize: "0.85rem",
                cursor: "pointer",
                boxShadow: "var(--shadow-1)",
              }}
            >
              ⛶
            </span>
          </button>
        ))}
      </div>

      {/* 预览弹窗：用 Portal 渲染到 body，避免被祖先 transform 限制 fixed 定位 */}
      {previewIndex !== null && cards[previewIndex]
        ? createPortal(
            <div
              className="flashcard-preview-overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`闪卡预览：${cards[previewIndex].front}`}
              onClick={closePreview}
            >
              <div
                className="flashcard-preview-dialog"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="flashcard-preview-close"
                  aria-label="关闭预览"
                  onClick={closePreview}
                >
                  ✕
                </button>
                <h4>闪卡预览</h4>
                <div className="flashcard-preview-body">
                  <article className="flashcard-preview-front">
                    <small>✦ 记忆点</small>
                    <p><SafeMathText value={cards[previewIndex].front} /></p>
                  </article>
                  <article className="flashcard-preview-back">
                    <small>✓ 精确记忆标准</small>
                    <p><SafeMathText value={cards[previewIndex].back} /></p>
                  </article>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
