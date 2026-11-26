// PDF reading for the import worker (MD-14): one image and the text of each page, with pdf.js and
// @napi-rs/canvas. Runs in a child process, so a big file never blocks the live channel.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ImportErrorCode } from "@moddeck/shared";
import {
  applyFixes,
  checkThai,
  repairThai,
  saraAmFixesFromGlyphRuns,
  tidyText,
} from "./thai-repair";

// Slide images: WebP, 1920 px wide, quality 92. At 80 thin text on a dark slide got a blurred,
// blocky edge; 92 looks close to lossless for about half as much again in size (a dark 16:9
// slide: about 31 KB at 80, 48 KB at 92).
export const IMAGE_WIDTH = 1920;
const IMAGE_MAX_HEIGHT = 2560; // a portrait page is scaled down to fit
const IMAGE_QUALITY = 92;

// A failure the host can understand: a protected or an unreadable file.
export class PdfError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface TextItem {
  str: string;
  hasEOL: boolean;
}
interface PdfPage {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: object[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  canvasFactory: {
    create(
      width: number,
      height: number,
    ): { canvas: { encode(format: "webp", quality: number): Promise<Buffer> }; context: unknown };
  };
}
interface PdfJs {
  getDocument(source: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
  OPS: { showText: number };
}

// pdf.js is an ES module and this app compiles to CommonJS, where `import()` would be turned into
// `require`. A real dynamic import keeps it working.
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<PdfJs>;

let pdfjs: Promise<PdfJs> | undefined;
const loadPdfJs = () => (pdfjs ??= dynamicImport("pdfjs-dist/legacy/build/pdf.mjs"));

const pdfjsDir = dirname(createRequire(__filename).resolve("pdfjs-dist/package.json"));

export interface OpenPdf {
  pageCount: number;
  doc: PdfDocument;
  close(): Promise<void>;
}

/** Opens a PDF file. Throws PdfError for a protected or unreadable file. */
export async function openPdf(file: string): Promise<OpenPdf> {
  const { getDocument } = await loadPdfJs();
  const data = await readFile(file);
  try {
    const task = getDocument({
      data: new Uint8Array(data),
      verbosity: 0,
      isEvalSupported: false,
      // Fonts and colour maps that a PDF may leave out, read from the package.
      standardFontDataUrl: join(pdfjsDir, "standard_fonts") + "/",
      cMapUrl: join(pdfjsDir, "cmaps") + "/",
      cMapPacked: true,
    });
    try {
      const doc = await task.promise;
      return { pageCount: doc.numPages, doc, close: () => task.destroy() };
    } catch (error) {
      await task.destroy().catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw new PdfError("PDF_PROTECTED", "PDF needs a password");
    throw new PdfError("PDF_INVALID", name || "PDF cannot be read");
  }
}

export interface RenderedPage {
  image: Buffer;
  width: number;
  height: number;
  text: string;
  thai: ReturnType<typeof checkThai>;
}

async function pageText({ OPS }: PdfJs, page: PdfPage): Promise<string> {
  const content = await page.getTextContent();
  const raw = content.items
    .map((item) => {
      const { str, hasEOL } = item as Partial<TextItem>;
      return typeof str === "string" ? str + (hasEOL ? "\n" : "") : "";
    })
    .join("");
  // Only SARA AA can hide a broken SARA AM, and getOperatorList is slow on picture-heavy pages.
  if (!/[ก-ฮ][่-๋]?า/.test(raw)) return repairThai(tidyText(raw));
  const ops = await page.getOperatorList();
  const runs: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== OPS.showText) continue;
    const glyphs = ops.argsArray[i][0] as ({ unicode?: string } | number)[];
    runs.push(glyphs.map((g) => (typeof g === "number" ? "" : (g.unicode ?? ""))).join(""));
  }
  // Some exports draw one glyph per showText, so the runs are joined to keep Thai context.
  const fixed = applyFixes(raw, saraAmFixesFromGlyphRuns([runs.join("")]));
  return repairThai(tidyText(fixed));
}

/** One page as a WebP image and its repaired text. */
export async function renderPage(pdf: OpenPdf, number: number): Promise<RenderedPage> {
  const js = await loadPdfJs();
  const page = await pdf.doc.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(IMAGE_WIDTH / base.width, IMAGE_MAX_HEIGHT / base.height);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const { canvas, context } = pdf.doc.canvasFactory.create(width, height);
    await page.render({ canvasContext: context, viewport }).promise;
    const image = await canvas.encode("webp", IMAGE_QUALITY);
    const text = await pageText(js, page);
    return { image, width, height, text, thai: checkThai(text) };
  } finally {
    page.cleanup();
  }
}
