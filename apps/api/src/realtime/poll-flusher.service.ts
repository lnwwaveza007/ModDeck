import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import Redis, { type Result } from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { flushStreamKey } from "./poll-store.service";
import { wordFlushStreamKey } from "./word-store.service";

const FLUSH_INTERVAL_MS = 1000;
const BATCH_SIZE = 1000;
// Longer than any batch takes (MD-9: 7 to 20 ms). A flusher that dies frees the session after this.
const LOCK_MS = 10_000;
const LOCK_WAIT_MS = 3000;
const LOCK_POLL_MS = 25;

const lockKey = (sessionId: string) => `flushlock:{${sessionId}}`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

declare module "ioredis" {
  interface RedisCommander<Context> {
    releaseFlushLock(key: string, token: string): Result<number, Context>;
  }
}

interface StreamEntry {
  run: string;
  participant: string;
  option: string;
  at: string;
  changed: boolean;
  afterReopen: boolean;
}

interface WordStreamEntry {
  id: string;
  run: string;
  participant: string;
  text: string;
  key: string;
  hidden: boolean;
  at: string;
}

function fieldsOf(fields: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) row[fields[i]] = fields[i + 1];
  return row;
}

function parseWordEntry(fields: string[]): WordStreamEntry {
  const row = fieldsOf(fields);
  return {
    id: row.i,
    run: row.r,
    participant: row.p,
    text: row.t,
    key: row.k,
    hidden: row.h === "1",
    at: new Date(Number(row.c)).toISOString(),
  };
}

function parseEntry(fields: string[]): StreamEntry {
  const row = fieldsOf(fields);
  return {
    run: row.r,
    participant: row.p,
    option: row.o,
    at: new Date(Number(row.t)).toISOString(),
    changed: row.c === "1",
    afterReopen: row.a === "1",
  };
}

/**
 * Writes accepted answers and word entries from the Redis streams to PostgreSQL (MD-9): one
 * statement per batch, every second while an activity is live and once when it closes. Entries
 * leave the stream only after the write. A crash in between writes them again, and the primary
 * key of answers and word_entries (the client answerId) drops the repeats. One flusher per session
 * at a time keeps a changed answer in order.
 */
@Injectable()
export class PollFlusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollFlusherService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {
    this.redis.defineCommand("releaseFlushLock", { numberOfKeys: 1, lua: RELEASE_SCRIPT });
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const live = await this.prisma.activityRun.findMany({
        where: { state: "live" },
        select: { sessionId: true },
        distinct: ["sessionId"],
      });
      for (const { sessionId } of live) await this.flush(sessionId, false);
    } catch (err) {
      this.logger.error(`Answer flush failed: ${String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** The last write when a poll closes. It waits for a flush that is already running. */
  async finalFlush(sessionId: string): Promise<void> {
    await this.flush(sessionId, true);
  }

  private async flush(sessionId: string, wait: boolean) {
    const key = lockKey(sessionId);
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (!(await this.redis.set(key, token, "PX", LOCK_MS, "NX"))) {
      if (!wait) return;
      if (Date.now() >= deadline) {
        this.logger.warn(`Gave up waiting for the answer flush of session ${sessionId}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    try {
      await this.drain(flushStreamKey(sessionId), (fields) => this.write(fields.map(parseEntry)));
      await this.drain(wordFlushStreamKey(sessionId), (fields) =>
        this.writeWords(fields.map(parseWordEntry)),
      );
    } finally {
      await this.redis.releaseFlushLock(key, token);
    }
  }

  // Reads a stream in batches and removes each batch once `write` has stored it.
  private async drain(stream: string, write: (entries: string[][]) => Promise<void>) {
    for (;;) {
      const entries = await this.redis.xrange(stream, "-", "+", "COUNT", BATCH_SIZE);
      if (entries.length === 0) return;
      await write(entries.map(([, fields]) => fields));
      await this.redis.xdel(stream, ...entries.map(([id]) => id));
    }
  }

  private async writeWords(entries: WordStreamEntry[]) {
    await this.prisma.$executeRaw`
      INSERT INTO word_entries (id, activity_run_id, participant_id, text, normalized_text, hidden, created_at)
      SELECT * FROM unnest(
        ${entries.map((e) => e.id)}::uuid[],
        ${entries.map((e) => e.run)}::uuid[],
        ${entries.map((e) => e.participant)}::uuid[],
        ${entries.map((e) => e.text)}::text[],
        ${entries.map((e) => e.key)}::text[],
        ${entries.map((e) => e.hidden)}::boolean[],
        ${entries.map((e) => e.at)}::timestamptz[]
      )
      ON CONFLICT DO NOTHING`;
  }

  private async write(entries: StreamEntry[]) {
    // Stream order: the last entry of a participant is the answer that counts.
    const latest = new Map<string, StreamEntry>();
    for (const entry of entries) latest.set(`${entry.run}:${entry.participant}`, entry);
    const rows = [...latest.values()];
    const changed = entries.filter((entry) => entry.changed);

    await this.prisma.$transaction(async (tx) => {
      if (changed.length > 0) {
        await tx.$executeRaw`
          DELETE FROM answers AS a
          USING unnest(${changed.map((e) => e.run)}::uuid[], ${changed.map((e) => e.participant)}::uuid[])
            AS d(run_id, participant_id)
          WHERE a.activity_run_id = d.run_id AND a.participant_id = d.participant_id`;
      }
      await tx.$executeRaw`
        INSERT INTO answers (activity_run_id, participant_id, option_id, after_reopen, answered_at)
        SELECT * FROM unnest(
          ${rows.map((e) => e.run)}::uuid[],
          ${rows.map((e) => e.participant)}::uuid[],
          ${rows.map((e) => e.option)}::uuid[],
          ${rows.map((e) => e.afterReopen)}::boolean[],
          ${rows.map((e) => e.at)}::timestamptz[]
        )
        ON CONFLICT DO NOTHING`;
    });
  }
}
