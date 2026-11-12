import { Inject, Injectable } from "@nestjs/common";
import {
  WORD_CLOUD_TOP_N,
  normalizeWordText,
  sortWords,
  wordKey,
  wordProblem,
  type WordCloudTally,
  type WordCount,
  type WordProblem,
} from "@moddeck/shared";
import Redis, { type Result } from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";

// Live session keys expire a day after the last entry, as the event log does.
const LIVE_KEY_TTL_SECONDS = 24 * 60 * 60;

// All keys of one session share the hash tag {sid} (technical design §5.2).
const runKey = (sid: string, runId: string) => `wrun:{${sid}}:${runId}`; // state, limit
const countsKey = (sid: string, runId: string) => `wc:{${sid}}:${runId}`; // word key -> entries
const textsKey = (sid: string, runId: string) => `wt:{${sid}}:${runId}`; // word key -> shown text
const hiddenKey = (sid: string, runId: string) => `wh:{${sid}}:${runId}`; // set of hidden word keys
const mineCountKey = (sid: string, runId: string) => `wm:{${sid}}:${runId}`; // participant -> sent
const mineWordsKey = (sid: string, runId: string) => `wp:{${sid}}:${runId}`; // participant:key -> text
// The same ledger of answer ids the poll uses: a retried send is found here (MD-13).
const answerIdsKey = (sid: string) => `aid:{${sid}}`;
export const wordFlushStreamKey = (sid: string) => `wflush:{${sid}}`;

// The submit step: check and count in one atomic step, so two entries of one student can never
// both pass the limit, and a close that has written the state lets no entry in after it.
// A student may send a word once: the same word again changes nothing, so a cloud grows with the
// number of people who sent it, not with how often one person did.
// KEYS: run, counts, texts, hidden, mine count, mine words, flush stream, answer ids.
// ARGV: participantId, word key, text, answer id field, entry id, run id, now ms, TTL seconds.
const SUBMIT_SCRIPT = `
local seen = redis.call('HGET', KEYS[8], ARGV[4])
if seen then return { 'duplicate', seen, redis.call('HGET', KEYS[5], ARGV[1]) or '0' } end
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return { 'not_loaded' } end
if state ~= 'live' then return { 'closed' } end
local sent = tonumber(redis.call('HGET', KEYS[5], ARGV[1]) or '0')
local same = redis.call('HGET', KEYS[6], ARGV[1] .. ':' .. ARGV[2])
if same then
  redis.call('HSET', KEYS[8], ARGV[4], same)
  redis.call('EXPIRE', KEYS[8], ARGV[8])
  return { 'duplicate', same, tostring(sent) }
end
if sent >= tonumber(redis.call('HGET', KEYS[1], 'limit')) then return { 'limit' } end
local hidden = redis.call('SISMEMBER', KEYS[4], ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[2], 1)
redis.call('HSETNX', KEYS[3], ARGV[2], ARGV[3])
redis.call('HINCRBY', KEYS[5], ARGV[1], 1)
redis.call('HSET', KEYS[6], ARGV[1] .. ':' .. ARGV[2], ARGV[3])
redis.call('XADD', KEYS[7], '*', 'i', ARGV[5], 'r', ARGV[6], 'p', ARGV[1], 't', ARGV[3],
  'k', ARGV[2], 'h', tostring(hidden), 'c', ARGV[7])
redis.call('HSET', KEYS[8], ARGV[4], ARGV[3])
for i = 1, 8 do redis.call('EXPIRE', KEYS[i], ARGV[8]) end
return { 'accepted', ARGV[3], tostring(sent + 1) }
`;

// KEYS: run. ARGV: state, limit. Returns 0 when Redis does not hold the run.
const SET_STATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'limit', ARGV[2])
return 1
`;

// Rebuilds a run from PostgreSQL (MD-9 §7.6). It does nothing if the run is already there, so two
// instances can load it at the same time.
// KEYS: run, counts, texts, hidden, mine count, mine words.
// ARGV: state, limit, TTL, then entries as participant, word key, text, hidden (1 or 0).
const LOAD_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6])
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'limit', ARGV[2])
for i = 4, #ARGV, 4 do
  redis.call('HINCRBY', KEYS[2], ARGV[i + 1], 1)
  redis.call('HSETNX', KEYS[3], ARGV[i + 1], ARGV[i + 2])
  if ARGV[i + 3] == '1' then redis.call('SADD', KEYS[4], ARGV[i + 1]) end
  redis.call('HINCRBY', KEYS[5], ARGV[i], 1)
  redis.call('HSET', KEYS[6], ARGV[i] .. ':' .. ARGV[i + 1], ARGV[i + 2])
end
for i = 1, 6 do redis.call('EXPIRE', KEYS[i], ARGV[3]) end
return 1
`;

