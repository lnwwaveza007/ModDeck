import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { RoomEventsService } from "../realtime/room-events.service";
import { hashToken } from "../realtime/participant-token";
import {
  QUESTION_ACTION_STATUS,
  VOTE_BATCH_MS,
  qaOpen,
  qaShown,
  type LiveQuestion,
  type QuestionAction,
  type RoomEventData,
} from "@moddeck/shared";
import { z } from "zod";
import { questionSelect, questionView, statusUpdate } from "./question-view";

const uuid = z.uuid();
const questionNotFound = () => new ApiException(404, "NOT_FOUND", "Question not found");

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

  /**
   * The participant behind the cookie. `write`: asking and voting, which need Q&A open. Reading
   * needs only the tab, which stays after the host closes Q&A.
   */
  private async identity(token: string | undefined, sessionId: string, write = false) {
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
        deck: { select: { anonymousAllowed: true } },
      },
    });
    if (!session || session.status === "ended")
      throw new ApiException(410, "SESSION_ENDED", "Session ended");
    if (!qaShown(session.settings))
      throw new ApiException(403, "ROOM_FORBIDDEN", "Q&A is disabled");
    if (write && !qaOpen(session.settings))
      throw new ApiException(403, "QA_CLOSED", "The host has closed Q&A");
    return { participantId: p.id, session, anonymousAllowed: session.deck.anonymousAllowed };
  }

  async list(sessionId: string, token?: string, sort: "top" | "newest" = "top") {
    const { participantId } = await this.identity(token, sessionId);
    const rows = await this.prisma.question.findMany({
      where: { sessionId, status: { notIn: ["hidden", "deleted"] } },
      select: {
        ...questionSelect,
        participantId: true,
        votes: { where: { participantId }, select: { participantId: true } },
      },
      orderBy:
        sort === "newest"
          ? { createdAt: "desc" }
          : [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
    });
    return {
      questions: rows.map((row) => ({
        ...questionView(row),
        ownQuestion: row.participantId === participantId,
      })),
    };
  }

  async ask(sessionId: string, token: string | undefined, text: string, anonymous: boolean) {
    const { participantId, anonymousAllowed } = await this.identity(token, sessionId, true);
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
      select: questionSelect,
    });
    const result = questionView(q);
    this.enqueue(sessionId, `created:${result.id}`, { action: "created", question: result });
    return { ...result, ownQuestion: true };
  }

  async toggleVote(sessionId: string, questionId: string, token?: string) {
    const { participantId } = await this.identity(token, sessionId, true);
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, sessionId, status: { notIn: ["hidden", "deleted"] } },
      select: { id: true, participantId: true },
    });
    if (!question) throw new ApiException(404, "NOT_FOUND", "Question not found");
    if (question.participantId === participantId)
      throw new ApiException(403, "ROOM_FORBIDDEN", "You cannot upvote your own question");
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

  /**
   * The host marks a question answered, hides it, pins it to the projector, or puts it back
   * (MD-5 F6). One pin per session: pinning moves the old pin back to visible. Answering or hiding
   * the pinned question takes it off the projector, as each question has one status.
   *
   * Every change of a session runs under one lock and goes to the room before the lock is freed,
   * so the room hears the changes in the order the database made them: two host windows pinning
   * at once cannot leave two pins on the screens.
   */
  async setStatus(
    ownerId: string,
    sessionId: string,
    questionId: string,
    action: QuestionAction,
  ): Promise<LiveQuestion> {
    if (!uuid.safeParse(sessionId).success)
      throw new ApiException(404, "NOT_FOUND", "Session not found");
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId },
      select: { status: true },
    });
    if (!session) throw new ApiException(404, "NOT_FOUND", "Session not found");
    if (session.status === "ended")
      throw new ApiException(409, "SESSION_ENDED", "The session has ended");
    if (!uuid.safeParse(questionId).success) throw questionNotFound();
    const status = QUESTION_ACTION_STATUS[action];

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa-status:${sessionId}`}))`;
      const question = await tx.question.findFirst({
        where: { id: questionId, sessionId, status: { not: "deleted" } },
        select: { id: true, status: true },
      });
      if (!question) throw questionNotFound();

      const changed: string[] = [];
      if (status === "highlighted") {
        const pinned = await tx.question.findMany({
          where: { sessionId, status: "highlighted", id: { not: questionId } },
          select: { id: true },
        });
        if (pinned.length) {
          await tx.question.updateMany({
            where: { id: { in: pinned.map((q) => q.id) } },
            data: { status: "visible" },
          });
          changed.push(...pinned.map((q) => q.id));
        }
      }
      if (question.status !== status) {
        await tx.question.update({
          where: { id: questionId },
          data: { status },
          select: { id: true },
        });
        changed.push(questionId);
      }

      const rows = await tx.question.findMany({
        where: { id: { in: [...changed, questionId] } },
        select: questionSelect,
      });
      const views = new Map(rows.map((row) => [row.id, questionView(row)]));
      // In the order of the writes: the old pin goes back before the new one shows.
      const updates = changed.map((id) => statusUpdate(views.get(id)!));
      // A press that changes nothing (a second click on "answered") sends nothing.
      if (updates.length) await this.events.publish(sessionId, "question_update", { updates });
      return views.get(questionId)!;
    });
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
        this.events
          .publish(sessionId, "question_update", {
            updates: [...batch.values()],
          })
          .catch(() => {
            // Polling provides recovery if a live broadcast is temporarily unavailable.
          });
      }
    }, VOTE_BATCH_MS);
    timer.unref();
    this.timers.set(sessionId, timer);
  }
}
