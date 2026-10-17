import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as ioClient } from "socket.io-client";
import { createApp } from "../src/server.mjs";
import { QuizClient } from "../src/client.mjs";
import { Store, DEFAULT_TOKEN_TTL_MS } from "../src/store.mjs";
import { serializeSessionCookie } from "../src/cookie.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeoutMs = 8000, label = "condition" } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label}`);
}
async function tmpFile(prefix = "fix-") {
  return join(await mkdtemp(join(tmpdir(), prefix)), "state.json");
}
async function startApp(storeOptions = {}) {
  const stateFile = await tmpFile();
  const app = await createApp({ port: 0, stateFile, storeOptions });
  const base = `http://127.0.0.1:${app.httpServer.address().port}`;
  const post = (path, body = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const created = await post("/api/sessions");
  return { app, base, post, created, stateFile };
}
function rawSocket(base) {
  const s = ioClient(base, { transports: ["websocket"], reconnection: false });
  return new Promise((res, rej) => {
    s.once("connect", () => res(s));
    s.once("connect_error", rej);
  });
}
function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 3000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

/* ===================== FIX 1: event log is capped ===================== */

test("fix1: event log is capped; resume mode is replay vs snapshot", () => {
  const store = new Store({ maxEvents: 50 });
  const session = store.createSession({ pin: "111111" });
  const { token } = store.join({ pin: "111111", nickname: "A" }); // seq 1
  for (let i = 0; i < 199; i++) store.appendEvent(session, "x", {}); // seq 200
  assert.equal(session.seq, 200, "seq keeps counting past the cap");
  assert.equal(session.events.length, 50);
  assert.equal(session.events[0].seq, 151);

  const behind = store.sync({ token, lastSeq: 10 });
  assert.equal(behind.mode, "snapshot", "client is behind the oldest kept event");
  assert.equal(behind.lastSeq, 200);
  assert.equal(behind.missed.length, 50);

  assert.equal(store.sync({ token, lastSeq: 149 }).mode, "snapshot"); // needs 150, which was dropped
  const edge = store.sync({ token, lastSeq: 150 }); // needs 151.., all kept
  assert.equal(edge.mode, "replay");
  assert.equal(edge.missed.length, 50);
  assert.equal(store.sync({ token, lastSeq: 195 }).missed.length, 5);
  assert.equal(store.sync({ token, lastSeq: 200 }).mode, "replay");
});

test("fix1: the state file stays bounded (log is what gets written every time)", async () => {
  const file = await tmpFile("cap-");
  const store = new Store({ filePath: file, maxEvents: 100 });
  const session = store.createSession({ pin: "222222" });
  for (let i = 0; i < 2000; i++) store.appendEvent(session, "x", { pad: "y".repeat(200) });
  await store.writing;
  const onDisk = JSON.parse(await readFile(file, "utf8"));
  const s = Object.values(onDisk.sessions)[0];
  assert.equal(s.events.length, 100);
  assert.equal(s.seq, 2000);
});

test("fix1: an oversized log from an older state file is trimmed on load", async () => {
  const file = await tmpFile("legacy-");
  const events = Array.from({ length: 300 }, (_, i) => ({
    seq: i + 1,
    type: "x",
    at: 0,
    payload: {},
  }));
  await writeFile(
    file,
    JSON.stringify({
      sessions: {
        s1: {
          sessionId: "s1",
          pin: "333333",
          seq: 300,
          status: "live",
          question: null,
          questionIndex: 0,
          events,
          participants: {},
          answerIds: {},
          tally: {},
          createdAt: 0,
        },
      },
      pinToSession: { 333333: "s1" },
      tokens: {},
    }),
  );
  const store = new Store({ filePath: file, maxEvents: 100 });
  await store.load();
  await store.writing;
  assert.equal(store.getSession("s1").events.length, 100);
  assert.equal(store.getSession("s1").events[0].seq, 201);
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).sessions.s1.events.length,
    100,
    "shrink is persisted",
  );
});

