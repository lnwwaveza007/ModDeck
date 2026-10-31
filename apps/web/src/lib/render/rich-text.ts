// Parser behind RichText (technical design §2.4): plain text with `code`, ``` fenced code ```,
// $math$ and $$display math$$, and "# " headings. The same parser serves text slides, poll
// options and Q&A questions, so a phone, the presenter and the projector show the same thing.
//
// Anything that does not close (`$x^`, an unfinished fence) stays plain text. The parser never
// throws and never produces markup, only a small tree for React to render.

import { CODE_LANGUAGES, type CodeLanguage } from "@moddeck/shared";

export type Inline =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "math"; value: string };

export type Block =
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "heading"; inlines: Inline[] }
  | { type: "code"; language: CodeLanguage; value: string }
  | { type: "math"; value: string };

const ALIASES: Record<string, CodeLanguage> = {
  py: "python",
  python3: "python",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  "c++": "cpp",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  v: "verilog",
  text: "plaintext",
  txt: "plaintext",
};

/** The language of a fence's info string (```py). Unknown names show as plain text. */
export function codeLanguageFromFence(info: string): CodeLanguage {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if ((CODE_LANGUAGES as readonly string[]).includes(name)) return name as CodeLanguage;
  return ALIASES[name] ?? "plaintext";
}

/** `$5 and $10` is money, not math: a closing $ must not touch a digit, an opening $ no space. */
function findMathEnd(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] !== "$") continue;
    const before = text[i - 1];
    const after = text[i + 1];
    if (before === " " || before === "\n" || i === from) return -1;
    if (after !== undefined && /\d/.test(after)) continue;
    return i;
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", value: plain });
    plain = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\\" && (text[i + 1] === "$" || text[i + 1] === "`")) {
      plain += text[i + 1];
      i++;
    } else if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "code", value: text.slice(i + 1, end) });
        i = end;
      } else {
        plain += char;
      }
    } else if (char === "$" && text[i + 1] !== undefined && !/\s/.test(text[i + 1])) {
      const end = findMathEnd(text, i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "math", value: text.slice(i + 1, end) });
        i = end;
      } else {
        plain += char;
      }
    } else {
      plain += char;
    }
  }
  flush();
  return out;
}

export function parseRichText(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", inlines: parseInline(paragraph.join("\n")) });
    }
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      const close = lines.findIndex((l, j) => j > i && /^\s*```\s*$/.test(l));
      if (close !== -1) {
        endParagraph();
        blocks.push({
          type: "code",
          language: codeLanguageFromFence(fence[1]),
          value: lines.slice(i + 1, close).join("\n"),
        });
        i = close;
        continue;
      }
    }

    if (/^\s*\$\$/.test(line)) {
      const oneLine = /^\s*\$\$(.+?)\$\$\s*$/.exec(line);
      if (oneLine) {
        endParagraph();
        blocks.push({ type: "math", value: oneLine[1].trim() });
        continue;
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        const close = lines.findIndex((l, j) => j > i && /^\s*\$\$\s*$/.test(l));
        if (close !== -1) {
          endParagraph();
          blocks.push({
            type: "math",
            value: lines
              .slice(i + 1, close)
              .join("\n")
              .trim(),
          });
          i = close;
          continue;
        }
      }
    }

    const heading = /^#\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({ type: "heading", inlines: parseInline(heading[1]) });
      continue;
    }

    if (line.trim() === "") endParagraph();
    else paragraph.push(line);
  }
  endParagraph();
  return blocks;
}
