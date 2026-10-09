# MD-14 Findings: PDF slide import and text extraction

**Verdict: pass with conditions.** pdf.js can turn a slide PDF into one image per slide and extract usable Thai/English text per slide. It needs a Thai repair step, because PowerPoint for Windows exports break the vowel SARA AM (ำ). Google Slides and Canva exports are not tested yet.

## 1. Goal and pass criteria

Check that instructors' existing slides (PDF) can be imported for ModDeck:

- [x] PDF converted to one image per slide (199/199 pages)
- [x] Text extracted per slide, Thai text quality checked
- [x] Processing time for a 50-slide deck recorded
- [x] Extracted text saved for MD-10 (`data/slides-text.json`)
- [x] Findings note written

The proposal has no numeric target for import time. This note uses "a 50-slide deck is ready in well under a minute on a normal server" as the working target.

## 2. Setup

| Item | Value |
| --- | --- |
| Machine | AMD Ryzen 5 5500 (6 cores / 12 threads), 16 GB RAM, Windows 11 |
| Runtime | Node.js 22.13.0, one process, pages processed one at a time |
| Render + text | `pdfjs-dist` 6.3.289 (Apache-2.0) with `@napi-rs/canvas` 1.0.10 (MIT) |
| Text, for comparison | `mupdf` 1.28.1 (**AGPL-3.0**) |
| OCR fallback | `tesseract.js` 7.0.0 (Apache-2.0), languages `tha+eng` |

Sample decks (in `slides/`, not committed):

| Deck | Pages | Exported from | Thai chars |
| --- | --- | --- | --- |
| 101 Signal and Data Bandwidth Utilization | 38 | PowerPoint for Mac (Quartz) | 0 |
| 102-Cables | 20 | PowerPoint for Mac (Quartz) | 40 |
| Chapter1-IntroductiontoVue | 20 | PowerPoint 365 (Windows) | 892 |
| Chapter2-TemplateSyntax | 24 | PowerPoint 365 (Windows) | 22 |
| Chapter3-ReactiveFormBinding | 37 | PowerPoint 365 (Windows) | 22 |
| INT319-W07 Corporate Strategy II | 22 | PowerPoint 365 (Windows) | 3,971 |
| INT319-W08 Marketing | 19 | PowerPoint 365 (Windows) | 1,794 |
| INT319-W09 Manufacturing | 19 | PowerPoint 365 (Windows) | 1,497 |

All 8 decks are PowerPoint exports. No sample deck has 50 slides, so `src/make-bench-deck.mjs` joins sample decks into two 50-slide test decks:

- **Thai text deck**: W07 + W08 + first 9 pages of W09 (10.3 MB PDF). Text-heavy, mostly Thai.
- **Image-heavy deck**: 101 + first 12 pages of 102 (17.7 MB PDF). Photos and diagrams, little text.

## 3. Method

`src/extract.mjs`, for each page:

1. Render with pdf.js at 1920 px wide, encode as WebP (q80), JPEG (q85) or PNG.
2. Extract text with pdf.js `getTextContent()`, and with mupdf for comparison.
3. Repair Thai (`src/thai.mjs`, see section 4.2).
4. Count Thai problems before and after repair: marks with no consonant before them, Private Use Area (PUA) glyphs, U+FFFD, and "consonant + space + า".
5. Flag pages with fewer than 20 non-space characters (`lowText`). These need OCR to get any text.

`src/ocr.mjs` runs tesseract.js on 5 rendered pages and compares the result with the text layer. Each timing is the median of 3 runs.

Run it:

```sh
pnpm --filter spike-md-14-pdf-import extract            # sample decks -> out/ and data/
cd spikes/md-14-pdf-import
node src/make-bench-deck.mjs bench/50.pdf a.pdf b.pdf   # join decks into a 50-slide deck
node src/extract.mjs bench/50.pdf --out bench/out --format jpeg --quality 85
node src/ocr.mjs int319-w07:18 102:2                    # OCR test, after extract
```

## 4. Results

### 4.1 Images

