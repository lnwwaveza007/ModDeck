import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as ioClient } from "socket.io-client";
import { createApp } from "../src/server.mjs";
import { Store } from "../src/store.mjs";

async function tmpFile(prefix = "persist-") {
  return join(await mkdtemp(join(tmpdir(), prefix)), "state.json");
}
const readState = async (file) => JSON.parse(await readFile(file, "utf8"));

test("coalescing: 1000 changes in one tick cost a handful of writes, final state is on disk", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file, maxEvents: Infinity });
  const s = store.createSession({ pin: "123456" });
  for (let i = 0; i < 1000; i++) store.appendEvent(s, "x", { i });
  await store.writing;
  assert.ok(store.writeCount <= 3, `expected <= 3 writes, got ${store.writeCount}`);
  const onDisk = Object.values((await readState(file)).sessions)[0];
  assert.equal(onDisk.seq, 1000);
  assert.equal(onDisk.events.length, 1000);
});

test("durability: a change made WHILE a write is in flight is covered by `await store.writing`", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file });
  const a = store.createSession({ pin: "111111" }); // starts write #1 (contains only A)
  await new Promise((r) => setImmediate(r)); // let write #1 get under way
  const b = store.createSession({ pin: "222222" }); // happens mid-write
  await store.writing; // must wait for the trailing write that contains B
  const onDisk = await readState(file);
  assert.ok(onDisk.sessions[a.sessionId], "A on disk");
  assert.ok(onDisk.sessions[b.sessionId], "B on disk (not just A)");
});

test("race stress: after `await store.writing`, disk always equals memory, whatever the timing", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file, maxEvents: 20 });
  const s = store.createSession({ pin: "333333" });
  const pauses = [
    () => {}, // same tick
    () => Promise.resolve(), // microtask
    () => new Promise((r) => setImmediate(r)), // after I/O callbacks
    () => new Promise((r) => setTimeout(r, 0)),
    () => new Promise((r) => setTimeout(r, 1)),
  ];
  for (let i = 0; i < 300; i++) {
    store.appendEvent(s, "a", { i });
    await pauses[i % pauses.length]();
    store.appendEvent(s, "b", { i });
    await pauses[(i * 7) % pauses.length]();
    store.appendEvent(s, "c", { i });
    await store.writing;
    const onDisk = Object.values((await readState(file)).sessions)[0];
    assert.equal(
      onDisk.seq,
      s.seq,
      `iteration ${i}: disk seq ${onDisk.seq} != memory seq ${s.seq}`,
    );
  }
  assert.ok(
    store.writeCount < 900,
    `writes (${store.writeCount}) should be fewer than the 900 changes`,
  );
});

test("failure: a failed write rejects the waiter, and the next write recovers", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file });
  const realWrite = store._writeData.bind(store);
  let failNext = true;
  store._writeData = async (data) => {
    if (failNext) {
      failNext = false;
      throw new Error("disk full (simulated)");
    }
    return realWrite(data);
  };
  const origError = console.error;
  console.error = () => {};
  try {
    store.createSession({ pin: "444444" });
    await assert.rejects(store.writing, /disk full/);
  } finally {
    console.error = origError;
  }
  const s2 = store.createSession({ pin: "555555" });
  await store.writing; // recovers
  const onDisk = await readState(file);
  assert.ok(onDisk.sessions[s2.sessionId]);
  assert.equal(Object.keys(onDisk.sessions).length, 2, "earlier change was not lost either");
});

test("`await store.writing` after a failure retries instead of hanging", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file });
  const realWrite = store._writeData.bind(store);
  let failNext = true;
  store._writeData = async (data) => {
    if (failNext) {
      failNext = false;
      throw new Error("transient");
    }
    return realWrite(data);
  };
  const origError = console.error;
  console.error = () => {};
  try {
    store.createSession({ pin: "666666" });
    await assert.rejects(store.writing, /transient/);
  } finally {
    console.error = origError;
  }
  await store.writing; // nothing new changed, but the state is still unsaved -> must retry and succeed
  assert.equal(Object.keys((await readState(file)).sessions).length, 1);
});

