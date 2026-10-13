// Concurrency test: 300 users answer one question at the same moment, and
// some of them send extra answers at the same moment too (double taps, two
// tabs). Then compare what the clients saw accepted, what Redis holds, and
// what reached PostgreSQL.
//
//   node src/burst.mjs                         atomic Lua submit, 5 rounds
//   node src/burst.mjs --spread-ms 0           every submit at the same instant
//   node src/burst.mjs --mode naive            check-then-write, for comparison
//   node src/burst.mjs --users 1000 --conns 100

import { mkdirSync, writeFileSync } from "node:fs";
import { createRedis, keys, resetSession, submit, submitNaive } from "./store.mjs";
import * as pgdb from "./db.mjs";
import { startFlusher } from "./flush.mjs";
import { args, shuffle, sleep, summary } from "./util.mjs";

const opt = args({
  mode: "atomic",
  users: 300,
  dupes: 100, // users who also send extra answers
  extra: 3, // extra answers per duplicate user
  conns: 300, // Redis connections the submits are spread over
  rounds: 5,
  "flush-ms": 200,
  // Each submit starts at a random time in this window. 0 = all at once.
  "spread-ms": 1000,
});

const OPTIONS = ["A", "B", "C", "D"];
const CORRECT = "A";
const QID = "q1";
const submitFn = opt.mode === "naive" ? submitNaive : submit;

const conns = Array.from({ length: opt.conns }, () => createRedis());
const flushRedis = createRedis();
const db = await pgdb.connect();
await Promise.all(conns.map((c) => c.ping()));

const pick = () => OPTIONS[Math.floor(Math.random() * OPTIONS.length)];
const pointsFor = (option) => (option === CORRECT ? 500 + Math.floor(Math.random() * 500) : 0);

function buildSubmits(sid) {
  const list = [];
  for (let u = 0; u < opt.users; u++) {
    const user = `u${String(u).padStart(4, "0")}`;
    const n = u < opt.dupes ? 1 + opt.extra : 1;
    for (let i = 0; i < n; i++) {
      const option = pick();
      list.push({ sid, qid: QID, user, option, points: pointsFor(option) });
    }
  }
  return shuffle(list);
}

