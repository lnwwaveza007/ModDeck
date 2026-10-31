// Syntax highlighting with Shiki (MD-3 recommendation). One highlighter is created per tab, on
// first use, and each grammar loads the first time its language appears. The fine-grained
// build with the JavaScript regex engine ships no wasm and only the grammars in LOADERS.
//
// The result is a list of colored tokens, not an HTML string. React turns the tokens into
// <span>s, so no highlighted source is ever put into the page as markup.

import type { CodeLanguage } from "@moddeck/shared";
import type { HighlighterCore, LanguageInput, ThemedToken } from "shiki/core";

export type CodeToken = Pick<ThemedToken, "content" | "color" | "fontStyle">;

// Light theme on purpose: dark code washes out on a projector in a bright room (MD-3 §5).
const THEME = "github-light";

type Highlightable = Exclude<CodeLanguage, "plaintext">;

const LOADERS: Record<Highlightable, () => LanguageInput> = {
  python: () => import("@shikijs/langs/python"),
  java: () => import("@shikijs/langs/java"),
  sql: () => import("@shikijs/langs/sql"),
  javascript: () => import("@shikijs/langs/javascript"),
  typescript: () => import("@shikijs/langs/typescript"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  bash: () => import("@shikijs/langs/bash"),
  json: () => import("@shikijs/langs/json"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  verilog: () => import("@shikijs/langs/verilog"),
};

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/github-light"),
    ]);
    return createHighlighterCore({
      themes: [theme],
      langs: [],
      // forgiving: a grammar rule the JS engine cannot run is skipped, not thrown.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })().catch((error) => {
    highlighter = null; // let the next code block try again
    throw error;
  });
  return highlighter;
}

/** The source as plain lines, shown while the highlighter loads and for "plaintext". */
export function plainTokens(source: string): CodeToken[][] {
  return source.split("\n").map((line) => [{ content: line }]);
}

/** Resolves to one token list per line. Rejects only if the highlighter cannot load. */
export async function highlightCode(
  source: string,
  language: CodeLanguage,
): Promise<CodeToken[][]> {
  if (language === "plaintext") return plainTokens(source);
  const shiki = await getHighlighter();
  if (!shiki.getLoadedLanguages().includes(language)) {
    await shiki.loadLanguage(LOADERS[language]());
  }
  return shiki.codeToTokensBase(source, { lang: language, theme: THEME });
}
