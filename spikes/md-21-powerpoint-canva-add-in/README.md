# MD-21 spike: PowerPoint and Canva add-in

Prove that a ModDeck poll can be shown live on a teacher's slide. The add-in only displays the poll; it does not edit it.

Findings: [`FINDINGS.md`](./FINDINGS.md).

## What is in this folder

| File                | What it is                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| `server.mjs`        | Mock poll server: Socket.IO + in-memory votes. Uses the MD-2 event names                |
| `public/poll.html`  | Read-only poll view. This is what the PowerPoint content add-in shows on the slide      |
| `public/vote.html`  | Phone vote page (opened from the QR code)                                               |
| `manifest.xml`      | PowerPoint content add-in manifest (`ContentApp`, add-in only XML manifest)             |
| `test-smoke.mjs`    | Checks that a vote from one client reaches the slide client                             |

Ports: **3021** HTTPS (PowerPoint loads the add-in from here) · **3022** HTTP (phones vote here).

Seeded polls: PIN **123456** (hash table question) and **654321** (recursion confidence). Restart the server to reset votes.

## 0. One-time setup

From the **repo root**, with Node.js 22+:

```sh
corepack pnpm install
```

Install the Office dev certificate (Windows asks you to trust a local certificate; say yes):

```sh
corepack pnpm --filter spike-md-21-powerpoint-canva-add-in certs
```

## 1. Start the server

```sh
corepack pnpm --filter spike-md-21-powerpoint-canva-add-in start
```

You should see the HTTPS line and a phone vote URL with your Wi-Fi IP. If HTTPS says "disabled", the certificate step did not run.

Quick check in a browser: https://localhost:3021/poll.html?pin=123456 and http://localhost:3022/vote.html?pin=123456 in two windows. Vote; the bars must move.

Smoke test (server must be running):

```sh
corepack pnpm --filter spike-md-21-powerpoint-canva-add-in test:smoke
```

## 2. Sideload into PowerPoint

**Windows desktop:**

```sh
corepack pnpm --filter spike-md-21-powerpoint-canva-add-in sideload
```

PowerPoint opens. Go to **Home → Add-ins** (or **Insert → My Add-ins**) and pick **ModDeck Poll (MD-21 spike)** from the developer add-ins. Stop with the `unload` script.

**PowerPoint on the web:** open a deck at office.com → **Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in** → choose `manifest.xml`. The browser must trust the dev certificate from step 0.

## 3. Test checklist

Insert the add-in on a slide, type PIN `123456`, press **Show poll**.

1. **Edit view:** the question, four bars, the QR code and PIN show. "Change poll" is visible.
2. **Slideshow (F5):** the poll still shows and "Change poll" is hidden. Scan the QR code with a phone, vote, and watch the bar move on the slide.
3. **Live while presenting:** vote from a second phone or a browser tab. Count how long the update takes by eye (it should feel instant).
4. **Reopen:** save the deck, close PowerPoint, start the server again, reopen the deck. The same poll (PIN 123456) must come back without typing the PIN.
5. **Two polls:** add a second slide with PIN `654321`. Each slide keeps its own poll.
6. **Server down:** stop the server during slideshow. The status pill turns red ("reconnecting"). Start it again; it goes back to "live".
7. Repeat 2–4 on **PowerPoint on the web**. Mac if you can get one.

Take a screenshot or short clip of steps 2 and 4 for `FINDINGS.md`.

## Phones

The phone must reach the laptop. On the same Wi-Fi, the QR code points at `http://<wifi-ip>:3022`. Allow inbound **TCP 3022** in Windows Firewall if the phone cannot load it.

Campus Wi-Fi often blocks device-to-device traffic. Then use a tunnel and tell the server its URL:

```sh
ngrok http 3022
# PowerShell
$env:PUBLIC_URL = "https://<your-ngrok-id>.ngrok-free.app"; corepack pnpm --filter spike-md-21-powerpoint-canva-add-in start
```

The QR code on the slide then points at the tunnel. PowerPoint itself still loads from `https://localhost:3021`.

## Troubleshooting

| Symptom                                   | What to do                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Add-in shows a blank box or "can't load"  | Server not running, or HTTPS disabled. Open https://localhost:3021/health          |
| Add-in not in the list                    | Run `sideload` again, or restart PowerPoint                                        |
| Status pill stays "connecting"            | Socket.IO blocked. Open the add-in's dev tools (right-click → Inspect if enabled)  |
| Phone cannot open the vote page           | Same Wi-Fi? Firewall port 3022? Otherwise use `PUBLIC_URL` with a tunnel           |
| "Poll not found"                          | Only PINs 123456 and 654321 exist in the mock                                      |
