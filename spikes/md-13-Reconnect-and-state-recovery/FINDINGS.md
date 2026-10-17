# MD-13 Findings: reconnect, rejoin and restart

Date: 2026-10-17 · Node v22.22.2 · socket.io 4.x

## Result

**All 13 tests pass** (`test/reconnect.test.mjs`, full real-time drops of 5 s / 30 s / 2 min, 182 s wall time).
**3 additional probes pass** (`test/probes.test.mjs`) covering gaps the suite did not reach (longer outage, hard crash, persistence cost).

Later rounds fixed four of the issues found (see "Fixed after the first run"). After those fixes the full run is **36/36**.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Client drops network mid-quiz and rejoins the same session automatically | Pass | `auto rejoin after network drop…` (server force-drops sockets, `QuizClient` reconnects with the same `userId`). Probe A: server fully down 6 s with default backoff, client rejoins on its own. |
| Answers, score, and team are restored after rejoin | Pass | Same tests assert score 100, same team, `answers.q1.option`, the question shown while offline, and `lastSeq` equal to the server's. Raw-socket tests (5 s / 30 s / 2 min) also assert missed `question_shown` events are replayed. |
| Answer submission is idempotent (retry does not double count) | Pass | Same `answerId` re-sent → `duplicate: true`, tally stays 1. A different `answerId` for the same question → also duplicate. Retry after the question moved on → duplicate, not an error. Offline-queued answer flushed on rejoin counts once. Probe B: retry after a crash is still a duplicate, score stays 100. |
| Server restart scenario tested | Pass | In-process restart with live client; real child-process restart (SIGTERM) restores session from disk; Probe B: **SIGKILL** immediately after an ack, restart, answer and score survive. The uploaded `state.json` also loads and resumes its session (team Red, score 100, answer q1, 2 missed events). |
| Findings note written | Done | This file. |

## What the design gets right

- **Sequence numbers + snapshot + `hello`** is a sound resume protocol. Clients send `lastSeq`, the server returns the current snapshot plus every missed event. Verified monotonic.
- **Two layers of idempotency.** An `answerId` map catches retries; a one-answer-per-question check catches different IDs. The `answerId` check runs *before* the "question still active" check, which is why a lost-ack retry after the question advanced returns `duplicate` instead of `QUESTION_CLOSED`.
- **Ack implies durable.** The `answer` handler awaits `store.writing` before replying, so any answer the client saw acknowledged is on disk. Probe B confirms this survives `kill -9`. Keep this invariant if persistence is optimised (see 1).
- **Atomic state writes** (write `.tmp`, then rename): 0 torn reads across 40 concurrent read/write cycles on a ~1 MB file. A leftover `state_json.tmp` is harmless because `load()` only reads `state.json`.

## Fixed after the first run

| # | Problem | Fix | Where |
|---|---|---|---|
| 1 | Event log grew forever and was rewritten to disk with every change | Log capped at `maxEvents` (default 500), trimmed on append and on load, so the state file stays bounded. `seq` keeps counting. If a client is behind the oldest kept event, `sync` replies `mode: "snapshot"` (rebuild from snapshot + `you`) instead of `"replay"`. | `store.mjs` |
| 2 | Tokens never expired on the server (the cookie did after 8 h) | Tokens carry `expiresAt`, checked in `resolveToken` (a missing value fails closed). Sliding: extended when under half the lifetime is left, so active players are not cut off and there is no write per call. Expired tokens are pruned on load and on join (participants and scores are kept). Tokens in older state files get a fresh lifetime on load. The cookie `Max-Age` now comes from the same setting. | `store.mjs`, `cookie.mjs`, `server.mjs` |
| 3 | Client read `ack.correct` and `sync.mode`, which the server never sent | Server now sends `correct` and `points` on every answer ack (including duplicates, reporting the stored answer) and `mode` on every sync. Client stores `points`/`correct` on its local answer and exposes `lastResumeMode`. | `store.mjs`, `server.mjs`, `client.mjs` |
| 4 | Every change triggered its own full rewrite of the state file (1000 changes = 1001 writes, 2.3 s; the 4000-event test took about 24 s) | Write coalescing: a change only bumps a version number; one writer loop serialises the state, writes it and records which version it covered. Changes made during a write are picked up together by one trailing write. `store.writing` is now a promise that resolves only when a write covering every change made so far has finished, so the server still acks only after the data is on disk. A failed write rejects the waiters and is retried on the next change or `await store.writing`. | `store.mjs` |

Settings (Store constructor options, also reachable through `createApp({ storeOptions })`): `tokenTtlMs` (default 8 h), `maxEvents` (default 500), `now` (injectable clock for tests).

Tests: `test/fixes.test.mjs` adds 12 tests (fixes 1 to 3). All 12 fail on the old code and pass on the new. `test/persistence.test.mjs` adds 8 tests for fix 4; three deliberately broken versions of the writer (late flag reset, ack released while a write is in flight, change marked flushed too early) were each caught by them. One existing test changed: the crash-safety test now creates its store with `maxEvents: Infinity`, otherwise the new cap would shrink the ~1 MB file it needs to stress atomic writes.

Before and after for fix 4: 1000 back-to-back changes went from 1001 file writes (2.3 s) to 2 writes (4 ms); 40 concurrent answers over the socket cost 2 writes, and every acked answer was already in the file when the ack arrived; the crash-safety test went from about 24 s to 0.5 s.

**Final run: 36/36 pass** (real 5 s / 30 s / 2 min drops, 168 s).

## Still open

1. **Cookie is not `HttpOnly`/`Secure`** and holds the bearer token as plain JSON. Acceptable for a spike, not for production.
2. **Each write still serialises the whole state.** The number of writes is now small and the size is bounded by the event cap, but a very large number of participants would still make each write heavy. If that becomes a problem, the next step is an append-only journal with periodic snapshots. Not needed at current sizes.
3. **Test coverage notes.**
   - The 5 s / 30 s / 2 min tests reconnect manually with a raw socket, so they verify server-side resume, not the client's retry loop. The loop is covered by the `QuizClient` tests (short outages) and Probe A (6 s). A 2-minute outage with the loop running is not tested; backoff is capped at 1.5 s so it should keep retrying, but this is inferred.
   - Not tested: a restart that *loses* the state file. From the code the client would get `INVALID_TOKEN`, mark the session ended and drop its queue.
   - Default suite takes about 3 minutes; set `MD13_QUICK=1` for 0.2 / 0.5 / 1 s drops.

## How to run

```
npm install
node --test test/reconnect.test.mjs test/fixes.test.mjs test/persistence.test.mjs test/probes.test.mjs
MD13_QUICK=1 node --test test/reconnect.test.mjs   # fast mode
```

On Node 22, `node --test test/` (bare directory) fails; pass file paths or a glob.
