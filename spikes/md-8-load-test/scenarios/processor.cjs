// Artillery processor for the MD-8 load test.
//
// Every virtual user (VU) is one simulated student on one Socket.IO connection.
// The Artillery socketio engine opens the socket before the flow starts and
// exposes it as context.sockets[""]; the functions below drive it directly.
//
// Timing is absolute (epoch ms). run.mjs writes $MD8_OUT_DIR/schedule.json once
// Artillery's arrival phase has started, and every VU polls for it after joining,
// so all VUs in all Artillery worker processes act on the same schedule. All VUs run
// on the load-generator machine, so sender and receiver share one clock.
//
// Measurements:
//   delivery_ms   send -> broadcast received, for EVERY recipient in the room
//   echo_ms       send -> own broadcast received, sender only
//   joined/sent/recv per room, own_missing, disconnects, join_failed, late_join
// Dropped messages = sum_i(sent_i * joined_i) - sum_i(recv_i), computed by run.mjs.
//
// Each worker writes exact 0.1 ms-bucket histograms and counters to
// $MD8_OUT_DIR/raw-<pid>-<thread>.json so run.mjs can merge several Artillery
// processes exactly. The same values also go to Artillery's own report.

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { threadId } = require("node:worker_threads");

const env = process.env;
const num = (k, d) => (env[k] !== undefined ? Number(env[k]) : d);

const ROOM_PINS = (env.MD8_ROOM_PINS || "100001").split(",");
const JOIN_TIMEOUT_MS = num("MD8_JOIN_TIMEOUT_MS", 15000);
const GRACE_MS = num("MD8_GRACE_MS", 10000);
const OUT_DIR = env.MD8_OUT_DIR;
// Offset this worker's round-robin so several Artillery processes (one per
// target in the multi-instance run) still spread evenly over rooms.
let vuCounter = num("MD8_VU_OFFSET", 0) + Math.floor(Math.random() * ROOM_PINS.length);

const nowMs = () => performance.timeOrigin + performance.now();
const sleepUntil = (t) => new Promise((r) => setTimeout(r, Math.max(0, t - Date.now())));
const rand = (a, b) => a + Math.random() * (b - a);

let schedule = null;
function readSchedule() {
  if (!schedule && OUT_DIR) {
    try {
      schedule = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "schedule.json"), "utf8"));
    } catch {
      // not written yet
    }
  }
  return schedule;
}
async function getSchedule() {
  while (!readSchedule()) await new Promise((r) => setTimeout(r, 250));
  return schedule;
}
const pickOption = () => ["A", "B", "C", "D"][Math.floor(Math.random() * 4)];

// ---- exact per-worker aggregation -------------------------------------------
const agg = { hist: { delivery_ms: {}, echo_ms: {}, join_ms: {} }, counters: {} };
let activeVus = 0;
let lastFlush = 0;

function count(events, name, n = 1) {
  agg.counters[name] = (agg.counters[name] || 0) + n;
  events.emit("counter", `md8.${name}`, n);
}

function observe(events, name, ms) {
  const b = Math.max(0, Math.round(ms * 10)); // 0.1 ms buckets
  agg.hist[name][b] = (agg.hist[name][b] || 0) + 1;
  events.emit("histogram", `md8.${name}`, ms);
}

function flush(force) {
  if (!OUT_DIR) return;
  const t = Date.now();
  if (!force && t - lastFlush < 2000) return;
  lastFlush = t;
  fs.writeFileSync(path.join(OUT_DIR, `raw-${process.pid}-${threadId}.json`), JSON.stringify(agg));
}

