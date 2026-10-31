// KaTeX behind one function (MD-3: KaTeX for every formula on every screen). It never throws:
// LaTeX that does not parse comes back as an error value, so a bad formula can only show an
// inline message and never blank the page.

import katex from "katex";

export type MathResult = { ok: true; html: string } | { ok: false; error: string };

const PREFIX = /^KaTeX parse error:\s*/;

/**
 * `display` sets a formula on its own line (math slide, `$$ … $$`); inline sits in a sentence.
 * Empty source is valid and renders nothing.
 */
export function renderMath(
  latex: string,
  { display = true }: { display?: boolean } = {},
): MathResult {
  if (latex.trim() === "") return { ok: true, html: "" };
  try {
    const html = katex.renderToString(latex, {
      displayMode: display,
      // Throw, so the caller can show the error. `throwOnError: false` would paint the raw
      // source in red and give the host no message to act on.
      throwOnError: true,
      strict: "ignore",
      // Untrusted input (student questions): no \href, \includegraphics or \url, and a cap on
      // macro expansion so `\def\a{\a\a}\a` cannot hang the tab.
      trust: false,
      maxExpand: 1000,
      maxSize: 50,
    });
    return { ok: true, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.replace(PREFIX, "") || "Invalid LaTeX" };
  }
}
