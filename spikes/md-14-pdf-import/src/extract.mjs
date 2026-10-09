// MD-14 spike: convert slide PDFs to one image per page and extract text per page.
//
// Usage: node src/extract.mjs [pdf or dir ...] [--out out] [--width 1920]
//                             [--format webp|png|jpeg] [--quality 80] [--no-images]
//                             [--text-engine pdfjs|mupdf] [--data data/slides-text.json]
//
// Writes:
//   <out>/images/<deck>/<page>.<format>   one image per slide
//   <out>/slides-text.json                [{ deck, file, page, text, ... }] with quality fields
//   <data>                                [{ deck, file, page, text }] for MD-10
//   <out>/report.json                     timings, sizes, Thai quality per deck

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import * as mupdf from "mupdf";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyFixes, checkThai, repairThai, saraAmFixesFromGlyphRuns } from "./thai.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "out" },
    width: { type: "string", default: "1920" },
    format: { type: "string", default: "webp" },
    quality: { type: "string", default: "80" },
    "no-images": { type: "boolean", default: false },
    data: { type: "string" },
    "text-engine": { type: "string", default: "pdfjs" },
  },
});

const MIME = { webp: "image/webp", png: "image/png", jpeg: "image/jpeg" };
const targetWidth = Number(opts.width);
const quality = Number(opts.quality);
const LOW_TEXT_CHARS = 20;

const inputs = (positionals.length ? positionals : ["../../slides"]).flatMap((p) =>
  fs.statSync(p).isDirectory()
    ? fs
        .readdirSync(p)
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .map((f) => path.join(p, f))
    : [p],
);

const deckId = (file) =>
  path
    .basename(file, ".pdf")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function pdfjsPageText(page) {
  const content = await page.getTextContent();
  const raw = content.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join("");
  // getOperatorList is slow on image-heavy pages. Only Thai SARA AA can be broken.
  if (!/[\u0E01-\u0E2E][\u0E48-\u0E4B]?\u0E32/.test(raw)) return { raw, fixed: raw };
  const ops = await page.getOperatorList();
  const runs = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== OPS.showText) continue;
    runs.push(ops.argsArray[i][0].map((g) => (typeof g === "number" ? "" : g.unicode)).join(""));
  }
  // Some exports draw one glyph per showText, so join runs to keep Thai context.
  return { raw, fixed: applyFixes(raw, saraAmFixesFromGlyphRuns([runs.join("")])) };
}

const tidy = (text) =>
  text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const slides = [];
const decks = [];

for (const file of inputs) {
  const deck = deckId(file);
  const data = fs.readFileSync(file);
  const imgDir = path.join(opts.out, "images", deck);
  if (!opts["no-images"]) fs.mkdirSync(imgDir, { recursive: true });

  const t = { load: 0, render: 0, encode: 0, pdfjsText: 0, mupdfText: 0 };
  let imageBytes = 0;
  let mark = performance.now();

  const task = getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const pdf = await task.promise;
  const mu = mupdf.Document.openDocument(data, "application/pdf");
  t.load = performance.now() - mark;

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);

    if (!opts["no-images"]) {
      mark = performance.now();
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const { canvas, context } = pdf.canvasFactory.create(
        Math.round(viewport.width),
        Math.round(viewport.height),
      );
      await page.render({ canvasContext: context, viewport }).promise;
      t.render += performance.now() - mark;

      mark = performance.now();
      const img = await canvas.encode(opts.format, opts.format === "png" ? undefined : quality);
      t.encode += performance.now() - mark;
      fs.writeFileSync(path.join(imgDir, `${String(n).padStart(3, "0")}.${opts.format}`), img);
      imageBytes += img.length;
    }

    mark = performance.now();
    const pdfjsText = await pdfjsPageText(page);
    pdfjsText.raw = tidy(pdfjsText.raw);
    pdfjsText.fixed = tidy(pdfjsText.fixed);
    t.pdfjsText += performance.now() - mark;

    mark = performance.now();
    const mupdfText = tidy(
      mu
        .loadPage(n - 1)
        .toStructuredText("preserve-whitespace")
        .asText(),
    );
    t.mupdfText += performance.now() - mark;

    page.cleanup();

    // Both engines need repairThai. pdf.js also needs the glyph-run fixes,
    // because its text content drops the space that marks a broken SARA AM.
    const candidates = {
      pdfjs: repairThai(pdfjsText.fixed),
      mupdf: repairThai(mupdfText),
    };
    const engine = opts["text-engine"];
    const text = candidates[engine];
    const chars = text.replace(/\s/g, "").length;
    slides.push({
      deck,
      file: path.basename(file),
      page: n,
      text,
      engine,
      chars,
      lowText: chars < LOW_TEXT_CHARS,
      thai: {
        pdfjsRaw: checkThai(pdfjsText.raw),
        pdfjs: checkThai(candidates.pdfjs),
        mupdfRaw: checkThai(mupdfText),
        mupdf: checkThai(candidates.mupdf),
      },
      altText: candidates[engine === "pdfjs" ? "mupdf" : "pdfjs"],
    });
  }

  const pages = pdf.numPages;
  await task.destroy();
  const deckSlides = slides.filter((s) => s.deck === deck);
  const sum = (key, which) => deckSlides.reduce((a, s) => a + s.thai[which][key], 0);
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  decks.push({
    deck,
    file: path.basename(file),
    pdfBytes: data.length,
    pages,
    ms: Object.fromEntries(Object.entries({ ...t, total }).map(([k, v]) => [k, Math.round(v)])),
    msPerPage: Math.round(total / pages),
    imageBytes,
    imageBytesPerPage: Math.round(imageBytes / pages),
    textBytes: Buffer.byteLength(deckSlides.map((s) => s.text).join("\n")),
    lowTextPages: deckSlides.filter((s) => s.lowText).map((s) => s.page),
    thai: Object.fromEntries(
      ["pdfjsRaw", "pdfjs", "mupdfRaw", "mupdf"].map((w) => [
        w,
        Object.fromEntries(Object.keys(deckSlides[0].thai.pdfjs).map((k) => [k, sum(k, w)])),
      ]),
    ),
  });
  console.log(
    `${deck}: ${pages} pages, ${Math.round(total)} ms, images ${(imageBytes / 1e6).toFixed(1)} MB`,
  );
}

fs.mkdirSync(opts.out, { recursive: true });
fs.writeFileSync(path.join(opts.out, "slides-text.json"), JSON.stringify(slides, null, 2));
if (opts.data) {
  fs.mkdirSync(path.dirname(opts.data), { recursive: true });
  const rows = slides.map(({ deck, file, page, text }) => ({ deck, file, page, text }));
  fs.writeFileSync(opts.data, JSON.stringify(rows, null, 2) + "\n");
}
fs.writeFileSync(
  path.join(opts.out, "report.json"),
  JSON.stringify(
    {
      settings: {
        width: targetWidth,
        format: opts.format,
        quality,
        images: !opts["no-images"],
        textEngine: opts["text-engine"],
      },
      node: process.version,
      decks,
    },
    null,
    2,
  ),
);