- One image per page for all 8 decks (199 images). Thai fonts, gradients and photos look correct at 1920 px.
- Text that is part of a picture stays in the image only. For example, the headline on 102 page 2 is a picture, so the text layer does not have it.

### 4.2 Thai text quality

Text extraction works on every deck, and mixed Thai/English lines keep their order. Tone marks and upper/lower vowels (ั ิ ี ึ ื ุ ู ่ ้ ๊ ๋ ็ ์) come out correctly. There is no U+FFFD in any deck. Three problems were found:

| Problem | Where | Raw text | Cause | Fix |
| --- | --- | --- | --- | --- |
| **SARA AM lost** | All PowerPoint 365 (Windows) decks with Thai: 69 places | `นำเสนอ` → `นาเสนอ`, `น้ำมัน` → `น ้ามัน` | PowerPoint draws ำ as two glyphs: NIKHAHIT + SARA AA. Its font map sends the NIKHAHIT glyph to a space. | See below |
| PUA glyphs | 102-Cables (Mac): 4 chars | `ได<U+F70B>รับ` | Old Thai fonts use shifted tone-mark glyphs at U+F700–U+F71A | Map back to the real code points |
| Decomposed SARA AM | 102-Cables (Mac): 1 place | `ทํา` (ํ + า) | Same word stored as 2 code points | Replace `ํา` with `ำ` |

The SARA AM bug matters most. Without a fix, every word with ำ (ทำ, นำ, กำหนด, จำนวน, สำคัญ, น้ำ…) is wrong. Embeddings and keyword search in MD-10 would miss these words. The two libraries behave differently:

- **mupdf** keeps the space: `น าเสนอ`. No Thai word starts with า, so "consonant + space + (tone mark) + า" is always this bug, and a regex fixes it. Result: 33/33 fixed in W07 and 69/69 in the corpus.
- **pdf.js** `getTextContent()` drops the space in most places (`นาเสนอ`), so the bug cannot be seen in the text. But the raw glyph stream from `getOperatorList()` still has the space glyph. `saraAmFixesFromGlyphRuns()` finds the broken spots in the glyph stream and fixes them in the text content. Result: 68/69 fixed. The one miss is `กาลัง` on W07 page 20: the glyph order around it differs from the text content order.

After repair, pdf.js and mupdf give the same Thai text on 198 of 199 pages, and the same character count on all 199. No PUA, broken-SARA-AM or orphan-mark problems remain in either engine.

Other notes on text:

- Line order follows the drawing order in the PDF, not always the visual order. For example, the footer can come before the body. This is fine for embeddings.
- Code on slides loses its indentation, because the script joins runs of spaces.
- 11 pages have almost no text layer (101: pages 4, 5, 6, 12, 27, 33; 102: pages 5, 12, 17, 18; W07: page 16). They are photos or pictures of text.

### 4.3 OCR fallback (tesseract.js, tha+eng)

| Page | Time | Confidence | Result compared with the text layer |
| --- | --- | --- | --- |
| W07 p18 | 1.8 s | 91 | Worse. Drops upper vowels and tone marks (`ขึ้น` → `ขีน`, `เพิ่ม` → `เพิม`). Adds noise from shapes. |
| 102 p2 | 0.9 s | 90 | Gets the headline that is a picture (`แพ็กเกจเน็ตบ้าน ที่ให้คุณนำอุปกรณ์ Router…`). Some noise. |
| 101 p6 | 2.6 s | 64 | Photo-only slide. Output is noise. |
| W08 p15 | 4.1 s | 89 | Worse than the text layer. Table columns get mixed. |
| Chapter1 p2 | 2.5 s | 92 | Worse. Drops vowels in large text. |

Worker start takes 9.4 s (the first run also downloads language data from a CDN). OCR is useful only for pages that are pictures of text. Do not use it in place of the text layer.

### 4.4 Processing time and size, 50-slide deck

pdf.js path: load + render + encode + text extraction, at 1920 px wide, one page at a time.

