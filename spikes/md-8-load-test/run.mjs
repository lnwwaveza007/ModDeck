// MD-8 load test runner. Run this on the LOAD-GENERATOR machine.
//
//   node run.mjs --scenario burst --target http://<server>:4000
//   node run.mjs --scenario ramp --target http://<server>:4000 --label ramp-1
//   node run.mjs --scenario sustained --target http://<server>:8080 --clients 1200 --rooms 6
//   node run.mjs --scenario burst --target http://<a>:4000,http://<b>:4001   (one Artillery per target)
//
// It picks fresh room PINs, sets an absolute schedule (MD8_* env vars), starts
// Artillery, samples each server's /metrics every second, then writes
// results/<label>/summary.json and prints PASS/FAIL (p95 < 150 ms, 0 dropped).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const artilleryBin = path.join(
  path.dirname(require.resolve("artillery/package.json")),
  "bin",
  "run",
);

// Load-generator CPU %. When the load generator is pinned to some cores
// (e.g. `taskset -c 2,3` with MD8_LOADGEN_CPUS=2,3), only those cores count.
const loadGenCpus = process.env.MD8_LOADGEN_CPUS?.split(",").map(Number);

const DEFAULTS = {
  ramp: { clients: 300, rooms: 1, connectS: 60 },
  burst: { clients: 300, rooms: 1, connectS: 30 },
  sustained: { clients: 300, rooms: 3, connectS: 30 },
};

const { values: a } = parseArgs({
  options: {
    scenario: { type: "string" },
    target: { type: "string", default: "http://localhost:4000" },
    metrics: { type: "string" },
    clients: { type: "string" },
    rooms: { type: "string" },
    "connect-s": { type: "string" },
    "hold-s": { type: "string", default: "300" },
    "duration-s": { type: "string", default: "600" },
    rate: { type: "string", default: "5" },
    "window-ms": { type: "string", default: "1000" },
    "grace-ms": { type: "string", default: "10000" },
    workers: { type: "string" },
    label: { type: "string" },
    note: { type: "string", default: "" },
  },
});

