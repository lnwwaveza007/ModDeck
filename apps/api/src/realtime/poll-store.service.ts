import { Inject, Injectable } from "@nestjs/common";
import type { ActivityRunDto, PollTally, SlideActivityView } from "@moddeck/shared";
import Redis, { type Result } from "ioredis";
import type { ActivityRun } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { liveActivitySelect, toLiveActivity } from "../slides/slide.mapper";
import { WordStoreService } from "./word-store.service";

// Live session keys expire a day after the last answer, as the event log does.
const LIVE_KEY_TTL_SECONDS = 24 * 60 * 60;

// All keys of one session share the hash tag {sid} (technical design §5.2).
const runKey = (sid: string, runId: string) => `run:{${sid}}:${runId}`;
const answersKey = (sid: string, runId: string) => `ans:{${sid}}:${runId}`;
const votesKey = (sid: string, runId: string) => `votes:{${sid}}:${runId}`;
const answerIdsKey = (sid: string) => `aid:{${sid}}`;
export const flushStreamKey = (sid: string) => `flush:{${sid}}`;

// The MD-9 submit: check and count in one atomic step, so two votes can never both pass the check.
// The run state lives here too: once a close has written it, no vote can still get in.
// KEYS: run, answers, votes, flush stream, answer ids.
// ARGV: participantId, optionId, answer id field, runId, now ms, TTL seconds.
const SUBMIT_SCRIPT = `
local seen = redis.call('HGET', KEYS[5], ARGV[3])
if seen then return { 'duplicate', seen } end
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return { 'not_loaded' } end
if state ~= 'live' then return { 'closed' } end
if redis.call('HEXISTS', KEYS[3], ARGV[2]) == 0 then return { 'bad_option' } end
local old = redis.call('HGET', KEYS[2], ARGV[1])
local reopened = redis.call('HGET', KEYS[1], 'reopened')
if old then
  if old == ARGV[2] or (redis.call('HGET', KEYS[1], 'change') ~= '1' and reopened ~= '1') then
    redis.call('HSET', KEYS[5], ARGV[3], old)
    redis.call('EXPIRE', KEYS[5], ARGV[6])
    return { 'duplicate', old }
  end
  redis.call('HINCRBY', KEYS[3], old, -1)
end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HINCRBY', KEYS[3], ARGV[2], 1)
redis.call('XADD', KEYS[4], '*', 'r', ARGV[4], 'p', ARGV[1], 'o', ARGV[2], 't', ARGV[5],
  'c', old and '1' or '0', 'a', reopened)
redis.call('HSET', KEYS[5], ARGV[3], ARGV[2])
for i = 1, 5 do redis.call('EXPIRE', KEYS[i], ARGV[6]) end
return { 'accepted', ARGV[2] }
`;

// KEYS: run. ARGV: state, change, reopened. Returns 0 when Redis does not hold the run.
const SET_STATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'change', ARGV[2], 'reopened', ARGV[3])
return 1
`;

// Rebuilds a run from PostgreSQL (MD-9 §7.6). It does nothing if the run is already there, so two
// instances can load it at the same time. The options are the fields of the votes hash.
// KEYS: run, answers, votes.
// ARGV: state, change, reopened, TTL, option count, options..., then participant, option pairs.
const LOAD_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('DEL', KEYS[2], KEYS[3])
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'change', ARGV[2], 'reopened', ARGV[3])
local count = tonumber(ARGV[5])
for i = 1, count do redis.call('HINCRBY', KEYS[3], ARGV[5 + i], 0) end
for i = 6 + count, #ARGV, 2 do
  redis.call('HSET', KEYS[2], ARGV[i], ARGV[i + 1])
  redis.call('HINCRBY', KEYS[3], ARGV[i + 1], 1)
end
for i = 1, 3 do redis.call('EXPIRE', KEYS[i], ARGV[4]) end
return 1
`;

declare module "ioredis" {
  interface RedisCommander<Context> {
    submitVote(
      run: string,
      answers: string,
      votes: string,
      stream: string,
      answerIds: string,
      participantId: string,
      optionId: string,
      answerIdField: string,
      runId: string,
      nowMs: number,
      ttlSeconds: number,
    ): Result<[string, string?], Context>;
    setRunState(
      run: string,
      state: string,
      change: string,
      reopened: string,
    ): Result<number, Context>;
    loadRun(
      run: string,
      answers: string,
      votes: string,
      ...args: (string | number)[]
    ): Result<number, Context>;
  }
}

export type VoteOutcome =
  | { status: "accepted" | "duplicate"; optionId: string }
  | { status: "closed" | "bad_option" | "not_found" };

type RunRow = Pick<ActivityRun, "id" | "activityId" | "state" | "endsAt" | "lastReopenedAt">;

export const runRowSelect = {
  id: true,
  activityId: true,
  state: true,
  endsAt: true,
  lastReopenedAt: true,
} as const;

export const toRunDto = (run: RunRow): ActivityRunDto => ({
  activityId: run.activityId,
  activityRunId: run.id,
  state: run.state,
  endsAt: run.endsAt ? run.endsAt.getTime() : null,
  reopened: run.lastReopenedAt !== null,
});

