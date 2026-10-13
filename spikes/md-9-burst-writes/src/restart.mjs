// What is lost if Redis stops before the flusher writes to PostgreSQL?
//
// For each persistence setting, start a throwaway Redis container on port
// 6390, take 300 answers with no flush, stop Redis, start it again, and count
// what survived. Then submit the same 300 users again: anything accepted the
// second time is an answer the duplicate check forgot.
//
// Stops:
//   crash     docker kill (SIGKILL): process dies, no save
//   graceful  docker restart (SIGTERM): Redis saves on shutdown
//
// The compose Redis on 6379 is not touched. Needs Docker and the compose
// Postgres.
//
//   node src/restart.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRedis, keys, resetSession, submit } from "./store.mjs";
import * as pgdb from "./db.mjs";
import { flushOnce } from "./flush.mjs";
import { args, sleep, summary } from "./util.mjs";

const opt = args({ users: 300, port: 6390, "wait-ms": 0 });
const NAME = "md9-redis-restart";
const REDIS_TEST_URL = `redis://localhost:${opt.port}`;

const CONFIGS = {
  "default (RDB snapshots only)": [],
  "AOF, fsync every second": ["--appendonly", "yes", "--appendfsync", "everysec"],
  "AOF, fsync always": ["--appendonly", "yes", "--appendfsync", "always"],
};

const docker = (...a) =>
  execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function removeContainer() {
  try {
    docker("rm", "-f", NAME);
  } catch {
    // not running
  }
}

async function waitReady() {
  for (let i = 0; i < 100; i++) {
    const r = createRedis(REDIS_TEST_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: null,
    });
    r.on("error", () => {});
    try {
      await r.connect();
      // PING answers LOADING while the AOF is replayed, which throws here.
      await r.ping();
      return r;
    } catch {
      r.disconnect();
      await sleep(100);
    }
  }
  throw new Error("Redis did not come up");
}

const users = Array.from({ length: opt.users }, (_, i) => `u${String(i).padStart(4, "0")}`);

async function burst(redis, sid) {
  const lat = [];
  const accepted = await Promise.all(
    users.map(async (user) => {
      const t = performance.now();
      const ok = await submit(redis, { sid, qid: "q1", user, option: "A", points: 700 });
      lat.push(performance.now() - t);
      return ok;
    }),
  );
  return { accepted: accepted.filter(Boolean).length, lat };
}

async function state(redis, sid) {
  const k = keys(sid, "q1");
  const [answers, votes, lb, stream] = await Promise.all([
    redis.hlen(k.answers),
    redis.hget(k.votes, "A"),
    redis.zcard(k.lb),
    redis.xlen(k.stream),
  ]);
  return { answers, votes: Number(votes ?? 0), leaderboard: lb, stream };
}

const db = await pgdb.connect();
const results = [];

for (const [label, flags] of Object.entries(CONFIGS)) {
  for (const stop of ["crash", "graceful"]) {
    const sid = `restart-${results.length}`;
    removeContainer();
    docker(
      "run",
      "-d",
      "--name",
      NAME,
      "-p",
      `${opt.port}:6379`,
      "redis:7-alpine",
      "redis-server",
      ...flags,
    );
    let redis = await waitReady();
    await resetSession(redis, sid, ["q1"]);
    await pgdb.resetSession(db, sid);

    const first = await burst(redis, sid);
    const before = await state(redis, sid);
    if (opt["wait-ms"] > 0) await sleep(opt["wait-ms"]);
    redis.disconnect();

    if (stop === "crash") {
      docker("kill", NAME);
      docker("start", NAME);
    } else {
      docker("restart", NAME);
    }
    redis = await waitReady();
    const after = await state(redis, sid);

    const flushed = await flushOnce(redis, db, sid);
    const pgRows = await pgdb.countAnswers(db, sid);
    const second = await burst(redis, sid);
    const pgAfterSecond = (await flushOnce(redis, db, sid), await pgdb.countAnswers(db, sid));

    const res = {
      config: label,
      stop,
      submitP95: summary(first.lat).p95,
      before,
      after,
      lost: before.stream - after.stream,
      reachedPostgres: pgRows,
      flushedRows: flushed.inserted,
      acceptedAgain: second.accepted,
      pgRowsAfterResubmit: pgAfterSecond,
    };
    results.push(res);
    console.log(
      `${label.padEnd(30)} ${stop.padEnd(8)} | submit p95 ${res.submitP95} | answers ${before.answers} -> ${after.answers}` +
        ` | lost ${res.lost} | reached PG ${pgRows} | accepted again ${second.accepted} | PG rows after resubmit ${pgAfterSecond}`,
    );
    redis.disconnect();
  }
}

removeContainer();
mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/restart.json", import.meta.url), JSON.stringify(results, null, 2));
await db.end();