// ---- flow steps -------------------------------------------------------------
function joinRoom(context, events, done) {
  const socket = context.sockets[""];
  const roomIdx = vuCounter++ % ROOM_PINS.length;
  const pin = ROOM_PINS[roomIdx];
  const st = { roomIdx, pin, pending: new Map(), finished: false };
  context.md8 = st;
  activeVus++;

  // A broadcast covers one message (question_posted, per-vote vote_update) or,
  // with vote coalescing, a `batch` of votes. Each covered message counts once.
  const onBroadcast = (msg) => {
    if (!msg) return;
    const t = nowMs();
    for (const item of Array.isArray(msg.batch) ? msg.batch : [msg]) {
      if (!item || !item.clientMsgId || typeof item.sentAt !== "number") continue;
      count(events, `recv.r${roomIdx}`);
      observe(events, "delivery_ms", t - item.sentAt);
      const mine = st.pending.get(item.clientMsgId);
      if (mine !== undefined) {
        observe(events, "echo_ms", t - mine);
        st.pending.delete(item.clientMsgId);
      }
    }
  };
  socket.on("vote_update", onBroadcast);
  socket.on("question_posted", onBroadcast);
  socket.on("disconnect", (reason) => {
    if (st.finished) return; // normal close at the end of the scenario
    count(events, "disconnects");
    count(events, `disconnect.${String(reason).replace(/\s+/g, "_")}`);
  });
  socket.on("error", (e) => count(events, `server_error.${(e && e.code) || "unknown"}`));

  const started = nowMs();
  const timer = setTimeout(() => {
    count(events, "join_failed");
    activeVus--;
    flush(activeVus === 0);
    done(new Error("join timeout"));
  }, JOIN_TIMEOUT_MS);
  socket.once("joined", () => {
    clearTimeout(timer);
    observe(events, "join_ms", nowMs() - started);
    count(events, `joined.r${roomIdx}`);
    const sch = readSchedule();
    if (sch && Date.now() > sch.MD8_FIRST_SEND_AT) count(events, "late_join");
    done();
  });
  socket.emit("join", { pin, nickname: `vu-${context.vars.$uuid || Math.random()}` });
}

function send(context, events, event, body) {
  const st = context.md8;
  const clientMsgId = `${process.pid}-${threadId}-${Math.random().toString(36).slice(2)}`;
  const sentAt = nowMs();
  st.pending.set(clientMsgId, sentAt);
  context.sockets[""].emit(event, { pin: st.pin, clientMsgId, sentAt, ...body });
  count(events, `sent.r${st.roomIdx}`);
}

function finish(context, events) {
  const st = context.md8;
  st.finished = true;
  if (st.pending.size) count(events, "own_missing", st.pending.size);
  activeVus--;
  flush(activeVus === 0);
}

// Scenario 1: ramp to N connections, hold. A light probe (one vote per client
// at a random moment during the hold, ~N/hold_s votes/s) measures broadcast
// latency at full connection count.
async function rampHold(context, events) {
  const sch = await getSchedule();
  const holdStart = sch.MD8_HOLD_START;
  const holdEnd = sch.MD8_HOLD_END;
  if (env.MD8_PROBE !== "0") {
    await sleepUntil(rand(holdStart, holdEnd - GRACE_MS));
    send(context, events, "vote", { option: pickOption() });
  }
  await sleepUntil(holdEnd);
  finish(context, events);
}

// Scenario 2: every client votes once inside a BURST_WINDOW_MS window.
async function burstVote(context, events) {
  const sch = await getSchedule();
  const burstAt = sch.MD8_BURST_AT;
  const windowMs = sch.MD8_BURST_WINDOW_MS;
  await sleepUntil(burstAt + Math.random() * windowMs);
  send(context, events, "vote", { option: pickOption() });
  await sleepUntil(burstAt + windowMs + GRACE_MS);
  finish(context, events);
}

// Scenario 3: Q&A traffic. Each client posts a question every
// MD8_SEND_INTERVAL_MS (= clients_per_room / msgs_per_sec_per_room) with a
// random phase, so each room sees the target message rate for the whole window.
async function qaSustained(context, events) {
  const sch = await getSchedule();
  const start = sch.MD8_START_AT;
  const end = sch.MD8_END_AT;
  const intervalMs = sch.MD8_SEND_INTERVAL_MS;
  let n = 0;
  for (let t = start + Math.random() * intervalMs; t < end; t += intervalMs) {
    await sleepUntil(t);
    n++;
    send(context, events, "question", {
      text: `Load test question ${n}: what does this slide mean?`,
    });
    flush(false);
  }
  await sleepUntil(end + GRACE_MS);
  finish(context, events);
}

module.exports = { joinRoom, rampHold, burstVote, qaSustained };
