import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  nextActivityState,
  type ActivityActionBody,
  type ActivityRunDto,
  type ActivityRunState,
  type LiveSessionView,
  type LiveSlide,
} from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { PollFlusherService } from "../realtime/poll-flusher.service";
import { PollStoreService, runRowSelect, toRunDto } from "../realtime/poll-store.service";
import { RoomEventsService } from "../realtime/room-events.service";
import { VoteBatcherService } from "../realtime/vote-batcher.service";
import { toSlideDto } from "../slides/slide.mapper";
import { joinUrl } from "./join-url";

const uuid = z.uuid();
const sessionNotFound = () => new ApiException(404, "NOT_FOUND", "Session not found");

/**
 * Running a live session from presenter control: which slide the room is on, and the state of
 * each activity (start, stop, show results, reopen, countdown timer). Every change is broadcast
 * to the session room, so the audience screen and the student phones follow.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveService.name);
  // Countdown timers of this instance, by run id. Every instance arms the timers it knows of;
  // the guarded write in expire() makes sure only one of them stops the activity.
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RoomEventsService,
    private readonly polls: PollStoreService,
    private readonly flusher: PollFlusherService,
    private readonly voteBatcher: VoteBatcherService,
  ) {}

  // After a restart, arm the countdowns that are still running.
  async onModuleInit() {
    const runs = await this.prisma.activityRun.findMany({
      where: { state: "live", endsAt: { not: null }, session: { status: { not: "ended" } } },
      select: { id: true, sessionId: true, endsAt: true },
    });
    for (const run of runs) this.arm(run.sessionId, run.id, run.endsAt!);
  }

  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  async view(ownerId: string, sessionId: string): Promise<LiveSessionView> {
    const session = await this.ownedSession(ownerId, sessionId);
    await this.expireDue(sessionId);
    const [slides, runs, participantCount] = await Promise.all([
      this.prisma.slide.findMany({
        where: { deckId: session.deckId },
        orderBy: { position: "asc" },
        include: {
          activity: {
            select: {
              id: true,
              type: true,
              prompt: true,
              allowAnswerChange: true,
              options: { orderBy: { position: "asc" }, select: { id: true, label: true } },
            },
          },
        },
      }),
      this.prisma.activityRun.findMany({
        where: { sessionId },
        select: { ...runRowSelect, activity: { select: { type: true } } },
      }),
      this.prisma.participant.count({ where: { sessionId, status: "active" } }),
    ]);

    const pollRuns = runs.filter((run) => run.activity.type === "poll");
    const tallies = await Promise.all(pollRuns.map((run) => this.polls.tally(sessionId, run.id)));

    return {
      id: session.id,
      deckId: session.deckId,
      pin: session.pin,
      status: session.status,
      title: session.deck.title,
      joinUrl: joinUrl(session.pin),
      startedAt: session.startedAt.toISOString(),
      serverNow: Date.now(),
      currentSlideId: session.currentSlideId,
      slides: slides.map((slide): LiveSlide => {
        const { id, position, kind, elements } = toSlideDto(slide);
        return { id, position, kind, elements, activity: slide.activity };
      }),
      runs: runs.map(toRunDto),
      tallies: Object.fromEntries(pollRuns.map((run, i) => [run.id, tallies[i]])),
      showResultsLive: (session.settings as { showResultsLive?: boolean }).showResultsLive === true,
      participantCount,
    };
  }

  /** Moves the room to a slide of the session's deck. Showing an activity never starts it. */
  async moveTo(ownerId: string, sessionId: string, slideId: string) {
    const session = await this.ownedSession(ownerId, sessionId);
    this.assertOpen(session.status);
    const slide = uuid.safeParse(slideId).success
      ? await this.prisma.slide.findFirst({
          where: { id: slideId, deckId: session.deckId },
          select: { id: true, position: true },
        })
      : null;
    if (!slide) {
      throw new ApiException(422, "INVALID_PAYLOAD", "The slide is not in this deck", {
        field: "currentSlideId",
      });
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { currentSlideId: slide.id },
      select: { id: true },
    });
    await this.events.publish(sessionId, "slide_changed", {
      slideId: slide.id,
      index: slide.position,
      activity: await this.polls.slideActivity(sessionId, slide.id),
    });
    return { currentSlideId: slide.id, index: slide.position };
  }

  async act(
    ownerId: string,
    sessionId: string,
    activityId: string,
    { action, durationSeconds }: ActivityActionBody,
  ): Promise<ActivityRunDto> {
    const session = await this.ownedSession(ownerId, sessionId);
    this.assertOpen(session.status);
    const activity = uuid.safeParse(activityId).success
      ? await this.prisma.activity.findFirst({
          where: { id: activityId, slide: { deckId: session.deckId } },
          select: { id: true, type: true },
        })
      : null;
    if (!activity) throw new ApiException(404, "NOT_FOUND", "Activity not found");

    await this.expireDue(sessionId);
    const run = await this.prisma.activityRun.findUnique({
      where: { sessionId_activityId: { sessionId, activityId } },
      select: runRowSelect,
    });
    const from: ActivityRunState = run?.state ?? "draft";
    const to = nextActivityState(from, action);
    if (!to) {
      throw new ApiException(
        409,
        "INVALID_TRANSITION",
        `Cannot ${action} an activity that is ${from}`,
        {
          state: from,
          action,
        },
      );
    }

    const now = new Date();
    const endsAt =
      to === "live" && durationSeconds ? new Date(now.getTime() + durationSeconds * 1000) : null;
    const data = {
      state: to,
      endsAt,
      ...(action === "start" && { firstOpenedAt: now }),
      ...(action === "reopen" && { lastReopenedAt: now }),
      ...(to !== "live" && from === "live" && { closedAt: now }),
    };

    let updated: NonNullable<typeof run>;
    if (!run) {
      try {
        updated = await this.prisma.activityRun.create({
          data: { sessionId, activityId, ...data },
          select: runRowSelect,
        });
      } catch (error) {
        // Another request created the run first (a double click): its state wins.
        if ((error as { code?: string }).code === "P2002") throw this.raced(action);
        throw error;
      }
    } else {
      // Guarded on the state we read, so two presses at once cannot both apply.
      const { count } = await this.prisma.activityRun.updateMany({
        where: { id: run.id, state: from },
        data,
      });
      if (count === 0) throw this.raced(action);
      updated = {
        ...run,
        state: to,
        endsAt,
        lastReopenedAt: action === "reopen" ? now : run.lastReopenedAt,
      };
    }

    this.disarm(updated.id);
    if (endsAt) this.arm(sessionId, updated.id, endsAt);
    const dto = toRunDto(updated);
    if (activity.type === "poll") await this.applyToPoll(sessionId, updated.id, to);
    await this.events.publish(sessionId, "activity_state", dto);
    if (activity.type === "poll") await this.voteBatcher.publishNow(sessionId, updated.id);
    return dto;
  }

  /**
   * Redis takes the new state first, so no vote gets in after a close. The room then hears of a
   * close only when every answer is in PostgreSQL (technical design §5.3).
   */
  private async applyToPoll(sessionId: string, runId: string, state: ActivityRunState) {
    await this.polls.syncRun(sessionId, runId);
    if (state !== "live") await this.flusher.finalFlush(sessionId);
  }

  // ----- countdown timer -----

  private arm(sessionId: string, runId: string, endsAt: Date) {
    this.disarm(runId);
    const delay = Math.max(0, endsAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(runId);
      this.expire(sessionId, runId, endsAt).catch((err: unknown) => {
        this.logger.error(
          `Could not stop activity run ${runId} at the end of its timer: ${String(err)}`,
        );
      });
    }, delay);
    timer.unref();
    this.timers.set(runId, timer);
  }

  private disarm(runId: string) {
    clearTimeout(this.timers.get(runId));
    this.timers.delete(runId);
  }

  /** Stops the run if it is still live on the same countdown. Only one instance wins the write. */
  private async expire(sessionId: string, runId: string, endsAt: Date) {
    const { count } = await this.prisma.activityRun.updateMany({
      where: { id: runId, state: "live", endsAt },
      data: { state: "closed", endsAt: null, closedAt: new Date() },
    });
    if (count === 0) return;
    const run = await this.prisma.activityRun.findUniqueOrThrow({
      where: { id: runId },
      select: { ...runRowSelect, activity: { select: { type: true } } },
    });
    const poll = run.activity.type === "poll";
    if (poll) await this.applyToPoll(sessionId, runId, run.state);
    await this.events.publish(sessionId, "activity_state", toRunDto(run));
    if (poll) await this.voteBatcher.publishNow(sessionId, runId);
  }

  /** Stops every run whose countdown has passed, in case no timer fired (a restart, a crash). */
  private async expireDue(sessionId: string) {
    const due = await this.prisma.activityRun.findMany({
      where: { sessionId, state: "live", endsAt: { lte: new Date() } },
      select: { id: true, endsAt: true },
    });
    for (const run of due) {
      this.disarm(run.id);
      await this.expire(sessionId, run.id, run.endsAt!);
    }
  }

  // ----- guards -----

  private async ownedSession(ownerId: string, sessionId: string) {
    if (!uuid.safeParse(sessionId).success) throw sessionNotFound();
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId },
      select: {
        id: true,
        pin: true,
        status: true,
        deckId: true,
        startedAt: true,
        settings: true,
        currentSlideId: true,
        deck: { select: { title: true } },
      },
    });
    if (!session) throw sessionNotFound();
    return session;
  }

  private assertOpen(status: string) {
    if (status === "ended") throw new ApiException(409, "SESSION_ENDED", "The session has ended");
  }

  private raced(action: string) {
    return new ApiException(
      409,
      "INVALID_TRANSITION",
      `Another change reached the activity before this ${action}`,
    );
  }
}