test("fix1: client that fell behind the trimmed log resyncs from the snapshot", async () => {
  const { app, base, post, created } = await startApp({ maxEvents: 5 });
  const client = new QuizClient({ url: base });
  try {
    await client.join({ pin: created.pin, nickname: "Behind" });
    await post(`/api/sessions/${created.sessionId}/questions`, { text: "Q1", options: ["A", "B"] });
    assert.equal((await client.submitAnswer("q1", "A")).accepted, true);
    client.goOffline();
    for (let i = 2; i <= 12; i++)
      await post(`/api/sessions/${created.sessionId}/questions`, {
        text: `Q${i}`,
        options: ["A", "B"],
      });
    client.goOnline();
    await until(() => client.connected && client.reconnects >= 1, { label: "rejoin" });
    assert.equal(client.lastResumeMode, "snapshot");
    assert.equal(client.snapshot.question.text, "Q12");
    assert.equal(client.you.score, 100);
    assert.equal(client.you.answers.q1.option, "A");
    assert.equal(client.lastSeq, app.store.getSession(created.sessionId).seq);
  } finally {
    client.close();
    await app.close();
  }
});

/* ===================== FIX 2: tokens expire server-side ===================== */

function clockStore(ttl = 1000) {
  const clock = { t: 1_000_000 };
  const store = new Store({ tokenTtlMs: ttl, now: () => clock.t });
  store.createSession({ pin: "444444" });
  return { store, clock, join: (nick = "P") => store.join({ pin: "444444", nickname: nick }) };
}

test("fix2: an expired token is rejected by sync and submitAnswer", () => {
  const { store, clock, join } = clockStore(1000);
  const { token } = join();
  store.showQuestion(store.getSessionByPin("444444").sessionId, { text: "Q", options: ["A", "B"] });
  assert.doesNotThrow(() => store.sync({ token, lastSeq: 0 }));
  clock.t += 1001;
  assert.throws(() => store.sync({ token, lastSeq: 0 }), { code: "INVALID_TOKEN" });
  assert.throws(
    () => store.submitAnswer({ token, questionId: "q1", option: "A", answerId: "a1" }),
    { code: "INVALID_TOKEN" },
  );
});

test("fix2: activity extends the token (sliding), without a write on every call", () => {
  const { store, clock, join } = clockStore(1000);
  const { token } = join();
  const rec = store.state.tokens[token];
  const original = rec.expiresAt;
  clock.t += 100;
  store.sync({ token, lastSeq: 0 });
  assert.equal(rec.expiresAt, original, "more than half the lifetime left: not touched");
  clock.t += 500;
  store.sync({ token, lastSeq: 0 }); // 400 left (< half): extended
  assert.equal(rec.expiresAt, clock.t + 1000);
  clock.t += 600; // past the ORIGINAL expiry, inside the extended one
  assert.doesNotThrow(() => store.sync({ token, lastSeq: 0 }));
  clock.t += 1500; // idle past the extended expiry
  assert.throws(() => store.sync({ token, lastSeq: 0 }), { code: "INVALID_TOKEN" });
});

test("fix2: load prunes expired tokens, migrates legacy ones, keeps scores", async () => {
  const file = await tmpFile("tok-");
  const clock = { t: 5_000_000 };
  const a = new Store({ filePath: file, tokenTtlMs: 1000, now: () => clock.t });
  a.createSession({ pin: "555555" });
  const expired = a.join({ pin: "555555", nickname: "Old" });
  const legacy = a.join({ pin: "555555", nickname: "Legacy" });
  const fresh = a.join({ pin: "555555", nickname: "Fresh" });
  await a.writing;
  const disk = JSON.parse(await readFile(file, "utf8"));
  disk.tokens[expired.token].expiresAt = clock.t - 1;
  delete disk.tokens[legacy.token].expiresAt; // as written before this fix
  await writeFile(file, JSON.stringify(disk));

  const b = new Store({ filePath: file, tokenTtlMs: 1000, now: () => clock.t });
  await b.load();
  await b.writing;
  assert.equal(b.state.tokens[expired.token], undefined, "expired token removed");
  assert.equal(
    b.state.tokens[legacy.token].expiresAt,
    clock.t + 1000,
    "legacy token gets a fresh lifetime",
  );
  assert.ok(b.state.tokens[fresh.token]);
  assert.ok(
    b.getSessionByPin("555555").participants[expired.userId],
    "participant (and score) kept",
  );
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).tokens[expired.token],
    undefined,
    "prune is persisted",
  );
});

