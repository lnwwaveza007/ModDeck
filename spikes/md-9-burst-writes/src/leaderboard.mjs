// Leaderboard read time with 300 players after a 10-question quiz.
//
// Reads timed:
//   top-10      ZREVRANGE lb 0 9 WITHSCORES (the board on the projector)
//   own rank    ZREVRANK + ZSCORE in one pipeline (each student's phone)
//   burst       all 300 players ask for top-10 + own rank at the same moment
//   PostgreSQL  the same top-10 from md9_answer with GROUP BY, for comparison
//
//   node src/leaderboard.mjs [--players 300] [--questions 10] [--reads 2000]

import { mkdirSync, writeFileSync } from "node:fs";
import { createRedis, keys, resetSession, submit } from "./store.mjs";
import * as pgdb from "./db.mjs";
import { flushOnce } from "./flush.mjs";
import { args, summary } from "./util.mjs";

const opt = args({ players: 300, questions: 10, reads: 2000, conns: 50 });
const sid = "leaderboard";
const qids = Array.from({ length: opt.questions }, (_, i) => `q${i + 1}`);
const players = Array.from({ length: opt.players }, (_, i) => `u${String(i).padStart(4, "0")}`);

const redis = createRedis();
const conns = Array.from({ length: opt.conns }, () => createRedis());
const db = await pgdb.connect();
await resetSession(redis, sid, qids);
await pgdb.resetSession(db, sid);

// Fill: every player answers every question, about 60% correct.
for (const qid of qids) {
  await Promise.all(
    players.map((user, i) => {
      const correct = Math.random() < 0.6;
      return submit(conns[i % conns.length], {
        sid,
        qid,
        user,
        option: correct ? "A" : "B",
        points: correct ? 500 + Math.floor(Math.random() * 500) : 0,
      });
    }),
  );
}
await flushOnce(redis, db, sid);
const lbKey = keys(sid, "").lb;
console.log(
  `${await redis.zcard(lbKey)} players on the board, ${await pgdb.countAnswers(db, sid)} answers in PostgreSQL`,
);

async function time(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn(i);
    out.push(performance.now() - t);
  }
  return out;
}

const top10 = await time(opt.reads, () => redis.zrevrange(lbKey, 0, 9, "WITHSCORES"));
const ownRank = await time(opt.reads, (i) =>
  redis
    .pipeline()
    .zrevrank(lbKey, players[i % players.length])
    .zscore(lbKey, players[i % players.length])
    .exec(),
);

const burst = [];
const tb = performance.now();
await Promise.all(
  players.map(async (user, i) => {
    const t = performance.now();
    const c = conns[i % conns.length];
    await Promise.all([
      c.zrevrange(lbKey, 0, 9, "WITHSCORES"),
      c.pipeline().zrevrank(lbKey, user).zscore(lbKey, user).exec(),
    ]);
    burst.push(performance.now() - t);
  }),
);
const burstWall = performance.now() - tb;

const pgTop10 = await time(Math.min(opt.reads, 500), () => pgdb.topScores(db, sid, 10));

// Both sides must agree on the board.
const redisTop = await redis.zrevrange(lbKey, 0, 9, "WITHSCORES");
const pgTop = await pgdb.topScores(db, sid, 10);
const agree = pgTop.every((r, i) => redisTop[i * 2 + 1] === String(r.score));

const result = {
  players: opt.players,
  questions: opt.questions,
  "Redis top-10": summary(top10),
  "Redis own rank": summary(ownRank),
  [`Redis burst (${opt.players} players at once)`]: {
    ...summary(burst),
    wall: `${burstWall.toFixed(1)} ms`,
  },
  "PostgreSQL top-10 (GROUP BY)": summary(pgTop10),
  "Redis and PostgreSQL top-10 scores agree": agree,
};
console.log(result);

mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
writeFileSync(new URL("../out/leaderboard.json", import.meta.url), JSON.stringify(result, null, 2));

await Promise.all([redis, ...conns].map((c) => c.quit()));
await db.end();
