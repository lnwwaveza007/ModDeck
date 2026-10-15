import katex from "katex";
import type { HighlighterGeneric } from "shiki";

export function renderKatex(latex: string): string {
  return katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
    strict: "ignore",
    output: "html",
  });
}

export function renderPrism(source: string, lang: string, prism: typeof import("prismjs")): string {
  const grammar = prism.languages[lang];
  if (!grammar) {
    return prism.util.encode(source) as unknown as string;
  }
  return prism.highlight(source, grammar, lang);
}

export function renderShiki(
  highlighter: HighlighterGeneric<string, string>,
  source: string,
  lang: string,
): string {
  return highlighter.codeToHtml(source, {
    lang,
    theme: "github-light",
  });
}

export async function measureMs(work: () => void | Promise<void>): Promise<number> {
  const start = performance.now();
  await work();
  return Math.round((performance.now() - start) * 10) / 10;
}