test("fix2: the uploaded state.json (no expiresAt) still resumes after load", async () => {
  const file = await tmpFile("uploaded-");
  const legacyState = JSON.parse(await readFile("/mnt/user-data/uploads/state.json", "utf8"));
  await writeFile(file, JSON.stringify(legacyState));
  const store = new Store({ filePath: file });
  await store.load();
  const sync = store.sync({ token: "8daf9ae5c4d95c74c51a8dfba93f9be2", lastSeq: 0 });
  assert.equal(sync.you.score, 100);
  assert.equal(sync.you.team, "Red");
  assert.equal(sync.mode, "replay");
});

test("fix2: over the wire, an expired token gets INVALID_TOKEN from hello", async () => {
  const { app, base, created } = await startApp({ tokenTtlMs: 300 });
  try {
    const sock = await rawSocket(base);
    const joined = await emitAck(sock, "join", { pin: created.pin, nickname: "Exp" });
    assert.equal(
      (await emitAck(sock, "hello", { token: joined.token.token, lastSeq: 0 })).ok,
      true,
    );
    await sleep(450);
    const late = await emitAck(sock, "hello", { token: joined.token.token, lastSeq: 0 });
    sock.close();
    assert.equal(late.ok, false);
    assert.equal(late.code, "INVALID_TOKEN");
  } finally {
    await app.close();
  }
});

test("fix2: cookie Max-Age follows the server-side token lifetime", async () => {
  assert.match(
    serializeSessionCookie({ token: "t" }),
    new RegExp(`Max-Age=${DEFAULT_TOKEN_TTL_MS / 1000};`),
  );
  const { app, base, created } = await startApp({ tokenTtlMs: 60_000 });
  try {
    const sock = await rawSocket(base);
    const joined = await emitAck(sock, "join", { pin: created.pin, nickname: "Ck" });
    sock.close();
    const res = await fetch(`${base}/api/me`, {
      headers: { Cookie: serializeSessionCookie(joined.token) },
    });
    assert.match(res.headers.get("set-cookie"), /Max-Age=60;/);
  } finally {
    await app.close();
  }
});

/* ===================== FIX 3: ack.correct / sync.mode are real ===================== */

test("fix3: answer ack carries correct + points, including on duplicates", async () => {
  const { app, base, post, created } = await startApp();
  try {
    const s1 = await rawSocket(base),
      s2 = await rawSocket(base);
    const p1 = await emitAck(s1, "join", { pin: created.pin, nickname: "Right" });
    const p2 = await emitAck(s2, "join", { pin: created.pin, nickname: "Wrong" });
    await post(`/api/sessions/${created.sessionId}/questions`, { text: "Q", options: ["A", "B"] }); // first option is correct
    const right = await emitAck(s1, "answer", {
      token: p1.token.token,
      questionId: "q1",
      option: "A",
      answerId: "r1",
    });
    const wrong = await emitAck(s2, "answer", {
      token: p2.token.token,
      questionId: "q1",
      option: "B",
      answerId: "w1",
    });
    const dupe = await emitAck(s1, "answer", {
      token: p1.token.token,
      questionId: "q1",
      option: "A",
      answerId: "r1",
    });
    const other = await emitAck(s1, "answer", {
      token: p1.token.token,
      questionId: "q1",
      option: "B",
      answerId: "r2",
    });
    s1.close();
    s2.close();
    assert.deepEqual([right.correct, right.points], [true, 100]);
    assert.deepEqual([wrong.correct, wrong.points], [false, 0]);
    assert.equal(dupe.duplicate, true);
    assert.deepEqual([dupe.correct, dupe.points], [true, 100]);
    assert.equal(other.duplicate, true);
    assert.deepEqual(
      [other.correct, other.points],
      [true, 100],
      "reports the stored answer, not the retried option",
    );
  } finally {
    await app.close();
  }
});

test("fix3: client records correct/points and reports resume mode after rejoin", async () => {
  const { app, base, post, created } = await startApp();
  const client = new QuizClient({ url: base });
  try {
    const joined = await client.join({ pin: created.pin, nickname: "Mode" });
    assert.equal(joined.mode, "replay");
    await post(`/api/sessions/${created.sessionId}/questions`, { text: "Q1", options: ["A", "B"] });
    await client.submitAnswer("q1", "A");
    assert.equal(client.you.answers.q1.correct, true);
    assert.equal(client.you.answers.q1.points, 100);
    app.io.disconnectSockets(true);
    await until(() => client.connected && client.reconnects >= 1, { label: "rejoin" });
    assert.equal(client.lastResumeMode, "replay");
  } finally {
    client.close();
    await app.close();
  }
});
