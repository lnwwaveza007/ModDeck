"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { CodeLanguage } from "@moddeck/shared";
import { cn } from "@/lib/cn";
import { highlightCode, plainTokens, type CodeToken } from "@/lib/render/code";

// Shiki's fontStyle is a bit mask: 1 italic, 2 bold, 4 underline.
function tokenStyle({ color, fontStyle = 0 }: CodeToken): CSSProperties | undefined {
  if (!color && !fontStyle) return undefined;
  return {
    color,
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? 700 : undefined,
    textDecoration: fontStyle & 4 ? "underline" : undefined,
  };
}

/**
 * Highlighted code (F7). The source shows at once as plain text, then the colors arrive when
 * the highlighter has loaded; if it cannot load, the plain text stays. Long code scrolls
 * and never shrinks (MD-3 §6).
 */
export function CodeBlock({
  source,
  language,
  className,
}: {
  source: string;
  language: CodeLanguage;
  className?: string;
}) {
  const [highlighted, setHighlighted] = useState<{
    source: string;
    language: CodeLanguage;
    lines: CodeToken[][];
  } | null>(null);

  useEffect(() => {
    let current = true;
    highlightCode(source, language).then(
      (lines) => {
        if (current) setHighlighted({ source, language, lines });
      },
      () => {
        // The highlighter did not load: keep the plain text.
      },
    );
    return () => {
      current = false;
    };
  }, [source, language]);

  // Colors from an older source or language would be wrong, so they are not used.
  const ready = highlighted?.source === source && highlighted.language === language;
  const lines = ready ? highlighted.lines : plainTokens(source);

  return (
    <pre
      tabIndex={0}
      data-language={language}
      data-highlighted={ready ? "true" : "false"}
      className={cn(
        "max-w-full overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-[0.8em] text-left font-mono leading-[1.5] text-neutral-900 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <code>
        {lines.map((line, lineIndex) => (
          <span key={lineIndex}>
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} style={tokenStyle(token)}>
                {token.content}
              </span>
            ))}
            {lineIndex < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </pre>
  );
}