test("flush() writes even when nothing changed; no filePath means nothing to wait for", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file });
  await store.flush();
  assert.deepEqual((await readState(file)).sessions, {});
  const memoryOnly = new Store();
  memoryOnly.createSession({ pin: "777777" });
  await memoryOnly.writing;
  await memoryOnly.flush();
  assert.equal(memoryOnly.writeCount, 0);
});

test("under concurrent load every ack is already durable, with far fewer writes than changes", async () => {
  const stateFile = await tmpFile("load-");
  const app = await createApp({ port: 0, stateFile });
  const base = `http://127.0.0.1:${app.httpServer.address().port}`;
  const post = (p, b = {}) =>
    fetch(`${base}${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => r.json());
  const connect = () =>
    new Promise((res, rej) => {
      const s = ioClient(base, { transports: ["websocket"], reconnection: false });
      s.once("connect", () => res(s));
      s.once("connect_error", rej);
    });
  const emitAck = (s, ev, p) =>
    new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`ack timeout ${ev}`)), 8000);
      s.emit(ev, p, (a) => {
        clearTimeout(t);
        res(a);
      });
    });
  const N = 40;
  try {
    const created = await post("/api/sessions");
    const sockets = await Promise.all(Array.from({ length: N }, connect));
    const joined = await Promise.all(
      sockets.map((s, i) => emitAck(s, "join", { pin: created.pin, nickname: `P${i}` })),
    );
    await post(`/api/sessions/${created.sessionId}/questions`, { text: "Q", options: ["A", "B"] });
    const writesBefore = app.store.writeCount;
    const seqBefore = app.store.getSession(created.sessionId).seq;

    const notDurable = [];
    await Promise.all(
      sockets.map(async (s, i) => {
        const answerId = `load-${i}`;
        const ack = await emitAck(s, "answer", {
          token: joined[i].token.token,
          questionId: "q1",
          option: "A",
          answerId,
        });
        assert.equal(ack.accepted, true);
        // at the moment the client sees the ack, the answer must already be in the file
        const onDisk = (await readState(stateFile)).sessions[created.sessionId];
        if (!onDisk.answerIds[answerId]) notDurable.push(answerId);
      }),
    );
    sockets.forEach((s) => s.close());

    assert.deepEqual(notDurable, [], "acked answers missing from disk");
    const answerWrites = app.store.writeCount - writesBefore;
    const answerChanges = app.store.getSession(created.sessionId).seq - seqBefore;
    console.log(`load test: ${answerChanges} answer changes -> ${answerWrites} file writes`);
    assert.equal(answerChanges, N);
    assert.ok(
      answerWrites < answerChanges,
      `expected coalescing: ${answerWrites} writes for ${answerChanges} changes`,
    );
  } finally {
    await app.close();
  }
});

test("no lost wakeup: a change nobody awaits, made the instant the writer finishes, still gets written", async () => {
  const file = await tmpFile();
  const store = new Store({ filePath: file, maxEvents: 20 });
  const s = store.createSession({ pin: "888888" });
  for (let i = 0; i < 150; i++) {
    store.appendEvent(s, "a", { i });
    await store.writing; // our continuation runs right as the writer loop exits...
    store.appendEvent(s, "b", { i }); // ...and this change is fire-and-forget (nobody awaits it)
    const deadline = Date.now() + 500;
    while (store.flushedVersion < store.version && Date.now() < deadline)
      await new Promise((r) => setImmediate(r));
    assert.equal(
      store.flushedVersion,
      store.version,
      `iteration ${i}: change was never written (writer did not restart)`,
    );
  }
  const onDisk = Object.values((await readState(file)).sessions)[0];
  assert.equal(onDisk.seq, s.seq);
});