| Deck | Output | Total time | Per slide | Image size | Per slide |
| --- | --- | --- | --- | --- | --- |
| Thai text deck | WebP q80 | 11.2 s | 223 ms | 4.5 MB | 90 KB |
| Thai text deck | JPEG q85 | 6.7 s | 134 ms | 9.3 MB | 185 KB |
| Thai text deck | PNG | ~10 s | ~200 ms | 16.8 MB | 336 KB |
| Thai text deck | WebP q80, 1280 px | ~7.3 s | ~146 ms | 2.7 MB | 54 KB |
| Thai text deck | Text only, no images | 1.5 s | 31 ms | — | — |
| Image-heavy deck | WebP q80 | 13.8 s | 277 ms | 3.7 MB | 74 KB |
| Image-heavy deck | JPEG q85 | 8.9 s | 177 ms | 8.1 MB | 161 KB |
| Image-heavy deck | PNG | ~15 s | ~300 ms | 32.7 MB | 654 KB |

Where the time goes (Thai text deck, WebP): render 4.5 s, WebP encode 5.6 s, text 0.7 s, load 0.1 s. The extracted text is 32 KB for 50 slides, or 114 KB as JSON with the quality fields.

mupdf renders about 2x faster (2.2 s for the Thai deck), but its WASM JPEG encoder is slow (4.9 s). So it is no faster overall, and it has the AGPL licence.

All 8 sample decks (199 pages) take 38.6 s with WebP and give 14.1 MB of images.

### 4.5 Output for MD-10

`data/slides-text.json`, one entry per slide:

```json
{ "deck": "int319-w07-development-of-corporate-strategy-and-plan-ii-workshop-g1",
  "file": "INT319-W07-Development of Corporate Strategy and Plan II (workshop) (G1).pdf",
  "page": 18,
  "text": "18\nExample\nตัวอย่างที่นำเสนอ สร้างขึ้นเพื่อประกอบการสอนวิชา INT 319 …" }
```

`out/slides-text.json` (not committed) also has per-page quality fields, the text from the other engine, and the `lowText` flag.

## 5. Verdict

**Pass with conditions.**

- Images: pass. Output is correct and fast enough for an upload-time background job.
- Text: pass, but only with Thai repair. Without repair, 5 of 8 sample decks have wrong Thai words.
- 50-slide deck: 7–14 s with images, about 1.5 s for text only, on one core. This is fine for a background job after upload. It is not fast enough to run inside the HTTP request.

Conditions:

1. Ship `repairThai()` and the pdf.js glyph-stream fix (or an equal fix) with the importer.
2. Test at least one Google Slides export and one Canva export before Release 1. No sample decks came from these tools, so this part of the ticket is still open.

## 6. Recommendation and open questions

**Recommendation for the ADR (MD-18):**

- Use **pdf.js + @napi-rs/canvas** for rendering and text. Both are permissive licences. The Thai fix works with pdf.js (68/69 here).
- Do not use mupdf in the product unless the team accepts AGPL-3.0. AGPL covers network services, so ModDeck's server code would have to be released under AGPL. Keep it only as a test tool.
- Store slides as **WebP at 1920 px, q80** (about 75–90 KB per slide). Make a 1280 px version only if mobile data use becomes a problem.
- Run the import as a **background job** (queue + worker), and show progress per page. Run a few pages in parallel (worker threads) if import time matters. Render and encode use only one core now.
- Make OCR **optional and limited to `lowText` pages**. Keep the text-layer text where it exists, and add OCR text only where the text layer is empty.
- Keep the per-page quality counters (`checkThai()`) in the importer logs. They show new export problems early.

**Open questions:**

- Google Slides and Canva exports: same SARA AM bug? Canva often exports text as outlines (no text layer), and then only OCR can help. Get 1–2 real decks.
- Is the one missed SARA AM (`กาลัง`) worth more work? An option is to match on the glyph stream with a Thai word list.
- Should the importer also accept `.pptx` directly? Text from `.pptx` XML has no glyph-mapping bugs, but rendering still needs LibreOffice or a PDF step.
- Can extracted slide text be stored in the repo? It comes from instructors' material. For now, only `data/slides-text.json` is meant for commit, and `slides/` is not committed.
- Code indentation: needed for the code-rendering spike (MD-3)? If yes, keep whitespace runs for slides in a monospace font.
