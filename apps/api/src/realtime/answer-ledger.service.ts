import { Inject, Injectable } from "@nestjs/common";
import Redis, { type Result } from "ioredis";
import { REDIS } from "../redis/redis.module";

// Live session keys expire a day after the last answer, as the event log does.
const LEDGER_TTL_SECONDS = 24 * 60 * 60;

// An attempt that started but never finished (the api crashed in the middle)
// can be taken over by a retry after this long.
const STALE_ATTEMPT_MS = 10_000;

// A retry that meets an attempt still running waits this long for its result.
const WAIT_FOR_RESULT_MS = 2_000;
const POLL_MS = 25;

// All keys of one session share the hash tag {sid} (technical design §5.2).
const ledgerKey = (sessionId: string) => `aid:{${sessionId}}`;

// KEYS: aid hash. ARGV: answerId, now ms, stale ms, TTL seconds.
// Returns { 1 } if the caller now owns the attempt, { 2 } if another attempt is
// still running, { 0, storedResult } if the answer was already counted.
const CLAIM_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if not current then
  redis.call('HSET', KEYS[1], ARGV[1], 'pending:' .. ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[4])
  return { 1 }
end
if string.sub(current, 1, 8) == 'pending:' then
  local started = tonumber(string.sub(current, 9))
  if tonumber(ARGV[2]) - started > tonumber(ARGV[3]) then
    redis.call('HSET', KEYS[1], ARGV[1], 'pending:' .. ARGV[2])
    return { 1 }
  end
  return { 2 }
end
return { 0, current }
`;

declare module "ioredis" {
  interface RedisCommander<Context> {
    claimAnswerId(
      key: string,
      answerId: string,
      nowMs: number,
      staleMs: number,
      ttlSeconds: number,
    ): Result<[number, string?], Context>;
  }
}

export interface LedgerOutcome<R> {
  /** true: this answerId was already counted, `apply` did not run again. */
  duplicate: boolean;
  result: R | undefined;
}

// Makes answers idempotent (MD-13): the client makes one answerId per answer and
// re-sends the same id when an ack is lost. The ledger runs `apply` once per
// answerId and returns the stored result to every retry. It lives in Redis
// (AOF), so a retry after an api restart is still a duplicate. Instances share
// it, so a retry that lands on another instance is a duplicate too.
@Injectable()
export class AnswerLedgerService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.redis.defineCommand("claimAnswerId", { numberOfKeys: 1, lua: CLAIM_SCRIPT });
  }

  async once<R>(
    sessionId: string,
    answerId: string,
    apply: () => Promise<R>,
  ): Promise<LedgerOutcome<R>> {
    const key = ledgerKey(sessionId);
    const deadline = Date.now() + WAIT_FOR_RESULT_MS;

    for (;;) {
      const [state, stored] = await this.redis.claimAnswerId(
        key,
        answerId,
        Date.now(),
        STALE_ATTEMPT_MS,
        LEDGER_TTL_SECONDS,
      );

      if (state === 0) return { duplicate: true, result: JSON.parse(stored!) as R };

      if (state === 1) {
        let result: R;
        try {
          result = await apply();
        } catch (err) {
          // The answer did not count, so a retry must be allowed to try again.
          await this.redis.hdel(key, answerId);
          throw err;
        }
        await this.redis.hset(key, answerId, JSON.stringify(result ?? null));
        return { duplicate: false, result };
      }

      // Another attempt with this id is running. Wait for it, never run twice.
      if (Date.now() >= deadline) return { duplicate: true, result: undefined };
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}