/**
 * Live answers of polls. Redis counts them first (MD-9): 300 votes in one second never wait for
 * PostgreSQL. PollFlusherService then writes them to PostgreSQL in batches.
 */
@Injectable()
export class PollStoreService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly words: WordStoreService,
  ) {
    this.redis.defineCommand("submitVote", { numberOfKeys: 5, lua: SUBMIT_SCRIPT });
    this.redis.defineCommand("setRunState", { numberOfKeys: 1, lua: SET_STATE_SCRIPT });
    this.redis.defineCommand("loadRun", { numberOfKeys: 3, lua: LOAD_SCRIPT });
  }

  /** One answer per participant, and one count per answerId however often it is sent. */
  async submit(
    sessionId: string,
    participantId: string,
    runId: string,
    optionId: string,
    answerId: string,
  ): Promise<VoteOutcome> {
    const send = () =>
      this.redis.submitVote(
        runKey(sessionId, runId),
        answersKey(sessionId, runId),
        votesKey(sessionId, runId),
        flushStreamKey(sessionId),
        answerIdsKey(sessionId),
        participantId,
        optionId,
        // With the participant in the field, one student cannot use up the id of another.
        `${participantId}:${answerId}`,
        runId,
        Date.now(),
        LIVE_KEY_TTL_SECONDS,
      );

    let [status, stored] = await send();
    if (status === "not_loaded") {
      if (!(await this.syncRun(sessionId, runId))) return { status: "not_found" };
      [status, stored] = await send();
    }
    if (status === "accepted" || status === "duplicate") return { status, optionId: stored! };
    return { status: status === "bad_option" ? "bad_option" : "closed" };
  }

  /**
   * Writes the state of a run to Redis. Call it after every state change, before telling the room.
   * Returns false when the run is not a poll of this session.
   */
  async syncRun(sessionId: string, runId: string): Promise<boolean> {
    const run = await this.prisma.activityRun.findFirst({
      where: { id: runId, sessionId, activity: { type: "poll" } },
      select: {
        state: true,
        lastReopenedAt: true,
        activity: {
          select: {
            allowAnswerChange: true,
            options: { select: { id: true } },
          },
        },
      },
    });
    if (!run) return false;

    const flags = [
      run.state,
      run.activity.allowAnswerChange ? "1" : "0",
      run.lastReopenedAt ? "1" : "0",
    ] as const;
    if (await this.redis.setRunState(runKey(sessionId, runId), ...flags)) return true;

    const answers = await this.prisma.answer.findMany({
      where: { activityRunId: runId },
      select: { participantId: true, optionId: true },
    });
    await this.redis.loadRun(
      runKey(sessionId, runId),
      answersKey(sessionId, runId),
      votesKey(sessionId, runId),
      ...flags,
      LIVE_KEY_TTL_SECONDS,
      run.activity.options.length,
      ...run.activity.options.map((option) => option.id),
      ...answers.flatMap((answer) => [answer.participantId, answer.optionId]),
    );
    return true;
  }

  async tally(sessionId: string, runId: string): Promise<PollTally> {
    const [[, rawVotes], [, answered]] = (await this.redis
      .multi()
      .hgetall(votesKey(sessionId, runId))
      .hlen(answersKey(sessionId, runId))
      .exec()) as [[null, Record<string, string>], [null, number]];
    if (Object.keys(rawVotes).length > 0) {
      const votes = Object.fromEntries(
        Object.entries(rawVotes).map(([option, count]) => [option, Number(count)]),
      );
      return { votes, answered };
    }
    return this.storedTally(runId);
  }

  /** Counts from PostgreSQL, for a run that Redis no longer holds (an ended session). */
  private async storedTally(runId: string): Promise<PollTally> {
    const rows = await this.prisma.answer.groupBy({
      by: ["optionId"],
      where: { activityRunId: runId },
      _count: { _all: true },
    });
    const votes = Object.fromEntries(rows.map((row) => [row.optionId, row._count._all]));
    return { votes, answered: rows.reduce((sum, row) => sum + row._count._all, 0) };
  }

  async answerOf(sessionId: string, runId: string, participantId: string): Promise<string | null> {
    const live = await this.redis.hget(answersKey(sessionId, runId), participantId);
    if (live) return live;
    const stored = await this.prisma.answer.findFirst({
      where: { activityRunId: runId, participantId },
      select: { optionId: true },
    });
    return stored?.optionId ?? null;
  }

  /** The activity on a slide, as the phones get it. null on a content slide. */
  async slideActivity(sessionId: string, slideId: string): Promise<SlideActivityView | null> {
    const found = await this.prisma.activity.findUnique({
      where: { slideId },
      select: liveActivitySelect,
    });
    if (!found) return null;
    const activity = toLiveActivity(found);
    const row = await this.prisma.activityRun.findUnique({
      where: { sessionId_activityId: { sessionId, activityId: activity.id } },
      select: runRowSelect,
    });
    // A phone gets the counts only once the host shows results (MD-5 §7.1).
    const shown = row?.state === "results_shown" ? row : null;
    const results =
      shown && activity.type === "poll" ? await this.tally(sessionId, shown.id) : null;
    const cloud =
      shown && activity.type === "word_cloud" ? await this.words.tally(sessionId, shown.id) : null;
    return { activity, run: row ? toRunDto(row) : null, results, cloud };
  }
}