async function round(r) {
  const sid = `burst-${opt.mode}-${r}`;
  await resetSession(flushRedis, sid, [QID]);
  await pgdb.resetSession(db, sid);

  const submits = buildSubmits(sid);
  const flusher = startFlusher(flushRedis, db, sid, opt["flush-ms"]);

  const latencies = new Array(submits.length);
  const accepted = [];
  await flushRedis.config("RESETSTAT");
  const t0 = performance.now();
  await Promise.all(
    submits.map(async (s, i) => {
      if (opt["spread-ms"] > 0) await sleep(Math.random() * opt["spread-ms"]);
      const start = performance.now();
      const ok = await submitFn(conns[i % conns.length], s);
      latencies[i] = performance.now() - start;
      if (ok) accepted.push(s);
    }),
  );
  const burstMs = performance.now() - t0;
  // Time spent inside Redis per submit script, without network and client.
  const info = await flushRedis.info("commandstats");
  const serverUs = Number(info.match(/cmdstat_evalsha:.*usec_per_call=([\d.]+)/)?.[1] ?? NaN);
  const flushStats = await flusher.stop();

  // What the clients were told.
  const perUser = new Map();
  for (const a of accepted) perUser.set(a.user, (perUser.get(a.user) ?? 0) + 1);
  const doubleAccepted = [...perUser.values()].filter((n) => n > 1).length;
  const expectedScore = new Map();
  for (const a of accepted) {
    if (a.points > 0) expectedScore.set(a.user, (expectedScore.get(a.user) ?? 0) + a.points);
  }

  // What Redis holds.
  const k = keys(sid, QID);
  const [answers, votes, lbFlat, streamLen] = await Promise.all([
    flushRedis.hgetall(k.answers),
    flushRedis.hgetall(k.votes),
    flushRedis.zrange(k.lb, 0, -1, "WITHSCORES"),
    flushRedis.xlen(k.stream),
  ]);
  const redisVotes = Object.values(votes).reduce((s, v) => s + Number(v), 0);
  const fromAnswers = {};
  for (const o of Object.values(answers)) fromAnswers[o] = (fromAnswers[o] ?? 0) + 1;
  const lb = new Map();
  for (let i = 0; i < lbFlat.length; i += 2) lb.set(lbFlat[i], Number(lbFlat[i + 1]));
  const lbMatches =
    lb.size === expectedScore.size && [...expectedScore].every(([u, s]) => lb.get(u) === s);

  // What PostgreSQL holds.
  const pgRows = await pgdb.countAnswers(db, sid);
  const pgVotes = await pgdb.voteCounts(db, sid, QID);
  const { rows: pgAnswerRows } = await db.query(
    "SELECT user_id, option FROM md9_answer WHERE session_id = $1",
    [sid],
  );
  const pgMatchesRedis = pgAnswerRows.every((r) => answers[r.user_id] === r.option);

  const same = (a, b) => OPTIONS.every((o) => Number(a[o] ?? 0) === Number(b[o] ?? 0));
  const checks = {
    "accepted == users": accepted.length === opt.users,
    "no user accepted twice": doubleAccepted === 0,
    "Redis answers == users": Object.keys(answers).length === opt.users,
    "Redis vote total == users": redisVotes === opt.users,
    "Redis votes match Redis answers": same(votes, fromAnswers),
    "leaderboard matches accepted points": lbMatches,
    "PostgreSQL rows == users": pgRows === opt.users,
    "PostgreSQL votes match Redis votes": same(pgVotes, votes),
    "PostgreSQL answers match Redis answers": pgMatchesRedis,
    "stream empty after final flush": streamLen === 0,
  };

  return {
    round: r,
    submits: submits.length,
    accepted: accepted.length,
    doubleAccepted,
    redisAnswers: Object.keys(answers).length,
    redisVotes,
    pgRows,
    burstMs,
    serverUs,
    flush: flushStats,
    latencies,
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

console.log(
  `mode=${opt.mode} users=${opt.users} dupes=${opt.dupes}x${opt.extra} ` +
    `conns=${opt.conns} spread ${opt["spread-ms"]} ms, flush every ${opt["flush-ms"]} ms`,
);
const results = [];
for (let r = 1; r <= opt.rounds; r++) {
  const res = await round(r);
  results.push(res);
  console.log(
    `round ${r}: ${res.submits} submits in ${res.burstMs.toFixed(0)} ms | accepted ${res.accepted}` +
      ` (users twice: ${res.doubleAccepted}) | Redis answers ${res.redisAnswers}, votes ${res.redisVotes}` +
      ` | PG rows ${res.pgRows} | flush passes ${res.flush.passes}, slowest batch ${res.flush.maxBatchMs.toFixed(1)} ms` +
      ` | script in Redis ${res.serverUs} us` +
      ` | ${res.pass ? "PASS" : "FAIL"}`,
  );
  for (const [name, ok] of Object.entries(res.checks)) if (!ok) console.log(`  FAIL: ${name}`);
}

const all = results.flatMap((r) => r.latencies);
const lat = summary(all);
console.log(`submit latency over ${all.length} submits:`, lat);
console.log(
  `burst wall time: ${results.map((r) => r.burstMs.toFixed(0)).join(", ")} ms` +
    ` | all rounds ${results.every((r) => r.pass) ? "PASS" : "FAIL"}`,
);

mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../out/burst-${opt.mode}-spread${opt["spread-ms"]}.json`, import.meta.url),
  JSON.stringify(
    { options: opt, latency: lat, rounds: results.map(({ latencies, ...r }) => r) },
    null,
    2,
  ),
);

await Promise.all([...conns, flushRedis].map((c) => c.quit()));
await db.end();
