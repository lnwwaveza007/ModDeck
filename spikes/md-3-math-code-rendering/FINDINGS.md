# Spike Findings Note: MD-3 Math and code rendering

- **Ticket:** MD-3
- **Track:** Spike (Technical Feasibility)
- **Status:** Lab ready — desktop/WebSocket path is implemented; phone and projector still need a teammate to run the checklist in `README.md`
- **Date:** October 15, 2026
- **Authors:** ModDeck Team

---

## 1. Goal and pass criteria

### Goal

Prove that Next.js can render classroom LaTeX (KaTeX) and programming samples (Shiki and PrismJS) when the source arrives as a WebSocket JSON payload, fast enough for a student phone and a 1080p projector.

### Acceptance criteria

- [x] Complex LaTeX (3×3 matrix + nested Bayes) and a 50+ line Python block are in the payload and render through KaTeX / Shiki / PrismJS
- [x] The same payload can be sent over a WebSocket (`ws` mock on port 4010) and applied on receive
- [ ] Tested on a low-end Android phone, an iPhone, and a 1080p projector *(teammate run — see `README.md` §5–6)*
- [x] Render-time hooks (Performance API) and a `next build` script are on the lab page
- [x] Shiki vs PrismJS recommendation (below)
- [x] Findings note written

**Verdict: feasible.** Math and code are strings in a JSON event. KaTeX and either highlighter turn those strings into HTML in the browser. Nothing in the ModDeck stack blocks this. What remains is visual QA in a real room, not a library risk.

---

## 2. Setup

| Item | Value |
| --- | --- |
| Lab UI | Next.js 16.3.8 + React 19.2.8 (same generation as `apps/web`) |
| Math | `katex` 0.16, `renderToString`, display mode |
| Code A | `shiki` 3, `createHighlighter`, theme `github-light`, langs `python` / `java` / `sql` |
| Code B | `prismjs` 1.30, default light theme, same three languages |
| Transport | Mock `ws` server `server.mjs` on `0.0.0.0:4010` (does **not** need Redis or MD-2) |
| Ports | Lab http://localhost:3010 · WS ws://localhost:4010 |
| Test content | `src/lib/fixtures.ts` — 5 formulas, 3 code blocks, Python 50+ lines |

How to run: [`README.md`](./README.md).

### Payload shape (client → server → all clients)

```json
{
  "type": "slide",
  "title": "MD-3 · Math and code rendering",
  "sentAt": "2026-10-15T00:00:00.000Z",
  "math": [{ "id": "quadratic", "label": "…", "latex": "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}" }],
  "code": [{ "id": "python-ols", "label": "…", "lang": "python", "source": "def fit_ols(...):\n  ..." }]
}
```

MD-18 should keep **source** on the wire (`latex`, `lang`, `source`), not pre-baked HTML, until we decide to highlight on the server. The mock server only broadcasts JSON.

---

## 3. Method

1. Fixtures cover the ticket list: quadratic, summation, Gaussian integral, 3×3 matrix, nested Bayes; Python 50+ lines, Java, SQL.
2. The lab page renders KaTeX always, and Shiki or PrismJS from a toggle.
3. **Render locally** uses the same `renderPayload()` as a socket message, so a missing WS server cannot fake a different code path.
4. **Send via WebSocket** JSON.stringifies that payload, the server broadcasts it, every connected tab (laptop, phone, projector) runs `renderPayload` on `message`.
5. Timings use `performance.now()` around `katex.renderToString` and around `codeToHtml` / `Prism.highlight`. Shiki first `createHighlighter()` is timed separately because it is the expensive step.
6. Bundle: `pnpm --filter spike-md-3-math-code-rendering build:lab` prints First Load JS. This lab **intentionally loads both** highlighters, so the number is a ceiling, not the production budget.

---

## 4. Results

### 4.1 Correctness (lab)

| Case | Result |
| --- | --- |
| Quadratic, sum, integral | KaTeX HTML (fractions, roots, limits) |
| 3×3 matrix | `pmatrix` |
| Nested Bayes | Nested `\frac` + product + `\mathcal{N}` |
| Python 50+ lines | Scrollable `<pre>` / Shiki HTML, highlight on keywords |
| Java generics / annotations | Both engines color `public`, types, strings |
| SQL keywords | `SELECT` / `JOIN` / `HAVING` |

