import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { RoomEventsService } from "../realtime/room-events.service";
import { hashToken } from "../realtime/participant-token";
import { VOTE_BATCH_MS, type LiveQuestion, type RoomEventData } from "@moddeck/shared";

const QUESTION_RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;
const QUESTION_VOTE_SCRIPT = `
local voted = redis.call('SISMEMBER', KEYS[1], ARGV[1])
if voted == 1 then
  redis.call('SREM', KEYS[1], ARGV[1])
else
  redis.call('SADD', KEYS[1], ARGV[1])
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[2])
return { 1 - voted, redis.call('SCARD', KEYS[1]) }
`;

const questionView = (q: {
  id: string;
  text: string;
  anonymous: boolean;
  status: string;
  createdAt: Date;
  _count: { votes: number };
  votes?: { participantId: string }[];
  participant: { nickname: string };
}): LiveQuestion => ({
  id: q.id,
  text: q.text,
  anonymous: q.anonymous,
  status: q.status,
  createdAt: q.createdAt.toISOString(),
  votes: q._count.votes,
  ...(!q.anonymous ? { author: q.participant.nickname } : {}),
  ...(q.votes ? { voted: q.votes.length > 0 } : {}),
});

@Injectable()
export class QuestionsService {
  private readonly pending = new Map<
    string,
    Map<string, RoomEventData["question_update"]["updates"][number]>
  >();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RoomEventsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async identity(token: string | undefined, sessionId: string) {
    if (!token) throw new ApiException(401, "UNAUTHORIZED", "Join the session first");
    const p = await this.prisma.participant.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, sessionId: true, status: true, tokenExpiresAt: true },
    });
    if (!p || p.sessionId !== sessionId || p.status !== "active" || p.tokenExpiresAt <= new Date())
      throw new ApiException(401, "UNAUTHORIZED", "Invalid participant session");
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        settings: true,
        deck: { select: { qaEnabled: true, anonymousAllowed: true } },
      },
    });
    if (!session || session.status === "ended")
      throw new ApiException(410, "SESSION_ENDED", "Session ended");
    if (!session.deck.qaEnabled) throw new ApiException(403, "ROOM_FORBIDDEN", "Q&A is disabled");
    return { participantId: p.id, session, anonymousAllowed: session.deck.anonymousAllowed };
  }

  async list(sessionId: string, token?: string, sort: "top" | "newest" = "top") {
    const { participantId } = await this.identity(token, sessionId);
    const rows = await this.prisma.question.findMany({
      where: { sessionId, status: { notIn: ["hidden", "deleted"] } },
      include: {
        _count: { select: { votes: true } },
        participant: { select: { nickname: true } },
        votes: { where: { participantId }, select: { participantId: true } },
      },
      orderBy:
        sort === "newest"
          ? { createdAt: "desc" }
          : [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
    });
    return { questions: rows.map(questionView) };
  }

  async ask(sessionId: string, token: string | undefined, text: string, anonymous: boolean) {
    const { participantId, anonymousAllowed } = await this.identity(token, sessionId);
    const value = text.trim();
    if (!value || value.length > 280)
      throw new ApiException(422, "INVALID_PAYLOAD", "Question must be 1–280 characters");
    if (anonymous && !anonymousAllowed)
      throw new ApiException(403, "ROOM_FORBIDDEN", "Anonymous questions are disabled");
    const key = `qa-rate:{${sessionId}}:${participantId}`;
    // Keep INCR and expiry atomic, so a process crash cannot leave a permanent limiter key.
    const count = Number(await this.redis.eval(QUESTION_RATE_SCRIPT, 1, key, 20));
    if (count > 1)
      throw new ApiException(
        429,
        "TOO_MANY_ATTEMPTS",
        "Please wait before asking another question",
      );
    const q = await this.prisma.question.create({
      data: { sessionId, participantId, text: value, anonymous },
      include: { _count: { select: { votes: true } }, participant: { select: { nickname: true } } },
    });
    const result = questionView(q);
    this.enqueue(sessionId, `created:${result.id}`, { action: "created", question: result });
    return result;
  }

  async toggleVote(sessionId: string, questionId: string, token?: string) {
    const { participantId } = await this.identity(token, sessionId);
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, sessionId, status: { notIn: ["hidden", "deleted"] } },
      select: { id: true },
    });
    if (!question) throw new ApiException(404, "NOT_FOUND", "Question not found");
    const voteKey = `qa-votes:{${questionId}}`;
    const readyKey = `qa-votes-ready:{${questionId}}`;
    let outcome: { voted: boolean; votes: number };
    let transactionCommitted = false;
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        // Serialize all votes for this question across API instances. Redis is the live set;
        // QuestionVote is the durable mirror and can restore the set after Redis expires/restarts.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa:${questionId}`}))`;
        if (!(await this.redis.exists(readyKey))) {
          const existing = await tx.questionVote.findMany({
            where: { questionId },
            select: { participantId: true },
          });
          await this.redis.del(voteKey);
          if (existing.length) {
            await this.redis.sadd(voteKey, ...existing.map((vote) => vote.participantId));
          }
          await this.redis.set(readyKey, "1", "EX", 30 * 24 * 60 * 60);
        }
        const [voted, votes] = (await this.redis.eval(
          QUESTION_VOTE_SCRIPT,
          2,
          voteKey,
          readyKey,
          participantId,
          30 * 24 * 60 * 60,
        )) as [number, number];
        const key = { questionId_participantId: { questionId, participantId } };
        if (voted) await tx.questionVote.create({ data: { questionId, participantId } });
        else await tx.questionVote.delete({ where: key });
        return { voted: Boolean(voted), votes: Number(votes) };
      });
      transactionCommitted = true;
    } finally {
      if (!transactionCommitted) {
        // A rolled-back DB transaction invalidates the Redis mirror so the next request rebuilds it.
        await this.redis.del(voteKey, readyKey).catch(() => undefined);
      }
    }
    this.enqueue(sessionId, `votes:${questionId}`, {
      action: "votes",
      questionId,
      votes: outcome.votes,
    });
    return outcome;
  }

  private enqueue(
    sessionId: string,
    key: string,
    update: RoomEventData["question_update"]["updates"][number],
  ) {
    let updates = this.pending.get(sessionId);
    if (!updates) this.pending.set(sessionId, (updates = new Map()));
    updates.set(key, update);
    if (this.timers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      const batch = this.pending.get(sessionId);
      this.pending.delete(sessionId);
      if (batch?.size) {
        this.events.publish(sessionId, "question_update", {
          updates: [...batch.values()],
        }).catch(() => {
          // Polling provides recovery if a live broadcast is temporarily unavailable.
        });
      }
    }, VOTE_BATCH_MS);
    timer.unref();
    this.timers.set(sessionId, timer);
  }
}
