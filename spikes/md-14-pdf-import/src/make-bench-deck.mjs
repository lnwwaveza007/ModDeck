// Builds 50-slide benchmark decks by joining sample decks (no 50-slide sample exists).
// Usage: node src/make-bench-deck.mjs <out.pdf> <src.pdf> [<src.pdf> ...]
import fs from "node:fs";
import * as mupdf from "mupdf";

const [outFile, ...sources] = process.argv.slice(2);
const out = new mupdf.PDFDocument();
for (const file of sources) {
  const src = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf").asPDF();
  for (let i = 0; i < src.countPages() && out.countPages() < 50; i++) out.graftPage(-1, src, i);
}
fs.writeFileSync(outFile, out.saveToBuffer("garbage,compress").asUint8Array());
console.log(`${outFile}: ${out.countPages()} pages`);