KaTeX can also run at request time on the server (it is a pure string transform). This spike runs it on the client because WS content is client-received.

### 4.2 Timing (fill in from the page)

Recorded on: **\_\_\_\_** (device / browser).

| Step | ms | Budget (working) |
| --- | --- | --- |
| KaTeX, 5 formulas | | well under 50 ms on a laptop |
| PrismJS, 3 blocks including 50+ line Python | | typically a few ms, synchronous |
| Shiki highlight after init | | typically low tens of ms |
| Shiki `createHighlighter` (once per tab) | | the spike’s slow step (grammars + engine) |

Working budget: keep **per-message** work (KaTeX + highlight) in the same range as other live UI, around **150 ms** on a student phone. **Do not** construct a new Shiki highlighter per event.

### 4.3 Bundle (fill in from `build:lab`)

| Build | First Load JS for `/` |
| --- | --- |
| This lab (KaTeX + Shiki + Prism) | |

Production must ship **KaTeX + one highlighter**, or ship highlighted HTML and skip the highlighter on the phone.

### 4.4 Devices (teammate)

| Device | Math readable | 50-line code readable | Jank on WS receive | Screenshot |
| --- | --- | --- | --- | --- |
| Low-end Android | | | | |
| iPhone | | | | |
| 1080p projector, back row | | | | |

---

## 5. Recommendation

### Math: KaTeX (not MathJax)

Use KaTeX for every student- and projector-facing formula (slides, poll questions, Q&A). It is fast, CSS-based, and already proven in this lab. Keep `throwOnError: false` so a bad student formula cannot blank the page. Sanitize untrusted LaTeX later in MD-18 if students type math.

### Code: Shiki on the server / at ingest; PrismJS only if we must highlight on the phone

| | Shiki | PrismJS |
| --- | --- | --- |
| Look (projector) | VS Code / TextMate, better for lecturers | Good enough, weaker grammars |
| First cost | High (init highlighter) | Low |
| Per-block cost | Fine after init | Fine |
| Bundle on the phone | Heavy if we ship grammars | Small |
| SSR / Node | Excellent | Fine |

**Product default: Shiki, but not in every student browser.**

1. Instructor-authored content (imported slides, poll/quiz stems, prepared snippets): highlight **once** with Shiki when the content is saved or when the API is about to broadcast. Send HTML (or HTML + source) to clients. Phones only paint.
2. If a live student message must be highlighted on-device, use **PrismJS** with a short language list, or show a plain `<pre>` until idle.
3. Do **not** call `createHighlighter()` per WebSocket event.
4. Theme: **light** (`github-light` / Prism default). Dark code on a projector washes out in a bright KMUTT room (same reason as the design-system tokens).

This matches MD-15 (hi-fi) and MD-18 (implementation): KaTeX + Shiki in the content pipeline, PrismJS as a fallback only.

---

## 6. Risks for later tickets

- **Untrusted LaTeX / HTML:** `dangerouslySetInnerHTML` is acceptable for this spike’s fixtures. Production needs a sanitizer if students submit math or if we broadcast Shiki HTML.
- **Language set:** lock a list (Python, Java, SQL, JS/TS, C, maybe Verilog). Do not load every Shiki grammar on a phone.
- **Long Python on a phone:** scroll, do not shrink below readable size. Projector CSS in this lab is the starting point for MD-15.
- **MD-2 Socket.IO:** swap `new WebSocket` for `socket.emit('slide', payload)` without changing `math[]` / `code[]`.

---

## 7. Files

| Path | Role |
| --- | --- |
| `src/lib/fixtures.ts` | 5 formulas + 3 code blocks |
| `src/lib/render.ts` | KaTeX / Shiki / Prism helpers + `performance.now` |
| `src/app/lab-client.tsx` | Connect, send, timings, projector/phone frames |
| `server.mjs` | Mock WS + `POST /broadcast` + `GET /health` |
| `README.md` | Step-by-step teammate test |
