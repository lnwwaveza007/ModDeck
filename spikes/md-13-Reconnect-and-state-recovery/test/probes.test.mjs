import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { io as ioClient } from "socket.io-client";
import { createApp } from "../src/server.mjs";
import { QuizClient } from "../src/client.mjs";
import { Store } from "../src/store.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { timeoutMs = 20000, label = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// PROBE A: QuizClient with DEFAULT backoff, server fully down for ~6 s.
// An answer is submitted mid-outage. Client must auto-rejoin and count it once.
test(
  "probe A: client auto-rejoins after a 6 s full server outage, queued answer counted once",
  { timeout: 40_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "probeA-"));
    const stateFile = join(dir, "state.json");
    let app = await createApp({ port: 0, stateFile });
    const port = app.httpServer.address().port;
    const base = `http://127.0.0.1:${port}`;
    const post = (p, b = {}) =>
      fetch(`${base}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      }).then((r) => r.json());
    const created = await post("/api/sessions");
    const client = new QuizClient({ url: base }); // default backoff [100..1500]
    try {
      const joined = await client.join({ pin: created.pin, nickname: "LongOutage" });
      await post(`/api/sessions/${created.sessionId}/questions`, {
        text: "Q1",
        options: ["A", "B"],
      });
      assert.equal((await client.submitAnswer("q1", "A")).accepted, true);
      await post(`/api/sessions/${created.sessionId}/questions`, {
        text: "Q2",
        options: ["C", "D"],
      });

      await app.close(); // server goes away
      await until(() => !client.connected, { label: "outage noticed" });
      const during = client.submitAnswer("q2", "C");
      await sleep(6000); // stay down ~6 s, client keeps retrying
      assert.equal(client.reconnects, 0, "should not have reconnected while server is down");
      app = await createApp({ port, stateFile });

      await until(() => client.connected && client.reconnects >= 1, { label: "rejoin" });
      assert.equal((await during).accepted, true);
      assert.equal(client.token.userId, joined.token.userId);
      assert.equal(client.you.score, 200);
      assert.equal(client.you.team, joined.you.team);
      const s = app.store.getSession(created.sessionId);
      const total = Object.values(s.participants).reduce(
        (n, p) => n + Object.keys(p.answers).length,
        0,
      );
      assert.equal(total, 2);
    } finally {
      client.close();
      await app.close();
    }
  },
);

// PROBE B: hard crash. SIGKILL right after the server acked an answer.
// Nothing gets a chance to flush on shutdown, so this proves ack => durable.
test(
  "probe B: SIGKILL right after ack, restart, acked answer + score survive",
  { timeout: 30_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "probeB-"));
    const file = join(dir, "state.json");
    await writeFile(file, "{}", "utf8");
    const childPort = 19013 + Math.floor(Math.random() * 400);
    const origin = `http://127.0.0.1:${childPort}`;
    const start = () =>
      spawn(process.execPath, [join(ROOT, "src", "server.mjs")], {
        env: { ...process.env, PORT: String(childPort), STATE_FILE: file },
        cwd: ROOT,
        stdio: "ignore",
      });
    const healthy = async () => {
      const end = Date.now() + 8000;
      while (Date.now() < end) {
        try {
          if ((await fetch(`${origin}/health`)).ok) return;
        } catch {}
        await sleep(50);
      }
      throw new Error("child not healthy");
    };
    const emitAck = (s, ev, p) =>
      new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("ack timeout")), 3000);
        s.emit(ev, p, (a) => {
          clearTimeout(t);
          res(a);
        });
      });
    const connected = (s) =>
      new Promise((res, rej) => {
        s.once("connect", res);
        s.once("connect_error", rej);
      });

    let child = start();
    await healthy();
    const created = await fetch(`${origin}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    const sock = ioClient(origin, { transports: ["websocket"], reconnection: false });
    await connected(sock);
    const joined = await emitAck(sock, "join", {
      pin: created.pin,
      nickname: "Crash",
      loginType: "guest",
    });
    await fetch(`${origin}/api/sessions/${created.sessionId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Q", options: ["yes", "no"] }),
    });
    const ans = await emitAck(sock, "answer", {
      token: joined.token.token,
      questionId: "q1",
      option: "yes",
      answerId: "crash-1",
    });
    assert.equal(ans.accepted, true);
    child.kill("SIGKILL"); // no graceful flush
    await new Promise((r) => child.once("exit", r));

    child = start();
    await healthy();
    const again = ioClient(origin, { transports: ["websocket"], reconnection: false });
    await connected(again);
    const sync = await emitAck(again, "hello", { token: joined.token.token, lastSeq: 0 });
    // retry of the same answerId after the crash must be a duplicate, not a second point award
    const retry = await emitAck(again, "answer", {
      token: joined.token.token,
      questionId: "q1",
      option: "yes",
      answerId: "crash-1",
    });
    again.close();
    sock.close();
    child.kill("SIGKILL");

    assert.equal(sync.ok, true);
    assert.equal(sync.you.score, 100);
    assert.equal(sync.you.answers.q1.option, "yes");
    assert.equal(retry.duplicate, true);
    assert.equal(retry.score, 100);
  },
);

// PROBE C: how many full-file writes does the store do for N changes made back to back?
// (Before write coalescing this was one full-state write per change.)
test("probe C: persistence cost (file writes per change)", { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "probeC-"));
  const store = new Store({ filePath: join(dir, "state.json"), maxEvents: Infinity });
  const s = store.createSession({ pin: "123456" });
  const N = 1000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) store.appendEvent(s, "x", { pad: "y".repeat(200) });
  await store.writing;
  const ms = Date.now() - t0;
  console.log(`PROBE C: ${N} changes -> ${store.writeCount} file writes, ${ms} ms`);
  assert.ok(
    store.writeCount >= 1 && store.writeCount <= 5,
    `expected coalesced writes, got ${store.writeCount}`,
  );
});
