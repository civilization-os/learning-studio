import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";


type MathTextPart =
  | { kind: "text"; value: string }
  | { displayMode: boolean; kind: "math"; value: string };

function splitMathText(value: string): MathTextPart[] {
  const parts: MathTextPart[] = [];
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

  return parts.length ? parts : [{ kind: "text", value }];
}

function autoFormatMathInText(text: string): string {
  if (!text || text.includes("$") || text.includes("\\[")) return text;
  const fracPattern = /(\(?[a-zA-Z0-9_\-\+]+\)?\/[a-zA-Z0-9_\-\+]+(?:\s*=\s*\(?[a-zA-Z0-9_\-\+]+\)?\/[a-zA-Z0-9_\-\+]+)+)/g;
  return text.replace(fracPattern, (match) => {
    const formatted = match.replace(/(\(?[\w\-+]+\)?)\/([\w\-+]+)/g, (_, num, den) => {
      const cleanNum = num.trim().replace(/^\(|\)$/g, "");
      const cleanDen = den.trim().replace(/^\(|\)$/g, "");
      return `\\frac{${cleanNum}}{${cleanDen}}`;
    });
    return `$${formatted}$`;
  });
}

export function MathText({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const formattedValue = useMemo(() => autoFormatMathInText(value), [value]);
  const parts = useMemo(() => splitMathText(formattedValue), [formattedValue]);

  return (
    <span className={["math-text", className].filter(Boolean).join(" ")}>
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={`text-${index}`}>{part.value}</span>
        ) : (
          <span
            className={part.displayMode ? "math-fragment is-block" : "math-fragment"}
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(part.value, {
                displayMode: part.displayMode,
                output: "htmlAndMathml",
                strict: "ignore",
                throwOnError: false,
                trust: false,
              }),
            }}
            key={`math-${index}`}
          />
        ),
      )}
    </span>
  );
}

