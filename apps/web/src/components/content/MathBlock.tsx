"use client";

import "katex/dist/katex.min.css";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { renderMath } from "@/lib/render/math";

/**
 * One LaTeX formula (F7), on its own line or inside a sentence. LaTeX that does not parse shows
 * a short message and the source in its place, so a typo can never break the slide around it.
 */
export function MathBlock({
  latex,
  display = true,
  scroll = true,
  className,
}: {
  latex: string;
  display?: boolean;
  /** A formula wider than its box scrolls. A slide turns this off and lets it spill instead. */
  scroll?: boolean;
  className?: string;
}) {
  const t = useTranslations("content");
  const result = useMemo(() => renderMath(latex, { display }), [latex, display]);

  if (result.ok) {
    // KaTeX builds this markup itself from a parsed tree, with links and raw HTML turned off.
    const Tag = display ? "div" : "span";
    return (
      <Tag
        className={cn(display && scroll && "max-w-full overflow-x-auto", className)}
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    );
  }

  if (!display) {
    // In a sentence the raw text stays readable, as for a student's question (MD-5 §7).
    return (
      <span title={result.error} className={cn("font-mono text-error-700", className)}>
        ${latex}$
      </span>
    );
  }

  return (
    <div
      data-math-error=""
      className={cn(
        "flex w-full flex-col gap-1 rounded-md border border-error-600 bg-error-50 px-3 py-2 text-left text-error-800",
        className,
      )}
    >
      <p className="text-[0.9em] font-semibold">{t("mathError")}</p>
      <p className="font-mono text-[0.8em] break-words whitespace-pre-wrap">{result.error}</p>
      <pre className="font-mono text-[0.8em] break-words whitespace-pre-wrap text-neutral-700">
        {latex}
      </pre>
    </div>
  );
}
