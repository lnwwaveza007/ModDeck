// Redis-first write path for answers, votes and the leaderboard.
//
// Keys for one live session (the {sid} hash tag keeps them in one slot, so
// the Lua script also works on Redis Cluster):
//   ans:{sid}:<qid>    hash  user -> option   one answer per user (HSETNX)
//   votes:{sid}:<qid>  hash  option -> count  live vote counts (HINCRBY)
//   lb:{sid}           zset  user -> score    leaderboard (ZINCRBY)
//   flush:{sid}        stream                 answers waiting for PostgreSQL
//
// HSETNX on one hash per question does the same job as SET NX on one key per
// user, with 1 key instead of 300 and one HGETALL to read all answers back.

import Redis from "ioredis";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const GROUP = "pg-flush";

export const keys = (sid, qid) => ({
  answers: `ans:{${sid}}:${qid}`,
  votes: `votes:{${sid}}:${qid}`,
  lb: `lb:{${sid}}`,
  stream: `flush:{${sid}}`,
});

// Check, count, score and queue in one atomic step. Redis runs a script
// start to finish with no other command in between, so two submits from the
// same user can never both pass the HSETNX.
const SUBMIT_LUA = `
if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[3]) == 0 then
  return 0
end
redis.call('HINCRBY', KEYS[2], ARGV[3], 1)
local points = tonumber(ARGV[4])
if points > 0 then
  redis.call('ZINCRBY', KEYS[3], points, ARGV[1])
end
redis.call('XADD', KEYS[4], '*', 'q', ARGV[2], 'u', ARGV[1], 'o', ARGV[3], 'p', ARGV[4], 't', ARGV[5])
return 1
`;

export function createRedis(url = REDIS_URL, opts = {}) {
  const redis = new Redis(url, { lazyConnect: false, ...opts });
  redis.defineCommand("submitAnswer", { numberOfKeys: 4, lua: SUBMIT_LUA });
  return redis;
}

// Returns true if the answer was accepted, false if the user already answered.
export async function submit(redis, { sid, qid, user, option, points }) {
  const k = keys(sid, qid);
  const ok = await redis.submitAnswer(
    k.answers,
    k.votes,
    k.lb,
    k.stream,
    user,
    qid,
    option,
    points,
    Date.now(),
  );
  return ok === 1;
}

// The obvious non-atomic version, kept only to show why the script matters:
// check first, then write in separate round trips.
export async function submitNaive(redis, { sid, qid, user, option, points }) {
  const k = keys(sid, qid);
  if (await redis.hexists(k.answers, user)) return false;
  await redis.hset(k.answers, user, option);
  await redis.hincrby(k.votes, option, 1);
  if (points > 0) await redis.zincrby(k.lb, points, user);
  await redis.xadd(k.stream, "*", "q", qid, "u", user, "o", option, "p", points, "t", Date.now());
  return true;
}

export async function resetSession(redis, sid, qids) {
  const ks = qids.flatMap((q) => [keys(sid, q).answers, keys(sid, q).votes]);
  await redis.del(...ks, keys(sid, "").lb, keys(sid, "").stream);
}
