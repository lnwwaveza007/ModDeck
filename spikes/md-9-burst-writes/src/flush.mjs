// Batch flush from the Redis stream to PostgreSQL.
//
// Each submit adds one stream entry. The flusher reads entries through a
// consumer group, writes them in one INSERT, and only then acks and deletes
// them. If the flusher dies between the INSERT and the ack, the entries stay
// pending and are read again on the next pass (id "0"); the primary key and
// ON CONFLICT DO NOTHING drop the repeats. At-least-once delivery plus an
// idempotent insert gives each answer exactly one row.

import { GROUP, keys } from "./store.mjs";
import { insertAnswers } from "./db.mjs";

async function ensureGroup(redis, stream) {
  try {
    // Start at 0, not $, so entries written before the group existed (for
    // example after Redis restarts and loses the group) are not skipped.
    await redis.xgroup("CREATE", stream, GROUP, "0", "MKSTREAM");
  } catch (err) {
    if (!String(err.message).startsWith("BUSYGROUP")) throw err;
  }
}

const toRow = ([, fields]) => {
  const row = {};
  for (let i = 0; i < fields.length; i += 2) row[fields[i]] = fields[i + 1];
  return row;
};

export async function flushOnce(redis, db, sid, { count = 1000, consumer = "flusher-1" } = {}) {
  const stream = keys(sid, "").stream;
  await ensureGroup(redis, stream);
  let read = 0;
  let inserted = 0;
  // "0" = entries this consumer read before but never acked; ">" = new ones.
  for (const from of ["0", ">"]) {
    for (;;) {
      const res = await redis.xreadgroup(
        "GROUP",
        GROUP,
        consumer,
        "COUNT",
        count,
        "STREAMS",
        stream,
        from,
      );
      const entries = res?.[0]?.[1] ?? [];
      if (entries.length === 0) break;
      inserted += await insertAnswers(db, sid, entries.map(toRow));
      const ids = entries.map(([id]) => id);
      await redis
        .multi()
        .xack(stream, GROUP, ...ids)
        .xdel(stream, ...ids)
        .exec();
      read += entries.length;
      if (entries.length < count) break;
    }
  }
  return { read, inserted };
}

// Flush every intervalMs until stopped. stop() runs one last full flush,
// which is what "on activity close" means in the product.
export function startFlusher(redis, db, sid, intervalMs = 1000) {
  const stats = { passes: 0, read: 0, inserted: 0, maxBatchMs: 0 };
  let running = true;
  let timer;
  let current = Promise.resolve();

  const pass = async () => {
    const t0 = performance.now();
    const r = await flushOnce(redis, db, sid);
    stats.passes++;
    stats.read += r.read;
    stats.inserted += r.inserted;
    if (r.read > 0) stats.maxBatchMs = Math.max(stats.maxBatchMs, performance.now() - t0);
  };

  const tick = () => {
    current = pass().finally(() => {
      if (running) timer = setTimeout(tick, intervalMs);
    });
  };
  timer = setTimeout(tick, intervalMs);

  return {
    stats,
    async stop() {
      running = false;
      clearTimeout(timer);
      await current;
      await pass();
      return stats;
    },
  };
}
