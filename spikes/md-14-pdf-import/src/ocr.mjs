// MD-14 fallback test: OCR rendered slide images with tesseract.js (Thai + English)
// and compare with the text layer from extract.mjs.
//
// Usage: node src/ocr.mjs <deck>:<page> ...   (run extract.mjs first)
// Writes: out/ocr.json

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createWorker } from "tesseract.js";
import { checkThai } from "./thai.mjs";

const slides = JSON.parse(fs.readFileSync("out/slides-text.json", "utf8"));
const report = JSON.parse(fs.readFileSync("out/report.json", "utf8"));
const ext = report.settings.format;

let mark = performance.now();
const worker = await createWorker(["tha", "eng"]);
const initMs = Math.round(performance.now() - mark);

const results = [];
for (const arg of process.argv.slice(2)) {
  const [deckPrefix, page] = arg.split(":");
  const slide = slides.find((s) => s.deck.startsWith(deckPrefix) && s.page === Number(page));
  const img = path.join("out/images", slide.deck, `${page.padStart(3, "0")}.${ext}`);

  mark = performance.now();
  const { data } = await worker.recognize(fs.readFileSync(img));
  const ms = Math.round(performance.now() - mark);

  results.push({
    deck: slide.deck,
    page: slide.page,
    ms,
    confidence: Math.round(data.confidence),
    textLayer: slide.text,
    ocr: data.text.trim(),
    thai: checkThai(data.text),
  });
  console.log(`${slide.deck}:${page} ${ms} ms, confidence ${Math.round(data.confidence)}`);
}

await worker.terminate();
fs.writeFileSync("out/ocr.json", JSON.stringify({ initMs, results }, null, 2));
