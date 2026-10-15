# MD-3 spike: Math and code rendering

Prove that classroom LaTeX and code blocks can render in Next.js after they arrive as a WebSocket JSON payload.

Libraries under test: **KaTeX**, **Shiki**, **PrismJS**. Findings: [`FINDINGS.md`](./FINDINGS.md).

## What you should see

- 5 KaTeX formulas, including a 3×3 matrix and a nested Bayes formula
- Python (50+ lines), Java, and SQL, highlighted twice: Shiki and PrismJS
- Render times from the Performance API on the page
- The same payload can be broadcast to a laptop, a phone, and a projector tab

## 0. One-time setup

From the **repo root** (`ModDeck`), with Node.js 22+ and pnpm:

```sh
pnpm install
```

This spike is `spikes/md-3-math-code-rendering`. It is **not** started by `pnpm dev` (that script is reserved for `apps/web` and `apps/api`).

## 1. Start the mock WebSocket server

In terminal A:

```sh
pnpm --filter spike-md-3-math-code-rendering start:ws
```

Leave it running. You should see:

```text
MD-3 mock WebSocket listening on 0.0.0.0:4010
Health: http://localhost:4010/health
Phone WS URL: ws://<your-lan-ip>:4010
```

Check: open http://localhost:4010/health — `{ "ok": true, ... }`.

The server is a small `ws` mock so this spike does not need Redis or the MD-2 Nest app. The JSON shape is what MD-18 will send over Socket.IO later.

## 2. Start the Next.js lab page

In terminal B:

```sh
pnpm --filter spike-md-3-math-code-rendering start:lab
```

Open http://localhost:3010

## 3. Desktop smoke test (2 minutes)

1. Click **Render locally (no socket)**.
2. Confirm all 5 formulas draw (fractions, sqrt, summation, integral, matrix, nested Bayes). None should show raw `LaTeX` source.
3. Confirm the Python block is **50+ lines** (the checklist on the page counts them).
4. Switch **Shiki** / **PrismJS**. Keywords and strings must stay colored in both engines.
5. Switch **Projector** / **Student phone**. Phone is a 390px frame; projector uses larger KaTeX.

Write down the four timings shown (KaTeX, Shiki highlight, PrismJS highlight, Shiki first init).

## 4. WebSocket test (the acceptance path)

1. Click **Connect**. Status must become **Connected**.
2. Click **Send via WebSocket**.
3. The formulas and code must render again. Status shows client count ≥ 1.

### Two-browser check

1. Keep the lab open in Chrome.
2. Open http://localhost:3010 in a second window (or an incognito window).
3. Connect **both** tabs.
4. Press **Send via WebSocket** in one tab.
5. The other tab must render the same 5 formulas and 3 code blocks without a refresh.

That is the proof that content arrived as a WebSocket payload, not as a hardcoded React tree.

## 5. Phone test (same Wi-Fi)

1. On the laptop, note the LAN IPv4 printed by `start:ws` (Windows: `ipconfig`, look for `IPv4 Address` on Wi-Fi).
2. Allow inbound **TCP 3010** and **TCP 4010** in Windows Firewall if the phone cannot connect.
3. On the phone browser open `http://<lan-ip>:3010` (not `localhost`).
4. Set **WebSocket URL** to `ws://<lan-ip>:4010` if it did not auto-fill.
5. Tap **Connect**, then from the laptop tap **Send via WebSocket**.
6. Check:
   - matrix and Bayes formula fit or scroll horizontally without spilling off-screen
   - Python wraps/scrolls; you can read `def fit_ols`
   - KaTeX and highlight finish without a visible stall (timings stay on screen)

Do this on **one low-end Android** and **one iPhone**. Save screenshots of the math block and the Python block on each.

## 6. Projector / 1080p test

1. Fullscreen the lab on the lecture PC (`F11`).
2. Choose **Projector**.
3. Connect + Send via WebSocket (or Render locally if the PC is offline).
4. Stand at the **back of the room**. Check:
   - subscripts on the quadratic formula (`2a`) are readable
   - matrix brackets are not clipped
   - Python at projector size is readable for at least the first 15 lines; scrolling the rest is acceptable
5. Take a photo from the back row.

If type is too small, note that in the findings — it is a CSS/token issue for MD-15, not a library failure.

## 7. Bundle size (optional, for the Shiki vs Prism recommendation)

From the spike folder, with the lab **not** running on port 3010:

```sh
pnpm --filter spike-md-3-math-code-rendering build:lab
```

Copy the **First Load JS** line for `/` from the `next build` table into `FINDINGS.md` (or a PR comment). That number includes KaTeX CSS plus both highlighters because this lab loads both on purpose. Product code will ship **one** highlighter.

## 8. Pass / fail checklist

Copy this into the PR or a chat message:

```text
[ ] 5 KaTeX formulas render (matrix + nested Bayes included)
[ ] Python block is 50+ lines and highlighted
[ ] Java and SQL highlighted in both Shiki and PrismJS
[ ] Payload rendered after WebSocket receive (two tabs, or laptop + phone)
[ ] Low-end Android screenshot
[ ] iPhone screenshot
[ ] 1080p projector / back-of-room photo
[ ] Render times written down
[ ] next build First Load JS written down (optional)
```

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Connect stays on Error | Terminal A is not running `start:ws`. Open http://localhost:4010/health |
| Phone cannot load the page | Use the LAN IP, same Wi-Fi, firewall ports 3010/4010 |
| Phone connects but never updates | WS URL must use the LAN IP, not `localhost` |
| Raw LaTeX on screen | Hard fail: KaTeX did not run. Hard-refresh. Check the browser console |
| Shiki stays blank, Prism works | First Shiki init downloads grammars; wait a few seconds, read the console |
| `pnpm` not found | `corepack enable` then retry, or use the Node.js 22 installer |
