import { Injectable, Logger } from "@nestjs/common";
import {
  qaShown,
  REACTION_EMOJIS,
  type ActivityResult,
  type ReactionEmoji,
  type SessionResults,
  type SessionSummary,
  type SlideReactions,
} from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import { questionSelect, questionView } from "../participants/question-view";
import { PrismaService } from "../prisma/prisma.service";
import { PollFlusherService } from "../realtime/poll-flusher.service";
import { PollStoreService } from "../realtime/poll-store.service";
import { WordStoreService } from "../realtime/word-store.service";
import { liveActivitySelect, toLiveActivity } from "../slides/slide.mapper";

const uuid = z.uuid();
const sessionNotFound = () => new ApiException(404, "NOT_FOUND", "Session not found");

const summarySelect = {
  id: true,
  status: true,
  startedAt: true,
  endedAt: true,
  deck: { select: { id: true, title: true, deletedAt: true } },
  _count: { select: { participants: { where: { status: "active" } } } },
} as const;

type SummaryRow = {
  id: string;
  status: SessionSummary["status"];
  startedAt: Date;
  endedAt: Date | null;
  deck: { id: string; title: string; deletedAt: Date | null };
  _count: { participants: number };
};

const toSummary = (row: SummaryRow): SessionSummary => ({
  id: row.id,
  status: row.status,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  deck: { id: row.deck.id, title: row.deck.title, deleted: row.deck.deletedAt !== null },
  participantCount: row._count.participants,
});

/**
 * Session history after class (F10): the host's past sessions and the results of each activity.
 * Results come from PostgreSQL only, never Redis: the end of a session runs the final flush, so
 * what is stored is what the room saw. Counting goes through the same stored tallies the live
 * screens fall back to, so a removed participant and a hidden word are left out here too.
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flusher: PollFlusherService,
    private readonly polls: PollStoreService,
    private readonly words: WordStoreService,
  ) {}

  /** Every session of the host's decks, deleted decks included, newest first. */
  async list(ownerId: string): Promise<SessionSummary[]> {
    const rows = await this.prisma.session.findMany({
      where: { ownerId },
      orderBy: { startedAt: "desc" },
      select: summarySelect,
    });
    return rows.map(toSummary);
  }

  async results(ownerId: string, sessionId: string): Promise<SessionResults> {
    const session = await this.owned(ownerId, sessionId);
    // An open session still counts in Redis: its results page comes once it has ended.
    if (session.status !== "ended") throw sessionLive();
    // The end marks the session ended before its final flush is done, and another host window
    // follows the end at once. Flushing here waits for that flush (one flusher per session) and
    // writes anything still in Redis, so the read below is complete. Repeats insert nothing.
    await this.flusher.finalFlush(sessionId).catch((err: unknown) => {
      this.logger.warn(`Flush before results failed for session ${sessionId}: ${String(err)}`);
    });

    const [slides, runs, questions, reactionRows] = await Promise.all([
      this.prisma.slide.findMany({
        where: { deckId: session.deck.id, activity: { isNot: null } },
        orderBy: { position: "asc" },
        select: { position: true, activity: { select: liveActivitySelect } },
      }),
      this.prisma.activityRun.findMany({
        where: { sessionId },
        select: { id: true, activityId: true, state: true },
      }),
      this.prisma.question.findMany({
        where: { sessionId, status: { not: "deleted" } },
        select: questionSelect,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.reactionCount.findMany({
        where: { sessionId, count: { gt: 0 } },
        select: { emoji: true, count: true, slide: { select: { position: true } } },
      }),
    ]);

    const runOf = new Map(runs.map((run) => [run.activityId, run]));
    const activities = await Promise.all(
      slides.map(async ({ position, activity: row }): Promise<ActivityResult> => {
        const activity = toLiveActivity(row!);
        const run = runOf.get(activity.id);
        const ran = run !== undefined && run.state !== "draft";
        return {
          slidePosition: position,
          activity,
          ran,
          results: ran && activity.type === "poll" ? await this.polls.storedTally(run.id) : null,
          cloud:
            ran && activity.type === "word_cloud" ? await this.words.storedTally(run.id) : null,
        };
      }),
    );

    return {
      session: toSummary(session),
      activities,
      qaShown: qaShown(session.settings) || questions.length > 0,
      questions: questions.map(questionView),
      reactions: slideReactions(reactionRows),
    };
  }

  /**
   * Deletes an ended session for good, with its participants, answers, words and questions. An
   * open session is refused: end it first. The guarded delete makes the check and the delete one.
   */
  async remove(ownerId: string, sessionId: string): Promise<void> {
    if (!uuid.safeParse(sessionId).success) throw sessionNotFound();
    const { count } = await this.prisma.session.deleteMany({
      where: { id: sessionId, ownerId, status: "ended" },
    });
    if (count > 0) return;
    await this.owned(ownerId, sessionId); // 404 when it is not the host's
    throw sessionLive();
  }

  private async owned(ownerId: string, sessionId: string) {
    if (!uuid.safeParse(sessionId).success) throw sessionNotFound();
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId },
      select: { ...summarySelect, settings: true },
    });
    if (!session) throw sessionNotFound();
    return session;
  }
}

/** One entry per slide, in slide order. Rows for an emoji no longer in the set are left out. */
function slideReactions(
  rows: { emoji: string; count: number; slide: { position: number } }[],
): SlideReactions[] {
  const bySlide = new Map<number, SlideReactions>();
  for (const { emoji, count, slide } of rows) {
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) continue;
    const entry = bySlide.get(slide.position) ?? { slidePosition: slide.position, counts: {} };
    entry.counts[emoji as ReactionEmoji] = count;
    bySlide.set(slide.position, entry);
  }
  return [...bySlide.values()].sort((a, b) => a.slidePosition - b.slidePosition);
}

const sessionLive = () =>
  new ApiException(409, "SESSION_LIVE", "The session is still open: end it first");
