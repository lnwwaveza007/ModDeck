# MD-9 Findings: Burst writes and leaderboard

**Verdict: pass. Redis-first writes with one Lua script per answer, plus a batch flush to PostgreSQL, take 300 answers in one burst with no lost and no double-counted answers. The leaderboard top-10 reads in under 1 ms.**

- **Correctness.** In 10 rounds of 600 submits (300 users, and 100 of them send 3 extra answers at the same moment), exactly 300 answers were accepted every time. Redis counts, the leaderboard and the PostgreSQL rows all match. The non-atomic version of the same code accepted all 600 submits and counted 600 votes (section 4).
- **Speed.** The submit script runs for about **22–32 µs** inside Redis. With 600 submits spread over 1 s, a submit takes **0.88 ms p50 / 1.63 ms p95** end to end. With all 600 at the same instant, p95 is 79 ms, and nearly all of that is the test client queueing its own requests (section 4).
- **Flush.** One INSERT per batch. A flush pass of up to 300 rows takes **7–20 ms**, so a 1 s flush interval is safe.
- **Leaderboard.** Top-10 from the Redis sorted set: **0.46 ms p50 / 0.63 ms p95**. All 300 players reading top-10 and their own rank at the same moment: 71 ms p95. The same top-10 from PostgreSQL with `GROUP BY`: 3.7 ms p50 (section 5).
- **Redis restart before a flush.** With the current compose Redis (default settings, no AOF), a crash loses **every unflushed answer**, and those users can then answer again. With AOF on, a crash lost nothing. Recommendation: turn on AOF (`everysec`) for the product Redis (section 6).

## 1. Goal and acceptance criteria

Prove the write strategy that avoids database bottlenecks and race conditions when 300 users answer at once.

- [x] Votes and scores written to Redis first (INCR / ZSET): `HINCRBY` for votes, `ZINCRBY` for scores, inside one Lua script
- [x] Batch flush from Redis to PostgreSQL: a Redis stream and a consumer group, flushed every N ms and on activity close
- [x] Concurrency test shows no lost or double-counted answers: 10 of 10 rounds pass all 10 checks (section 4)
- [x] Leaderboard top-N read time recorded (section 5)
- [x] Findings note written

## 2. Setup

| Item | Value |
| --- | --- |
| Machine | AMD Ryzen 5 5500 (6 cores / 12 threads), 16 GB RAM, Windows 11. Docker Desktop 28.5.1 (WSL 2). |
| Runtime | Node.js 22.13.0, `ioredis` 5, `pg` 8.23.1 |
| Redis | `redis:7-alpine` (7.4.11) from `docker-compose.yml`, default settings |
| PostgreSQL | `pgvector/pgvector:pg17` (17.11) from `docker-compose.yml` |
| Client | One Node process. 300 Redis connections, one per simulated user. |

The test client, Redis and PostgreSQL all run on the same PC. This spike tests correctness and the cost of each Redis and PostgreSQL step. The network and load-generator side (separate machine, WebSockets, 300 sockets on the API) is MD-8.

## 3. Design

### Redis keys

All keys of one live session share the `{sid}` hash tag, so they sit in one slot and the Lua script also works on Redis Cluster.

| Key | Type | Content | Written with |
| --- | --- | --- | --- |
| `ans:{sid}:<qid>` | hash | user → option | `HSETNX` (blocks a second answer) |
| `votes:{sid}:<qid>` | hash | option → count | `HINCRBY` |
| `lb:{sid}` | sorted set | user → total score | `ZINCRBY` |
| `flush:{sid}` | stream | one entry per accepted answer | `XADD` |

The ticket suggests `SET NX` on one key per user. `HSETNX` on one hash per question does the same job with 1 key instead of 300, and `HGETALL` reads all answers back in one call.

### Submit (one atomic step)

`src/store.mjs` defines one Lua script. Redis runs a script from start to finish with no other command in between, so two answers from the same user can never both pass the check.

```lua
if redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[3]) == 0 then
  return 0                                   -- already answered
end
redis.call('HINCRBY', KEYS[2], ARGV[3], 1)   -- vote count
if tonumber(ARGV[4]) > 0 then
  redis.call('ZINCRBY', KEYS[3], ARGV[4], ARGV[1])   -- score
end
redis.call('XADD', KEYS[4], '*', 'q', ARGV[2], 'u', ARGV[1], 'o', ARGV[3], 'p', ARGV[4], 't', ARGV[5])
return 1
```

`MULTI` alone cannot do this, because the "already answered?" check must decide whether the writes happen. `WATCH` + `MULTI` could, but it retries under contention, and a burst is exactly when contention is highest.