declare module "ioredis" {
  interface RedisCommander<Context> {
    submitWord(
      run: string,
      counts: string,
      texts: string,
      hidden: string,
      mineCount: string,
      mineWords: string,
      stream: string,
      answerIds: string,
      participantId: string,
      key: string,
      text: string,
      answerIdField: string,
      entryId: string,
      runId: string,
      nowMs: number,
      ttlSeconds: number,
    ): Result<[string, string?, string?], Context>;
    setWordRunState(run: string, state: string, limit: number): Result<number, Context>;
    loadWordRun(
      run: string,
      counts: string,
      texts: string,
      hidden: string,
      mineCount: string,
      mineWords: string,
      ...args: (string | number)[]
    ): Result<number, Context>;
  }
}

export type WordOutcome =
  | { status: "accepted" | "duplicate"; text: string; sent: number }
  | { status: "invalid"; problem: WordProblem }
  | { status: "closed" | "limit" | "not_found" };

interface WordRow extends WordCount {
  hidden: boolean;
}

/** The cloud a screen draws: visible words only, most sent first, the top of them. */
function toTally(rows: WordRow[]): WordCloudTally {
  const visible = sortWords(rows.filter((row) => !row.hidden)).slice(0, WORD_CLOUD_TOP_N);
  return {
    words: visible.map(({ key, text, count }) => ({ key, text, count })),
    entries: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

/**
 * Live entries of word clouds. Redis counts them first (MD-9): 300 students sending words in one
 * second never wait for PostgreSQL. PollFlusherService then writes them to PostgreSQL in batches.
 */
@Injectable()
export class WordStoreService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {
    this.redis.defineCommand("submitWord", { numberOfKeys: 8, lua: SUBMIT_SCRIPT });
    this.redis.defineCommand("setWordRunState", { numberOfKeys: 1, lua: SET_STATE_SCRIPT });
    this.redis.defineCommand("loadWordRun", { numberOfKeys: 6, lua: LOAD_SCRIPT });
  }

  /**
   * One entry of one student. The limit per student is checked here, on the server, whatever the
   * phone shows. `raw` is what the student typed: it is normalized and checked first.
   */
  async submit(
    sessionId: string,
    participantId: string,
    runId: string,
    raw: string,
    answerId: string,
  ): Promise<WordOutcome> {
    const problem = wordProblem(raw);
    if (problem) return { status: "invalid", problem };
    const text = normalizeWordText(raw);
    const key = wordKey(text);

    const send = () =>
      this.redis.submitWord(
        runKey(sessionId, runId),
        countsKey(sessionId, runId),
        textsKey(sessionId, runId),
        hiddenKey(sessionId, runId),
        mineCountKey(sessionId, runId),
        mineWordsKey(sessionId, runId),
        wordFlushStreamKey(sessionId),
        answerIdsKey(sessionId),
        participantId,
        key,
        text,
        // With the participant in the field, one student cannot use up the id of another.
        `${participantId}:${answerId}`,
        answerId,
        runId,
        Date.now(),
        LIVE_KEY_TTL_SECONDS,
      );

    let [status, stored, sent] = await send();
    if (status === "not_loaded") {
      if (!(await this.syncRun(sessionId, runId))) return { status: "not_found" };
      [status, stored, sent] = await send();
    }
    if (status === "accepted" || status === "duplicate") {
      return { status, text: stored!, sent: Number(sent) };
    }
    return { status: status === "limit" ? "limit" : "closed" };
  }

  /**
   * Writes the state of a run to Redis. Call it after every state change, before telling the room.
   * Returns false when the run is not a word cloud of this session.
   */
  async syncRun(sessionId: string, runId: string): Promise<boolean> {
    const run = await this.prisma.activityRun.findFirst({
      where: { id: runId, sessionId, activity: { type: "word_cloud" } },
      select: { state: true, activity: { select: { maxEntriesPerPerson: true } } },
    });
    if (!run) return false;

    const limit = run.activity.maxEntriesPerPerson;
    if (await this.redis.setWordRunState(runKey(sessionId, runId), run.state, limit)) return true;

    const entries = await this.prisma.wordEntry.findMany({
      where: { activityRunId: runId },
      select: { participantId: true, normalizedText: true, text: true, hidden: true },
      orderBy: { createdAt: "asc" },
    });
    await this.redis.loadWordRun(
      runKey(sessionId, runId),
      countsKey(sessionId, runId),
      textsKey(sessionId, runId),
      hiddenKey(sessionId, runId),
      mineCountKey(sessionId, runId),
      mineWordsKey(sessionId, runId),
      run.state,
      limit,
      LIVE_KEY_TTL_SECONDS,
      ...entries.flatMap((entry) => [
        entry.participantId,
        entry.normalizedText,
        entry.text,
        entry.hidden ? "1" : "0",
      ]),
    );
    return true;
  }

  /** The cloud of a run: what the room sees. Hidden words are not in it. */
  async tally(sessionId: string, runId: string): Promise<WordCloudTally> {
    return toTally(await this.rows(sessionId, runId));
  }

  /** Words the host hid in this run, most sent first. */
  async hiddenWords(sessionId: string, runId: string): Promise<WordCount[]> {
    const rows = await this.rows(sessionId, runId);
    return sortWords(rows.filter((row) => row.hidden)).map(({ key, text, count }) => ({
      key,
      text,
      count,
    }));
  }

  /**
   * Hides or shows one word in Redis, where the room reads it. The new entries of that word follow
   * it at once. Returns false when nobody sent the word. PostgreSQL follows with persistHidden(),
   * after the flush: see LiveService.
   */
  async setHidden(
    sessionId: string,
    runId: string,
    key: string,
    hidden: boolean,
  ): Promise<boolean> {
    if (!(await this.syncRun(sessionId, runId))) return false;
    if (!(await this.redis.hexists(countsKey(sessionId, runId), key))) return false;
    const set = hiddenKey(sessionId, runId);
    if (hidden) await this.redis.sadd(set, key);
    else await this.redis.srem(set, key);
    await this.redis.expire(set, LIVE_KEY_TTL_SECONDS);
    return true;
  }

  /** Marks the stored entries of a word, so a run that is loaded again keeps it hidden. */
  async persistHidden(runId: string, key: string, hidden: boolean): Promise<void> {
    await this.prisma.wordEntry.updateMany({
      where: { activityRunId: runId, normalizedText: key },
      data: { hidden },
    });
  }

  /** The words this student has sent to the run, as shown. */
  async wordsOf(sessionId: string, runId: string, participantId: string): Promise<string[]> {
    if (await this.redis.exists(runKey(sessionId, runId))) {
      const prefix = `${participantId}:`;
      const all = await this.redis.hgetall(mineWordsKey(sessionId, runId));
      return Object.entries(all)
        .filter(([field]) => field.startsWith(prefix))
        .map(([, text]) => text);
    }
    const rows = await this.prisma.wordEntry.findMany({
      where: { activityRunId: runId, participantId },
      select: { text: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => row.text);
  }

  /** Every word of a run with its count, from Redis while it holds the run, else PostgreSQL. */
  private async rows(sessionId: string, runId: string): Promise<WordRow[]> {
    const [[, counts], [, texts], [, hidden]] = (await this.redis
      .multi()
      .hgetall(countsKey(sessionId, runId))
      .hgetall(textsKey(sessionId, runId))
      .smembers(hiddenKey(sessionId, runId))
      .exec()) as [
      [null, Record<string, string>],
      [null, Record<string, string>],
      [null, string[]],
    ];
    if (Object.keys(counts).length > 0) {
      const hiddenKeys = new Set(hidden);
      return Object.entries(counts).map(([key, count]) => ({
        key,
        text: texts[key] ?? key,
        count: Number(count),
        hidden: hiddenKeys.has(key),
      }));
    }
    return this.storedRows(runId);
  }

  /** Counts from PostgreSQL, for a run that Redis no longer holds (an ended session). */
  private async storedRows(runId: string): Promise<WordRow[]> {
    const entries = await this.prisma.wordEntry.findMany({
      where: { activityRunId: runId },
      select: { normalizedText: true, text: true, hidden: true },
      orderBy: { createdAt: "asc" },
    });
    const byKey = new Map<string, WordRow>();
    for (const entry of entries) {
      const row = byKey.get(entry.normalizedText);
      if (row) row.count += 1;
      else {
        byKey.set(entry.normalizedText, {
          key: entry.normalizedText,
          text: entry.text,
          count: 1,
          hidden: entry.hidden,
        });
      }
    }
    return [...byKey.values()];
  }
}