const scenario = a.scenario;
if (!DEFAULTS[scenario]) {
  console.error("--scenario must be one of: ramp, burst, sustained");
  process.exit(2);
}
const d = DEFAULTS[scenario];
const clients = Number(a.clients ?? d.clients);
const rooms = Number(a.rooms ?? d.rooms);
const connectS = Number(a["connect-s"] ?? d.connectS);
const graceMs = Number(a["grace-ms"]);
const targets = a.target.split(",").map((s) => s.trim().replace(/\/$/, ""));
const metricsUrls = (a.metrics ? a.metrics.split(",") : targets.map((t) => `${t}/metrics`)).map(
  (s) => s.trim(),
);
const label =
  a.label ?? `${scenario}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
const outDir = path.join(here, "results", label);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// ---- schedule ---------------------------------------------------------------
const pins = new Set();
while (pins.size < rooms) pins.add(String(100000 + Math.floor(Math.random() * 900000)));
const roomPins = [...pins];

const now = Date.now();
const env0 = {
  MD8_ROOM_PINS: roomPins.join(","),
  MD8_GRACE_MS: String(graceMs),
  MD8_OUT_DIR: outDir,
};

// Called once every Artillery process has started its arrival phase (t0).
// Writes schedule.json, which the VUs wait for before sending anything.
function buildSchedule(t0) {
  const connectEnd = t0 + connectS * 1000;
  let s;
  let win; // the measured window, used for server stats
  if (scenario === "ramp") {
    const holdStart = connectEnd + 5000;
    const holdEnd = holdStart + Number(a["hold-s"]) * 1000;
    s = { MD8_HOLD_START: holdStart, MD8_HOLD_END: holdEnd, MD8_FIRST_SEND_AT: holdStart };
    win = [t0, holdEnd];
  } else if (scenario === "burst") {
    const burstAt = connectEnd + 10000;
    const windowMs = Number(a["window-ms"]);
    s = { MD8_BURST_AT: burstAt, MD8_BURST_WINDOW_MS: windowMs, MD8_FIRST_SEND_AT: burstAt };
    win = [burstAt - 5000, burstAt + windowMs + graceMs];
  } else {
    const startAt = connectEnd + 10000;
    const endAt = startAt + Number(a["duration-s"]) * 1000;
    const intervalMs = Math.round((clients / rooms / Number(a.rate)) * 1000);
    s = {
      MD8_START_AT: startAt,
      MD8_END_AT: endAt,
      MD8_SEND_INTERVAL_MS: intervalMs,
      MD8_FIRST_SEND_AT: startAt,
    };
    win = [startAt, endAt + graceMs];
  }
  config.schedule = { t0, ...s };
  config.window = { start: win[0], end: win[1] };
  fs.writeFileSync(path.join(outDir, "schedule.json"), JSON.stringify(s));
  fs.writeFileSync(path.join(outDir, "config.json"), JSON.stringify(config, null, 2));
  console.log(
    `[md8] phase started; measured window ${new Date(win[0]).toISOString()} .. ${new Date(win[1]).toISOString()}`,
  );
}

const config = {
  scenario,
  label,
  note: a.note,
  clients,
  rooms,
  roomPins,
  connectS,
  targets,
  metricsUrls,
  schedule: null,
  window: null,
  loadGenerator: { ...machineSpec(), pinnedCpus: loadGenCpus ?? null },
  startedAt: new Date(now).toISOString(),
};
fs.writeFileSync(path.join(outDir, "config.json"), JSON.stringify(config, null, 2));
console.log(
  `[md8] ${label}: ${scenario}, ${clients} clients, ${rooms} room(s), targets ${targets.join(" ")}`,
);

// ---- metrics sampler ---------------------------------------------------------
const KEEP = [
  "process_cpu_seconds_total",
  "process_resident_memory_bytes",
  "nodejs_heap_size_used_bytes",
  "nodejs_eventloop_lag_p50_seconds",
  "nodejs_eventloop_lag_p99_seconds",
  "nodejs_eventloop_lag_max_seconds",
  "moddeck_ws_connections",
  "moddeck_ws_packets_sent_total",
  "moddeck_ws_messages_received_total",
  "moddeck_redis_used_memory_bytes",
  "moddeck_redis_cpu_seconds_total",
  "moddeck_redis_instantaneous_ops_per_sec",
];
function parseProm(text) {
  const m = {};
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const name = line.split(/[{\s]/, 1)[0];
    if (!KEEP.includes(name)) continue;
    const v = Number(line.slice(line.lastIndexOf(" ") + 1));
    m[name] = (m[name] ?? 0) + v; // sums label variants (e.g. per-event counters)
  }
  return m;
}
let prevCpu = cpuTimes();
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const [i, c] of os.cpus().entries()) {
    if (loadGenCpus && !loadGenCpus.includes(i)) continue;
    for (const [k, v] of Object.entries(c.times)) {
      total += v;
      if (k === "idle") idle += v;
    }
  }
  return { idle, total };
}
const samplesFile = fs.createWriteStream(path.join(outDir, "samples.jsonl"));
const sampler = setInterval(async () => {
  const t = Date.now();
  const cur = cpuTimes();
  const loadGenCpuPct =
    100 * (1 - (cur.idle - prevCpu.idle) / Math.max(1, cur.total - prevCpu.total));
  prevCpu = cur;
  const servers = await Promise.all(
    metricsUrls.map(async (url) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(900) });
        return { url, m: parseProm(await r.text()) };
      } catch (e) {
        return { url, error: String(e.message ?? e) };
      }
    }),
  );
  samplesFile.write(JSON.stringify({ t, loadGenCpuPct, servers }) + "\n");
}, 1000);

// ---- run Artillery (one process per target) ----------------------------------
const share = (i) => Math.floor(clients / targets.length) + (i < clients % targets.length ? 1 : 0);
let phasesStarted = 0;
const runs = targets.map(
  (target, i) =>
    new Promise((resolve) => {
      const overrides = {
        config: { phases: [{ name: "connect", duration: connectS, arrivalCount: share(i) }] },
      };
      const args = [
        artilleryBin,
        "run",
        "--target",
        target,
        "--overrides",
        JSON.stringify(overrides),
        "--output",
        path.join(outDir, `artillery-report-${i}.json`),
        path.join(here, "scenarios", `${scenario}.yml`),
      ];
      const env = {
        ...process.env,
        ...env0,
        MD8_VU_OFFSET: String(i),
        ARTILLERY_DISABLE_TELEMETRY: "true",
        ARTILLERY_TELEMETRY_DEFAULTS: "{}",
      };
      if (a.workers) env.WORKERS = a.workers;
      const log = fs.createWriteStream(path.join(outDir, `artillery-${i}.log`));
      const child = spawn(process.execPath, args, { cwd: here, env });
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      let seen = false;
      child.stdout.on("data", (buf) => {
        if (!seen && buf.toString().includes("Phase started")) {
          seen = true;
          if (++phasesStarted === targets.length) buildSchedule(Date.now());
        }
      });
      child.on("exit", (code) => resolve(code));
    }),
);
const codes = await Promise.all(runs);
clearInterval(sampler);
await new Promise((r) => samplesFile.end(r));

// ---- summarize ----------------------------------------------------------------
const summary = summarize();
summary.artilleryExitCodes = codes;
fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
const L = summary.latency.delivery_ms;
console.log(
  `[md8] ${label}: ${summary.pass ? "PASS" : "FAIL"} | delivery p50 ${L.p50} p95 ${L.p95} p99 ${L.p99} ms` +
    ` | dropped ${summary.messages.dropped}/${summary.messages.expected}` +
    ` | api CPU max ${summary.server.cpuPctMax}% RSS max ${summary.server.rssMbMax} MB` +
    ` | loop lag p99 max ${summary.server.loopLagP99MsMax} ms`,
);
for (const w of summary.warnings) console.log(`[md8] WARNING: ${w}`);
process.exit(0);

function summarize() {
  // Merge per-worker raw files.
  const hist = { delivery_ms: {}, echo_ms: {}, join_ms: {} };
  const c = {};
  for (const f of fs.readdirSync(outDir).filter((f) => f.startsWith("raw-"))) {
    const raw = JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8"));
    for (const [h, buckets] of Object.entries(raw.hist))
      for (const [b, n] of Object.entries(buckets)) hist[h][b] = (hist[h][b] ?? 0) + n;
    for (const [k, v] of Object.entries(raw.counters)) c[k] = (c[k] ?? 0) + v;
  }
  const pct = (buckets) => {
    const entries = Object.entries(buckets)
      .map(([b, n]) => [Number(b) / 10, n])
      .sort((x, y) => x[0] - y[0]);
    const n = entries.reduce((s, [, k]) => s + k, 0);
    const at = (p) => {
      if (!n) return null;
      let acc = 0;
      const rank = Math.ceil((p / 100) * n);
      for (const [v, k] of entries) if ((acc += k) >= rank) return v;
      return entries.at(-1)[0];
    };
    const mean = n ? entries.reduce((s, [v, k]) => s + v * k, 0) / n : null;
    return {
      count: n,
      p50: at(50),
      p95: at(95),
      p99: at(99),
      max: at(100),
      mean: mean && +mean.toFixed(1),
    };
  };

  let expected = 0;
  let received = 0;
  let sent = 0;
  let joined = 0;
  const perRoom = roomPins.map((pin, i) => {
    const r = {
      pin,
      joined: c[`joined.r${i}`] ?? 0,
      sent: c[`sent.r${i}`] ?? 0,
      recv: c[`recv.r${i}`] ?? 0,
    };
    r.expected = r.sent * r.joined;
    expected += r.expected;
    received += r.recv;
    sent += r.sent;
    joined += r.joined;
    return r;
  });

  // Server stats inside the measured window.
  const samples = fs
    .readFileSync(path.join(outDir, "samples.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const win = config.window ?? { start: 0, end: Infinity };
  const inWin = samples.filter((s) => s.t >= win.start && s.t <= win.end);
  const server = {
    cpuPct: [],
    rssMb: [],
    loopP99: [],
    loopMax: [],
    redisCpuPct: [],
    redisMemMb: [],
    conns: [],
  };
  for (let i = 1; i < inWin.length; i++) {
    const dt = (inWin[i].t - inWin[i - 1].t) / 1000;
    let cpu = 0;
    let conns = 0;
    let redisCpu = null;
    inWin[i].servers.forEach((s, j) => {
      const p = inWin[i - 1].servers[j];
      if (!s.m || !p?.m) return;
      const pctCpu = (100 * (s.m.process_cpu_seconds_total - p.m.process_cpu_seconds_total)) / dt;
      cpu = Math.max(cpu, pctCpu); // busiest instance
      server.rssMb.push(s.m.process_resident_memory_bytes / 2 ** 20);
      server.loopP99.push(s.m.nodejs_eventloop_lag_p99_seconds * 1000);
      server.loopMax.push(s.m.nodejs_eventloop_lag_max_seconds * 1000);
      conns += s.m.moddeck_ws_connections;
      if (j === 0 && s.m.moddeck_redis_cpu_seconds_total !== undefined) {
        redisCpu =
          (100 * (s.m.moddeck_redis_cpu_seconds_total - p.m.moddeck_redis_cpu_seconds_total)) / dt;
        server.redisMemMb.push(s.m.moddeck_redis_used_memory_bytes / 2 ** 20);
      }
    });
    server.cpuPct.push(cpu);
    server.conns.push(conns);
    if (redisCpu !== null) server.redisCpuPct.push(redisCpu);
  }
  const max = (xs) => (xs.length ? +Math.max(...xs).toFixed(1) : null);
  const avg = (xs) => (xs.length ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1) : null);
  const allConns = samples.map((s) =>
    s.servers.reduce((n, x) => n + (x.m?.moddeck_ws_connections ?? 0), 0),
  );
  const loadGen = inWin.slice(1).map((s) => s.loadGenCpuPct);

  const latency = {
    delivery_ms: pct(hist.delivery_ms),
    echo_ms: pct(hist.echo_ms),
    join_ms: pct(hist.join_ms),
  };
  const dropped = expected - received;
  const warnings = [];
  if (c.late_join)
    warnings.push(
      `${c.late_join} client(s) joined after sending started; the connect phase was too short`,
    );
  if (c.join_failed) warnings.push(`${c.join_failed} client(s) failed to join`);
  if (joined < clients) warnings.push(`only ${joined}/${clients} clients joined`);
  if (max(loadGen) > 85)
    warnings.push(
      `load generator CPU peaked at ${max(loadGen)}%; latency may include client-side queueing`,
    );
  if (inWin.some((s) => s.servers.some((x) => x.error)))
    warnings.push("some /metrics scrapes failed");

  return {
    scenario,
    label,
    note: a.note,
    clients,
    rooms,
    pass:
      latency.delivery_ms.p95 !== null &&
      latency.delivery_ms.p95 < 150 &&
      dropped === 0 &&
      !c.join_failed,
    latency,
    messages: {
      joined,
      sent,
      expected,
      received,
      dropped,
      ownMissing: c.own_missing ?? 0,
      disconnects: c.disconnects ?? 0,
      joinFailed: c.join_failed ?? 0,
      lateJoin: c.late_join ?? 0,
      perRoom,
    },
    server: {
      peakConnections: Math.max(0, ...allConns),
      cpuPctAvg: avg(server.cpuPct),
      cpuPctMax: max(server.cpuPct),
      rssMbMax: max(server.rssMb),
      loopLagP99MsMax: max(server.loopP99),
      loopLagMaxMs: max(server.loopMax),
      redisCpuPctMax: max(server.redisCpuPct),
      redisMemMbMax: max(server.redisMemMb),
    },
    loadGenerator: { cpuPctAvg: avg(loadGen), cpuPctMax: max(loadGen) },
    warnings,
  };
}

function machineSpec() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model?.trim(),
    logicalCpus: cpus.length,
    memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1),
    node: process.version,
  };
}