### Flush to PostgreSQL

`src/flush.mjs` reads the stream through a consumer group and writes each batch with one INSERT (`unnest` of arrays, so one statement for any number of rows). It acks and deletes the entries only after the INSERT returns.

- If the flusher dies after the INSERT but before the ack, the entries stay pending. The next pass reads them again (id `0`) and inserts them again.
- The table has `PRIMARY KEY (session_id, question_id, user_id)` and the INSERT uses `ON CONFLICT DO NOTHING`, so a repeated entry adds no row.

At-least-once delivery plus an idempotent INSERT gives each answer exactly one row. The primary key is also the last guard if Redis ever lets a duplicate answer through (section 6).

PostgreSQL stores answers only. Vote counts and scores come from the answer rows (`count(*)` and `sum(points)`), so there is no counter in PostgreSQL that can drift from Redis.

## 4. Concurrency test

`src/burst.mjs`, 5 rounds per run. Each round: 300 users answer one question. 100 of those users send 3 extra answers with random options (double taps, two tabs), so 600 submits in total, shuffled. The flusher runs during the burst every 200 ms, and one final flush runs at "activity close".

Each round checks:

1. accepted == 300
2. no user accepted twice
3. Redis answers hash has 300 users
4. Redis vote total == 300
5. Redis vote counts match the options in the answers hash
6. leaderboard scores match the points of the accepted answers
7. PostgreSQL has 300 rows
8. PostgreSQL vote counts (`GROUP BY option`) match Redis
9. every PostgreSQL answer matches the Redis answer for that user
10. stream is empty after the final flush

### Results

| Run | Submits | Accepted | Redis votes | PostgreSQL rows | Checks |
| --- | --- | --- | --- | --- | --- |
| Lua script, spread over 1 s | 600 × 5 | 300 every round | 300 | 300 | 10/10, 5 of 5 rounds |
| Lua script, all at once | 600 × 5 | 300 every round | 300 | 300 | 10/10, 5 of 5 rounds |
| Non-atomic, all at once | 600 × 5 | **600** every round | **600** | 300 | 4/10, 0 of 5 rounds |
| Non-atomic, spread over 1 s | 600 × 2 | **302** every round | **302** | 300 | fail, 0 of 2 rounds |

The non-atomic version (`submitNaive`) does the obvious thing: `HEXISTS`, then the writes, in separate round trips. When all submits arrive at once, every duplicate passes the check, so every duplicate user gets 4 votes counted. Even with the submits spread over 1 s, 2 users per round got through twice. PostgreSQL still ends up with 300 rows because of the primary key, but its rows no longer match Redis: Redis keeps the last answer written, PostgreSQL keeps the first one flushed. This is the race the Lua script removes.

### Latency (Lua script)

| Measure | Spread over 1 s | All 600 at once |
| --- | --- | --- |
| Burst wall time | 1,001–1,013 ms (the spread window) | 80–98 ms |
| Submit p50 / p95 / p99 | 0.88 / 1.63 / 2.40 ms | 45.8 / 79.0 / 84.5 ms |
| Submit max | 3.70 ms | 88.6 ms |
| Script time inside Redis | 22–27 µs | 22–32 µs |
| Flush passes per round | 5 | 1 |
| Slowest flush pass | 6.8–12.1 ms | 11.3–19.8 ms |

Redis spends about 25 µs per submit, so 600 submits cost Redis about 15 ms in total. The 79 ms p95 in the "all at once" run is the test client: one Node event loop sends 600 requests over 300 sockets in the same tick and waits for all of them. In the product the submits arrive over the network from 300 phones and are spread out by that alone, so the "spread over 1 s" numbers are the realistic ones.

## 5. Leaderboard

`src/leaderboard.mjs`: 300 players answer 10 questions (about 60% correct, 500–999 points per correct answer), so 3,000 answers. 2,000 sequential reads per Redis measure, 500 for PostgreSQL.

| Read | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- |
| Redis top-10 (`ZREVRANGE lb 0 9 WITHSCORES`) | 0.46 ms | 0.63 ms | 0.79 ms | 1.59 ms |
| Redis own rank (`ZREVRANK` + `ZSCORE`, pipelined) | 0.48 ms | 0.69 ms | 0.95 ms | 3.47 ms |
| Redis, all 300 players read top-10 + own rank at once | 42.7 ms | 70.9 ms | 72.3 ms | 73.1 ms (77 ms wall) |
| PostgreSQL top-10 (`sum(points) GROUP BY user_id`) | 3.72 ms | 5.53 ms | 6.38 ms | 7.88 ms |

