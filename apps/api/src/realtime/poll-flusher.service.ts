import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import Redis, { type Result } from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { flushStreamKey } from "./poll-store.service";

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

function parseEntry(fields: string[]): StreamEntry {
  const row: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) row[fields[i]] = fields[i + 1];
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
 * Writes accepted answers from the Redis stream to PostgreSQL (MD-9): one statement per batch,
 * every second while a poll is live and once when it closes. Entries leave the stream only after
 * the write. A crash in between writes them again, and the primary key of answers drops the
 * repeats. One flusher per session at a time keeps a changed answer in order.
 */
@Injectable()
export class PollFlusherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollFlusherService.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private retryDelayMs = FLUSH_INTERVAL_MS;
  private retryAfter = 0;

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
    if (this.ticking || Date.now() < this.retryAfter) return;
    this.ticking = true;
    try {
      const live = await this.prisma.activityRun.findMany({
        where: { state: "live" },
        select: { sessionId: true },
        distinct: ["sessionId"],
      });
      for (const { sessionId } of live) await this.flush(sessionId, false);
      this.retryDelayMs = FLUSH_INTERVAL_MS;
      this.retryAfter = 0;
    } catch (err) {
      this.logger.error(`Answer flush failed; retrying in ${this.retryDelayMs}ms: ${String(err)}`, err instanceof Error ? err.stack : undefined);
      this.retryAfter = Date.now() + this.retryDelayMs;
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000);
    } finally {
      this.ticking = false;
    }
  }

  /** The last write when a poll closes. It waits for a flush that is already running. */
  async finalFlush(sessionId: string): Promise<void> {
    let delayMs = FLUSH_INTERVAL_MS;
    for (;;) {
      try {
        await this.flush(sessionId, true);
        return;
      } catch (err) {
        this.logger.error(`Final answer flush failed for session ${sessionId}; retrying in ${delayMs}ms: ${String(err)}`, err instanceof Error ? err.stack : undefined);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 30_000);
      }
    }
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
      const stream = flushStreamKey(sessionId);
      for (;;) {
        const entries = await this.redis.xrange(stream, "-", "+", "COUNT", BATCH_SIZE);
        if (entries.length === 0) return;
        await this.write(entries.map(([, fields]) => parseEntry(fields)));
        await this.redis.xdel(stream, ...entries.map(([id]) => id));
      }
    } finally {
      await this.redis.releaseFlushLock(key, token);
    }
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
