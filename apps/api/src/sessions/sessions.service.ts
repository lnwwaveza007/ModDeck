import { Inject, Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import Redis from "ioredis";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { PollFlusherService } from "../realtime/poll-flusher.service";
import { PollStoreService } from "../realtime/poll-store.service";
import { REDIS } from "../redis/redis.module";
import { RoomEventsService } from "../realtime/room-events.service";
import { joinUrl } from "./join-url";

const pinKey = (pin: string) => `session-pin:${pin}`;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: RoomEventsService,
    private readonly polls: PollStoreService,
    private readonly flusher: PollFlusherService,
  ) {}

  async create(ownerId: string, deckId: string) {
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, ownerId, deletedAt: null },
      include: {
        slides: {
          orderBy: { position: "asc" },
          include: { activity: { include: { options: true } } },
        },
        imports: { where: { status: "running" }, select: { id: true }, take: 1 },
      },
    });
    if (!deck) throw new ApiException(404, "NOT_FOUND", "Deck not found");
    if (deck.imports.length)
      throw new ApiException(409, "IMPORT_RUNNING", "A PDF import is still running");
    const incomplete = deck.slides.some(
      ({ activity }) =>
        activity &&
        (!activity.prompt.trim() || (activity.type === "poll" && activity.options.length < 2)),
    );
    if (incomplete)
      throw new ApiException(422, "DECK_INCOMPLETE", "Complete all activities before starting");
    for (let attempt = 0; attempt < 30; attempt++) {
      const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
      if (!(await this.redis.set(pinKey(pin), "reserved", "EX", 86400, "NX"))) continue;
      try {
        const session = await this.prisma.session.create({
          data: {
            ownerId,
            deckId,
            pin,
            currentSlideId: deck.slides[0]?.id,
            settings: {
              requireKmuttLogin: deck.requireKmuttLogin,
              qaEnabled: deck.qaEnabled,
              anonymousAllowed: deck.anonymousAllowed,
              showResultsLive: deck.showResultsLive,
              autoStart: deck.autoStart,
              reactionsEnabled: deck.reactionsEnabled,
            },
          },
          select: {
            id: true,
            pin: true,
            status: true,
            startedAt: true,
            deck: { select: { title: true } },
          },
        });
        await this.redis.set(pinKey(pin), session.id, "EX", 86400);
        return {
          ...session,
          participantCount: 0,
          joinUrl: joinUrl(pin),
        };
      } catch (error) {
        await this.redis.del(pinKey(pin));
        if ((error as { code?: string }).code === "P2002") continue;
        throw error;
      }
    }
    throw new ApiException(503, "INTERNAL", "Could not allocate a session PIN");
  }

  async list(ownerId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { ownerId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        pin: true,
        status: true,
        startedAt: true,
        endedAt: true,
        deck: { select: { title: true } },
        _count: { select: { participants: true } },
      },
    });
    return sessions.map(({ _count, ...session }) => ({
      ...session,
      participantCount: _count.participants,
    }));
  }

  async get(ownerId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId },
      select: {
        id: true,
        pin: true,
        status: true,
        startedAt: true,
        endedAt: true,
        deck: { select: { title: true } },
        _count: { select: { participants: true } },
      },
    });
    if (!session) throw new ApiException(404, "NOT_FOUND", "Session not found");
    return {
      ...session,
      participantCount: session._count.participants,
      // Lets the lobby correct for a browser clock that differs from the server.
      serverNow: Date.now(),
      joinUrl: joinUrl(session.pin),
    };
  }

  /**
   * Ends the session now. The 2 s hold on the End Session button is the guard against an
   * accidental end, so there is no undo window. Safe to repeat: a second call changes nothing.
   */
  async end(ownerId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId },
      select: { id: true, pin: true },
    });
    if (!session) throw new ApiException(404, "NOT_FOUND", "Session not found");
    await this.finish(session);
    return { status: "ended" as const };
  }

  /** Guarded write: only the first caller ends the session and tells the room. */
  private async finish(session: { id: string; pin: string }) {
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, endedAt: null },
      data: { status: "ended", endedAt: new Date(), endReason: "host" },
    });
    if (count === 0) return;
    await this.redis.del(pinKey(session.pin));
    await this.closeLiveRuns(session.id);
    await this.events.publish(session.id, "session_ended", { reason: "host" });
  }

  /** An activity that is still live closes with the session (MD-5 §7.1). */
  private async closeLiveRuns(sessionId: string) {
    const live = await this.prisma.activityRun.findMany({
      where: { sessionId, state: "live" },
      select: { id: true },
    });
    if (live.length === 0) return;
    await this.prisma.activityRun.updateMany({
      where: { sessionId, state: "live" },
      data: { state: "closed", endsAt: null, closedAt: new Date() },
    });
    for (const { id } of live) await this.polls.syncRun(sessionId, id);
    await this.flusher.finalFlush(sessionId);
  }

  // The open session behind a PIN, for the join flow (ParticipantsService). The
  // id stays on the server until the student has joined.
  async openByPin(pin: string) {
    const session = await this.prisma.session.findFirst({
      where: { pin },
      orderBy: { startedAt: "desc" },
      select: { id: true, pin: true, status: true, endedAt: true },
    });
    if (!session) throw new ApiException(404, "NOT_FOUND", "No session found");
    if (session.status === "ended") {
      // Left over from the old undo window: marked ended but never finished.
      if (!session.endedAt) await this.finish(session);
      throw new ApiException(410, "SESSION_ENDED", "Session ended");
    }
    return { id: session.id, status: session.status };
  }
}