The Redis and PostgreSQL top-10 scores were identical. The "all at once" row has the same client queueing effect as section 4. In the product, the API should not let 300 phones each ask for the board: it should read top-10 once after each question and push it to the room, and push each player's own rank with it.

## 6. Redis restart before a flush

`src/restart.mjs` starts a separate Redis container on port 6390 for each setting, takes 300 answers with **no flush**, stops Redis, starts it again, and counts what survived. It then flushes to PostgreSQL, and then submits the same 300 users again to see whether the duplicate check still works.

| Redis setting | Stop | Answers before → after | Lost | Reached PostgreSQL | Accepted again |
| --- | --- | --- | --- | --- | --- |
| Default (RDB snapshots only) | crash (`docker kill`) | 300 → 0 | **300** | 0 | **300** |
| Default (RDB snapshots only) | graceful (`docker restart`) | 300 → 300 | 0 | 300 | 0 |
| AOF, `appendfsync everysec` | crash | 300 → 300 | 0 | 300 | 0 |
| AOF, `appendfsync everysec` | graceful | 300 → 300 | 0 | 300 | 0 |
| AOF, `appendfsync always` | crash | 300 → 300 | 0 | 300 | 0 |
| AOF, `appendfsync always` | graceful | 300 → 300 | 0 | 300 | 0 |

What this means:

- **Default settings (what `docker-compose.yml` runs today).** Redis saves a snapshot on a clean shutdown, so a graceful restart loses nothing. On a crash, everything since the last snapshot is lost. The default snapshot rules are 1 change in 1 h, 100 changes in 5 min, or 10,000 changes in 1 min, so for a normal class the data loss window is **minutes**, not the flush interval. The lost users also lose their "already answered" mark and can answer again.
- **AOF `everysec`.** No loss on a process crash, because the data is already written to the file (the OS writes it to disk later). A crash of the whole machine or VM can lose up to about 1 s of answers. Submit latency did not change in a measurable way (p95 14–48 ms in this test, all within the noise of the throwaway container).
- **AOF `always`.** Also no loss, and it would cover a machine crash too, but it calls fsync on every write. With the flush running every second, the extra safety is not worth it.

With AOF `everysec`, the worst case is the last ~1 s of answers after a machine crash. Those answers were never in PostgreSQL either. The instructor sees missing votes for that question, and nothing is double-counted.

## 7. Recommendations for the product (MD-17, MD-18)

1. **Use the Lua submit script as is** for votes, quiz answers and scores. Return "already answered" to the client when it returns 0.
2. **Turn on AOF in the product Redis:** `redis-server --appendonly yes --appendfsync everysec`, with a volume for `/data`. The dev compose file can stay as it is, but the test server and production must not run Redis without AOF.
3. **Flush every 1 s while an activity is open, and once more on activity close.** Close the activity in the UI only after the final flush returns, so results in PostgreSQL are complete.
4. **Keep the primary key and `ON CONFLICT DO NOTHING`** on the answer table. It makes the flush safe to repeat and catches duplicates if Redis loses data.
5. **Push the leaderboard, do not poll it.** Read top-10 once per question and broadcast it with each player's own rank.
6. **After Redis loses data, rebuild before reopening.** If the API finds an active session with no Redis keys, reload the answers hash, vote counts and leaderboard for that session from PostgreSQL before it accepts new answers. Without this step, users whose answers were already flushed can answer again: PostgreSQL would drop the second row, but the live vote count would include it. This spike did not build the rebuild step.

## 8. Not covered

- Network, WebSocket fan-out and a load generator on another machine: MD-8.
- More than one API instance. The Lua script is atomic inside Redis, so more API instances do not change the result. Run one flusher per session. If several flushers share the group, each needs its own consumer name, and entries left pending by a dead flusher must be taken over with `XAUTOCLAIM`, because a flusher only re-reads its own pending entries.
- Redis Sentinel or replicas. With one Redis, a Redis outage stops answer submission until Redis is back.

## 9. Run it

```sh
docker compose up -d postgres redis
cd spikes/md-9-burst-writes
node src/burst.mjs                          # Lua script, submits spread over 1 s
node src/burst.mjs --spread-ms 0            # all submits at the same instant
node src/burst.mjs --mode naive --spread-ms 0
node src/leaderboard.mjs
node src/restart.mjs                        # needs Docker; uses port 6390
```

Each script writes its numbers to `out/` (ignored by git). Options: `--users`, `--dupes`, `--extra`, `--conns`, `--rounds`, `--flush-ms`, `--spread-ms` for `burst.mjs`; `--players`, `--questions`, `--reads` for `leaderboard.mjs`.
