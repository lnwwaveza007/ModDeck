import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { io as ioClient } from "socket.io-client";
import { createApp } from "../src/server.mjs";
import { QuizClient } from "../src/client.mjs";
import { COOKIE_NAME, serializeSessionCookie } from "../src/cookie.mjs";

/* ==========================================================================
 * PART 1: High-level client tests (from extra_test.mjs)
 * Uses the QuizClient wrapper and a fresh server per test.
 * ========================================================================== */

// Starts a fresh server + session, with helpers to restart/stop it.
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "theirs-"));
  const stateFile = join(dir, "state.json");
  let app = await createApp({ port: 0, stateFile });
  const port = app.httpServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const created = await post("/api/sessions");
  const env = {
    base,
    port,
    stateFile,
    created,
    post,
    get app() {
      return app;
    },
    answersTotal() {
      const s = app.store.getSession(created.sessionId);
      return Object.values(s.participants).reduce((n, p) => n + Object.keys(p.answers).length, 0);
    },
    async restart() {
      await app.close();
      app = await createApp({ port, stateFile });
    },
    async stop() {
      await app.close();
    },
  };
  return env;
}

// Polls until fn() is truthy, or throws on timeout.
async function until(fn, { timeoutMs = 8000, label = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for ${label}`);
}

// Tests: after the server force-drops sockets, the client auto-reconnects
// and gets back its identity, score, team, answers, and missed events.
test("auto rejoin after network drop restores answers, score, team", async () => {
  const env = await setup();
  const client = new QuizClient({ url: env.base });
  try {
    const joined = await client.join({ pin: env.created.pin, nickname: "Auto" });
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q1",
      options: ["A", "B"],
    });
    assert.equal((await client.submitAnswer("q1", "A")).accepted, true);
    env.app.io.disconnectSockets(true);
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q2 while dropped",
      options: ["C", "D"],
    });
    await until(() => client.reconnects >= 1 && client.connected, { label: "auto rejoin" });
    assert.equal(client.token.userId, joined.token.userId);
    assert.equal(client.snapshot.question.text, "Q2 while dropped");
    assert.equal(client.you.score, 100);
    assert.equal(client.you.team, joined.you.team);
    assert.equal(client.you.answers.q1.option, "A");
    assert.equal(client.lastSeq, env.app.store.getSession(env.created.sessionId).seq);
  } finally {
    client.close();
    await env.stop();
  }
});

// Tests: an answer submitted while offline is queued, sent on reconnect,
// and counted exactly once, even if the same answerId is re-sent (lost ack).
test("offline answer queued, flushed on rejoin, counted once (incl. lost-ack retry)", async () => {
  const env = await setup();
  const client = new QuizClient({ url: env.base });
  try {
    await client.join({ pin: env.created.pin, nickname: "Offline" });
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q1",
      options: ["A", "B"],
    });
    client.goOffline();
    const pending = client.submitAnswer("q1", "A");
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(client.pending.length, 1);
    const id = client.pending[0].answerId;
    client.goOnline();
    const ack = await pending;
    assert.equal(ack.accepted, true);
    const dupe = await client._emit("answer", {
      token: client.token.token,
      questionId: "q1",
      option: "A",
      answerId: id,
    });
    assert.equal(dupe.duplicate, true);
    assert.equal(dupe.score, 100);
    assert.equal(env.answersTotal(), 1);
  } finally {
    client.close();
    await env.stop();
  }
});

// Tests: the whole API server restarts while a client is live; the client
// auto-rejoins and an answer sent during the outage is still counted once.
test("api restart with live client: auto rejoin, answer sent during outage counted once", async () => {
  const env = await setup();
  const client = new QuizClient({ url: env.base, backoffMs: [50, 100, 200, 400] });
  try {
    await client.join({ pin: env.created.pin, nickname: "Restart" });
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q1",
      options: ["A", "B"],
    });
    await client.submitAnswer("q1", "A");
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q2",
      options: ["C", "D"],
    });
    const restarting = env.restart();
    await until(() => !client.connected, { label: "outage noticed" });
    const during = client.submitAnswer("q2", "C");
    await restarting;
    await until(() => client.connected && client.reconnects >= 1, { label: "rejoin" });
    assert.equal((await during).accepted, true);
    assert.equal(client.you.score, 200);
    assert.equal(env.answersTotal(), 2);
  } finally {
    client.close();
    await env.stop();
  }
});

// Tests: retrying an already-accepted answer after the question has moved on
// returns a harmless "duplicate" response instead of an error.
test("RETRY OF AN ALREADY-ACCEPTED ANSWER after the question moved on returns duplicate (not an error)", async () => {
  const env = await setup();
  const client = new QuizClient({ url: env.base });
  try {
    await client.join({ pin: env.created.pin, nickname: "LostAck" });
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q1",
      options: ["A", "B"],
    });
    const first = await client.submitAnswer("q1", "A");
    assert.equal(first.accepted, true);
    const id = first.answerId ?? Object.values(client.you.answers)[0].answerId;
    // ack was "lost": the question advances, then the client retries the same answerId
    await env.post(`/api/sessions/${env.created.sessionId}/questions`, {
      text: "Q2",
      options: ["C", "D"],
    });
    const retry = await client._emit("answer", {
      token: client.token.token,
      questionId: "q1",
      option: "A",
      answerId: id,
    });
    assert.equal(retry.ok, true, `server replied ${JSON.stringify(retry)}`);
    assert.equal(retry.duplicate, true);
    assert.equal(env.answersTotal(), 1);
  } finally {
    client.close();
    await env.stop();
  }
});

// Tests: crash safety. The state file must never be readable in a
// half-written state (write to .tmp then atomic rename).
test("state file is never observed half-written while the server persists (crash safety)", async () => {
  const { Store } = await import("../src/store.mjs");
  const dir = await mkdtemp(join(tmpdir(), "torn-"));
  const file = join(dir, "state.json");
  // maxEvents: Infinity so the log cap does not shrink the ~1 MB file this test needs to stress atomic writes
  const store = new Store({ filePath: file, maxEvents: Infinity });
  const s = store.createSession({ pin: "123456" });
  for (let i = 0; i < 4000; i++) store.appendEvent(s, "x", { pad: "y".repeat(200) }); // about 1 MB
  await store.writing;
  let torn = 0,
    stop = false;
  const reader = (async () => {
    while (!stop) {
      try {
        JSON.parse(await readFile(file, "utf8"));
      } catch {
        torn++;
      }
      await new Promise((r) => setImmediate(r));
    }
  })();
  for (let i = 0; i < 40; i++) {
    store.persistSoon();
    await store.writing;
  }
  stop = true;
  await reader;
  assert.equal(torn, 0, `${torn} reads saw a partial state file (write to .tmp then rename)`);
});

/* ==========================================================================
 * PART 2: Low-level socket/cookie reconnect tests (from reconnect_test.mjs)
 * Uses raw socket.io clients against one shared server for the whole group.
 * Wrapped in describe() so the shared before/after hooks only apply here.
 * ========================================================================== */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const quick = process.env.MD13_QUICK === "1";
const DROPS_MS = quick ? [200, 500, 1000] : [5_000, 30_000, 120_000];

let port = 0;
let app;
let stateFile;
let base;

async function tmpState() {
  const dir = await mkdtemp(join(tmpdir(), "md13-"));
  return join(dir, "state.json");
}

async function httpJson(method, path, { body, cookie } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), setCookie: res.headers.get("set-cookie") };
}

function connect({ cookie } = {}) {
  return ioClient(base, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: cookie ? { Cookie: cookie } : {},
  });
}

function emitAck(socket, event, payload, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function waitConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function cookieFromToken(token) {
  return serializeSessionCookie(token);
}

// Join, answer, disconnect, miss a question, wait dropMs, then reconnect with
// the session cookie and verify state is restored and missed events replayed.
async function dropAndRejoin(dropMs, label) {
  const created = await httpJson("POST", "/api/sessions", {});
  const socket = connect();
  await waitConnect(socket);
  const joined = await emitAck(socket, "join", {
    pin: created.data.pin,
    nickname: `Drop-${label}`,
    loginType: "guest",
  });
  const firstQuestion = await httpJson(
    "POST",
    `/api/sessions/${created.data.sessionId}/questions`,
    {
      body: { text: "Q1", options: ["A", "B"] },
    },
  );
  const answered = await emitAck(socket, "answer", {
    token: joined.token.token,
    questionId: firstQuestion.data.question.id,
    option: "A",
    answerId: `offline-prep-${label}`,
  });
  assert.equal(answered.accepted, true);
  assert.equal(answered.score, 100);
  const lastSeqBeforeDrop = answered.lastSeq;

  socket.disconnect();
  await httpJson("POST", `/api/sessions/${created.data.sessionId}/questions`, {
    body: { text: "Q2 while offline", options: ["C", "D"] },
  });
  await new Promise((r) => setTimeout(r, dropMs));

  const cookie = cookieFromToken({ ...joined.token, lastSeq: lastSeqBeforeDrop });
  const again = connect({ cookie });
  await waitConnect(again);
  const sync = await emitAck(again, "hello", {
    token: joined.token.token,
    lastSeq: lastSeqBeforeDrop,
  });
  again.close();

  assert.equal(sync.ok, true);
  assert.equal(sync.sessionId, joined.sessionId);
  assert.equal(sync.you.score, 100);
  assert.equal(sync.you.team, joined.you.team);
  assert.equal(sync.you.answers[firstQuestion.data.question.id].option, "A");
  assert.equal(sync.snapshot.question.text, "Q2 while offline");
  assert.ok(sync.missed.some((e) => e.type === "question_shown" && e.seq > lastSeqBeforeDrop));
  return { created, joined, lastSeqBeforeDrop, sync };
}

describe("socket reconnect & session cookie", () => {
  before(async () => {
    stateFile = await tmpState();
    app = await createApp({ port: 0, stateFile });
    port = app.httpServer.address().port;
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await app.close();
  });

  // Tests: joining as a guest returns a token (userId, sessionId, lastSeq,
  // loginType) and a valid session cookie.
  test("guest join stores userId, sessionId, and lastSeq in the session cookie", async () => {
    const created = await httpJson("POST", "/api/sessions", {});
    const socket = connect();
    await waitConnect(socket);
    const joined = await emitAck(socket, "join", {
      pin: created.data.pin,
      nickname: "Ava",
      loginType: "guest",
    });
    socket.close();
    assert.equal(joined.ok, true);
    assert.equal(joined.token.userId, joined.you.userId);
    assert.equal(joined.token.sessionId, joined.sessionId);
    assert.equal(typeof joined.token.lastSeq, "number");
    assert.equal(joined.token.loginType, "guest");
    assert.equal(joined.cookieName, COOKIE_NAME);
    assert.match(cookieFromToken(joined.token), new RegExp(`^${COOKIE_NAME}=`));
  });

  // Tests: every event the server emits carries a seq, type, and timestamp,
  // and sequence numbers arrive in non-decreasing order.
  test("every server event has a monotonic sequence number", async () => {
    const created = await httpJson("POST", "/api/sessions", {});
    const socket = connect();
    await waitConnect(socket);
    const joined = await emitAck(socket, "join", { pin: created.data.pin, nickname: "Seq" });
    const events = [];
    socket.on("event", (e) => events.push(e));
    await httpJson("POST", `/api/sessions/${created.data.sessionId}/questions`, {
      body: { text: "2+2?", options: ["4", "3", "5"] },
    });
    await emitAck(socket, "answer", {
      token: joined.token.token,
      questionId: "q1",
      option: "4",
      answerId: "ans-seq-1",
    });
    await new Promise((r) => setTimeout(r, 50));
    socket.close();
    assert.ok(events.length >= 2);
    for (const event of events) {
      assert.equal(typeof event.seq, "number");
      assert.ok(event.seq >= 1);
      assert.ok(event.type);
      assert.ok(event.at);
    }
    const seqs = events.map((e) => e.seq);
    assert.deepEqual(
      seqs,
      [...seqs].sort((a, b) => a - b),
    );
  });

  // Tests: reconnecting after a 5 s drop restores answers, score, and team.
  test(
    `reconnect after 5 s drop restores answers, score, and team`,
    { timeout: DROPS_MS[0] + 10_000 },
    async () => {
      await dropAndRejoin(DROPS_MS[0], "5s");
    },
  );

  // Tests: same as above, after a 30 s drop.
  test(
    `reconnect after 30 s drop restores answers, score, and team`,
    { timeout: DROPS_MS[1] + 10_000 },
    async () => {
      await dropAndRejoin(DROPS_MS[1], "30s");
    },
  );

  // Tests: same as above, after a 2 min drop.
  test(
    `reconnect after 2 min drop restores answers, score, and team`,
    { timeout: DROPS_MS[2] + 10_000 },
    async () => {
      await dropAndRejoin(DROPS_MS[2], "2m");
    },
  );

  // Tests: answer idempotency. The same answerId (retry) or a different
  // answerId for the same question is flagged duplicate and counted once.
  test("answer submitted while offline is retried and counted once", async () => {
    const created = await httpJson("POST", "/api/sessions", {});
    const socket = connect();
    await waitConnect(socket);
    const joined = await emitAck(socket, "join", { pin: created.data.pin, nickname: "Retry" });
    const q = await httpJson("POST", `/api/sessions/${created.data.sessionId}/questions`, {
      body: { text: "Pick A", options: ["A", "B"] },
    });
    socket.disconnect();

    const answerId = "client-generated-id-1";
    const payload = {
      token: joined.token.token,
      questionId: q.data.question.id,
      option: "A",
      answerId,
    };

    const again = connect();
    await waitConnect(again);
    await emitAck(again, "hello", { token: joined.token.token, lastSeq: joined.token.lastSeq });
    const first = await emitAck(again, "answer", payload);
    const retry = await emitAck(again, "answer", payload);
    const otherId = await emitAck(again, "answer", { ...payload, answerId: "different-id" });
    again.close();

    assert.equal(first.ok, true);
    assert.equal(first.accepted, true);
    assert.equal(first.duplicate, false);
    assert.equal(first.score, 100);
    assert.equal(first.tally.A, 1);

    assert.equal(retry.ok, true);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.accepted, false);
    assert.equal(retry.score, 100);
    assert.equal(retry.tally.A, 1);

    assert.equal(otherId.duplicate, true);
    assert.equal(otherId.tally.A, 1);
  });

  // Tests: after a session ends, the guest cookie is cleared (Max-Age=0)
  // while an SSO user's cookie is kept and gets SESSION_ENDED on hello.
  test("guest cookie is cleared after session end; SSO cookie is kept", async () => {
    const created = await httpJson("POST", "/api/sessions", {});
    const guestSock = connect();
    await waitConnect(guestSock);
    const guest = await emitAck(guestSock, "join", {
      pin: created.data.pin,
      nickname: "GuestOne",
      loginType: "guest",
    });
    guestSock.close();

    const ssoSock = connect();
    await waitConnect(ssoSock);
    const sso = await emitAck(ssoSock, "join", {
      pin: created.data.pin,
      nickname: "SsoOne",
      loginType: "sso",
    });
    ssoSock.close();

    const guestEnd = await httpJson("POST", `/api/sessions/${created.data.sessionId}/end`, {
      cookie: cookieFromToken(guest.token),
    });
    assert.match(guestEnd.setCookie, /Max-Age=0/);

    const ssoCookie = cookieFromToken(sso.token);
    assert.doesNotMatch(ssoCookie, /Max-Age=0/);
    const helloSso = connect({ cookie: ssoCookie });
    await waitConnect(helloSso);
    const ended = await emitAck(helloSso, "hello", {
      token: sso.token.token,
      lastSeq: sso.token.lastSeq,
    });
    helloSso.close();
    assert.equal(ended.code, "SESSION_ENDED");
    assert.equal(ended.clearGuestCookie, false);
  });

  // Tests: a real server process is killed (SIGTERM) and restarted; the
  // client's hello restores the same session, score, team, and answers from disk.
  test(
    "api process restart: client hello restores the same session from disk",
    { timeout: 20_000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "md13-re-"));
      const file = join(dir, "state.json");
      await writeFile(file, "{}", "utf8");
      const childPort = 18013 + Math.floor(Math.random() * 400);

      function startChild() {
        return spawn(process.execPath, [join(ROOT, "src", "server.mjs")], {
          env: { ...process.env, PORT: String(childPort), STATE_FILE: file },
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }

      async function waitHealth() {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          try {
            const res = await fetch(`http://127.0.0.1:${childPort}/health`);
            if (res.ok) return;
          } catch {
            // still booting
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("child did not become healthy");
      }

      let child = startChild();
      const childErr = [];
      child.stderr.on("data", (d) => childErr.push(d.toString()));
      await waitHealth();

      const origin = `http://127.0.0.1:${childPort}`;
      const created = await fetch(`${origin}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((r) => r.json());
      const socket = ioClient(origin, { transports: ["websocket"], reconnection: false });
      await waitConnect(socket);
      const joined = await emitAck(socket, "join", {
        pin: created.pin,
        nickname: "Persist",
        loginType: "guest",
      });
      await fetch(`${origin}/api/sessions/${created.sessionId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Survive restart?", options: ["yes", "no"] }),
      });
      const ans = await emitAck(socket, "answer", {
        token: joined.token.token,
        questionId: "q1",
        option: "yes",
        answerId: "persist-1",
      });
      assert.equal(ans.score, 100);
      socket.close();

      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));

      child = startChild();
      await waitHealth();
      const again = ioClient(origin, { transports: ["websocket"], reconnection: false });
      await waitConnect(again);
      const sync = await emitAck(again, "hello", {
        token: joined.token.token,
        lastSeq: ans.lastSeq,
      });
      again.close();
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));

      assert.equal(sync.ok, true, childErr.join(""));
      assert.equal(sync.you.score, 100);
      assert.equal(sync.you.team, joined.you.team);
      assert.equal(sync.you.nickname, "Persist");
      assert.equal(sync.you.answers.q1.option, "yes");
    },
  );
});
