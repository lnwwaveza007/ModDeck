// MD-21 mock poll server.
// One process serves the slide's poll view, the phone vote page, and Socket.IO.
// Event names and payloads follow the MD-2 schema (join, vote, reset_votes,
// joined, user_joined, vote_update, error), so the poll view can point at the
// real MD-2 gateway later. Votes live in memory; restart the server to reset.

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces, homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Server } from "socket.io";

const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3021);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 3022);
const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));
const CERT_DIR = join(homedir(), ".office-addin-dev-certs");
const PIN_RE = /^\d{6}$/;

const polls = new Map([
  [
    "123456",
    {
      question: "Which data structure gives O(1) average lookup by key?",
      options: { A: "Linked list", B: "Hash table", C: "Binary search tree", D: "Sorted array" },
    },
  ],
  [
    "654321",
    {
      question: "How confident are you with recursion?",
      options: { A: "Very", B: "Somewhat", C: "Not yet", D: "Lost" },
    },
  ],
]);
for (const poll of polls.values()) {
  poll.votes = Object.fromEntries(Object.keys(poll.options).map((key) => [key, 0]));
}

// Prefer Wi-Fi: virtual adapters (VirtualBox, Hyper-V, WSL) come first on many
// laptops but phones cannot reach them.
function lanAddress() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? [])
      .filter((net) => net.family === "IPv4" && !net.internal)
      .map((net) => ({ name, ...net })),
  );
  const wifi = candidates.find((net) => /wi-?fi|wlan/i.test(net.name));
  const real = candidates.find((net) => !/virtual|vethernet|vmware|wsl|docker/i.test(net.name));
  return (wifi ?? real ?? candidates[0])?.address ?? "localhost";
}

// Base URL that phones use. Set PUBLIC_URL to a tunnel (for example ngrok)
// when the phone cannot reach the laptop over the LAN.
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://${lanAddress()}:${HTTP_PORT}`).replace(
  /\/$/,
  "",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function handle(req, res) {
  const url = new URL(req.url, "http://local");
  const path = url.pathname;

  if (path === "/health") return send(res, 200, { ok: true, publicUrl: PUBLIC_URL });

  // The poll view reports how long each load step took, so slide-load delay
  // can be read in this terminal during slideshow.
  if (path === "/api/log" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { pin, view, marks } = JSON.parse(body);
      const steps = Object.entries(marks)
        .map(([name, ms]) => `${name} ${Math.round(ms)}ms`)
        .join(" | ");
      console.log(`[load] pin=${pin ?? "-"} view=${view ?? "-"} ${steps}`);
    } catch {
      // Ignore malformed reports.
    }
    return send(res, 204, "");
  }

  const pollMatch = path.match(/^\/api\/polls\/(\d{6})$/);
  if (pollMatch) {
    const pin = pollMatch[1];
    const poll = polls.get(pin);
    if (!poll) return send(res, 404, { code: "ROOM_NOT_FOUND", message: "No poll for this PIN" });
    const voteUrl = `${PUBLIC_URL}/vote.html?pin=${pin}`;
    return send(res, 200, {
      pin,
      question: poll.question,
      options: poll.options,
      votes: poll.votes,
      voteUrl,
      // Inline so the poll view can cache it in the deck and draw it offline.
      qrSvg: await QRCode.toString(voteUrl, { type: "svg", margin: 0 }),
    });
  }

  const qrMatch = path.match(/^\/api\/qr\/(\d{6})\.svg$/);
  if (qrMatch) {
    const svg = await QRCode.toString(`${PUBLIC_URL}/vote.html?pin=${qrMatch[1]}`, {
      type: "svg",
      margin: 1,
    });
    return send(res, 200, svg, MIME[".svg"]);
  }

  const file = path === "/" ? "/index.html" : path;
  const full = join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !existsSync(full))
    return send(res, 404, { code: "NOT_FOUND" });
  return send(res, 200, readFileSync(full), MIME[extname(full)] ?? "application/octet-stream");
}

function onRequest(req, res) {
  handle(req, res).catch((err) => send(res, 500, { code: "SERVER_ERROR", message: err.message }));
}

const servers = [createHttpServer(onRequest)];
const certFile = join(CERT_DIR, "localhost.crt");
const keyFile = join(CERT_DIR, "localhost.key");
const hasCerts = existsSync(certFile) && existsSync(keyFile);
if (hasCerts) {
  servers.push(
    createHttpsServer({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, onRequest),
  );
}

const io = new Server({ cors: { origin: "*" } });
for (const server of servers) io.attach(server);

io.on("connection", (socket) => {
  const fail = (code, message) => socket.emit("error", { code, message });

  socket.on("join", ({ pin, nickname } = {}) => {
    if (!PIN_RE.test(String(pin)))
      return fail("INVALID_PIN", "Room PIN must be exactly 6 digits (e.g., 123456)");
    const poll = polls.get(pin);
    if (!poll) return fail("ROOM_NOT_FOUND", "No poll for this PIN");
    socket.join(pin);
    socket.emit("joined", { pin, nickname, votes: poll.votes });
    socket.to(pin).emit("user_joined", { pin, nickname, socketId: socket.id });
  });

  socket.on("vote", ({ pin, option } = {}) => {
    const poll = polls.get(String(pin));
    if (!poll) return fail("ROOM_NOT_FOUND", "No poll for this PIN");
    if (!(option in poll.votes)) return fail("INVALID_OPTION", "Unknown option");
    poll.votes[option] += 1;
    io.to(String(pin)).emit("vote_update", {
      pin,
      option,
      votes: poll.votes,
      timestamp: Date.now(),
    });
  });

  socket.on("reset_votes", ({ pin } = {}) => {
    const poll = polls.get(String(pin));
    if (!poll) return fail("ROOM_NOT_FOUND", "No poll for this PIN");
    for (const key of Object.keys(poll.votes)) poll.votes[key] = 0;
    io.to(String(pin)).emit("vote_update", {
      pin,
      option: null,
      votes: poll.votes,
      timestamp: Date.now(),
    });
  });
});

servers[0].listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`MD-21 mock poll server`);
  console.log(`HTTP  (phones): http://localhost:${HTTP_PORT}`);
  console.log(`Phone vote URL: ${PUBLIC_URL}/vote.html?pin=123456`);
});
if (hasCerts) {
  servers[1].listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log(`HTTPS (add-in): https://localhost:${HTTPS_PORT}/poll.html?pin=123456`);
  });
} else {
  console.log(`HTTPS disabled: no dev certs in ${CERT_DIR}. Run the "certs" script first.`);
}
