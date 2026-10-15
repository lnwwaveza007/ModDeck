// Smoke test for the mock server, run against a server that is already started.
// A read-only "slide" client joins, a "phone" client votes, and the slide must
// receive vote_update. Prints the vote-to-update time.

import { io } from "socket.io-client";

const BASE = process.env.BASE_URL ?? "http://localhost:3022";
const PIN = "123456";

function client(nickname) {
  const socket = io(BASE, { transports: ["websocket"] });
  return new Promise((resolve, reject) => {
    socket.on("connect", () => socket.emit("join", { pin: PIN, nickname }));
    socket.on("joined", (payload) => resolve({ socket, payload }));
    socket.on("error", (err) => reject(new Error(`${err.code}: ${err.message}`)));
    socket.on("connect_error", reject);
  });
}

function check(label, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) process.exitCode = 1;
}

const poll = await fetch(`${BASE}/api/polls/${PIN}`).then((res) => res.json());
check("GET /api/polls/:pin returns question and options", Boolean(poll.question && poll.options.A));

const qr = await fetch(`${BASE}/api/qr/${PIN}.svg`);
check("QR code is served as SVG", qr.ok && (await qr.text()).startsWith("<svg"));

const slide = await client("slide-view");
const phone = await client("phone");
const before = slide.payload.votes.B;

const update = new Promise((resolve) => slide.socket.once("vote_update", resolve));
const sentAt = performance.now();
phone.socket.emit("vote", { pin: PIN, option: "B" });
const payload = await update;
const ms = (performance.now() - sentAt).toFixed(1);

check("slide receives vote_update after a phone votes", payload.option === "B");
check("count for B goes up by one", payload.votes.B === before + 1);
console.log(`      vote -> slide update: ${ms} ms (local)`);

const badPin = await new Promise((resolve) => {
  const socket = io(BASE, { transports: ["websocket"] });
  socket.on("connect", () => socket.emit("join", { pin: "12", nickname: "bad" }));
  socket.on("error", (err) => {
    socket.close();
    resolve(err.code);
  });
});
check("invalid PIN is rejected with INVALID_PIN", badPin === "INVALID_PIN");

slide.socket.close();
phone.socket.close();
