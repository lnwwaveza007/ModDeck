import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { RoomEventsService } from "../realtime/room-events.service";
import { hashToken } from "../realtime/participant-token";

const QUESTION_RATE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
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
}) => ({
  id: q.id,
  text: q.text,
  anonymous: q.anonymous,
  status: q.status,
  createdAt: q.createdAt.toISOString(),
  votes: q._count.votes,
  author: q.anonymous ? null : q.participant.nickname,
  ...(q.votes ? { voted: q.votes.length > 0 } : {}),
});

@Injectable()
export class QuestionsService {
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
    await this.events.publish(sessionId, "question_update", {
      action: "created",
      question: result,
    });
    return result;
  }

  async toggleVote(sessionId: string, questionId: string, token?: string) {
    const { participantId } = await this.identity(token, sessionId);
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, sessionId, status: { notIn: ["hidden", "deleted"] } },
      select: { id: true },
    });
    if (!question) throw new ApiException(404, "NOT_FOUND", "Question not found");
    const key = { questionId_participantId: { questionId, participantId } };
    const found = await this.prisma.questionVote.findUnique({ where: key });
    if (found) await this.prisma.questionVote.delete({ where: key });
    else await this.prisma.questionVote.create({ data: { questionId, participantId } });
    const votes = await this.prisma.questionVote.count({ where: { questionId } });
    await this.events.publish(sessionId, "question_update", { action: "votes", questionId, votes });
    return { voted: !found, votes };
  }
}
