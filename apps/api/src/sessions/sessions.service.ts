import { Inject, Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import Redis from "ioredis";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { RoomEventsService } from "../realtime/room-events.service";

const pinKey = (pin: string) => `session-pin:${pin}`;
const endingKey = (id: string) => `session-ending:${id}`;
const UNDO_SECONDS = 60;

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: RoomEventsService,
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
          joinUrl: `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/j/${pin}`,
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
    const endingAt = await this.redis.get(endingKey(sessionId));
    return {
      ...session,
      participantCount: session._count.participants,
      endingAt: endingAt ? Number(endingAt) : null,
      // Lets the lobby correct for a browser clock that differs from the server.
      serverNow: Date.now(),
      joinUrl: `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/j/${session.pin}`,
    };
  }

  async requestEnd(ownerId: string, sessionId: string) {
    const existing = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId },
      select: { id: true, status: true, endedAt: true },
    });
    if (!existing) throw new ApiException(404, "NOT_FOUND", "Session not found");
    if (existing.status === "ended") {
      if (existing.endedAt) return { status: "ended" as const, endingAt: null, undoSeconds: 0 };
      const currentDeadline = await this.redis.get(endingKey(sessionId));
      if (!currentDeadline || Number(currentDeadline) <= Date.now()) {
        await this.finishEnd(ownerId, sessionId);
        return { status: "ended" as const, endingAt: null, undoSeconds: 0 };
      }
      return {
        status: "ended" as const,
        endingAt: currentDeadline ? Number(currentDeadline) : null,
        undoSeconds: UNDO_SECONDS,
      };
    }
    const deadline = Date.now() + UNDO_SECONDS * 1000;
    await this.redis.set(endingKey(sessionId), String(deadline), "EX", 86400);
    await this.prisma.session.update({ where: { id: sessionId }, data: { status: "ended" } });
    return { status: "ended" as const, endingAt: deadline, undoSeconds: UNDO_SECONDS };
  }

  async undoEnd(ownerId: string, sessionId: string) {
    const deadline = await this.redis.get(endingKey(sessionId));
    if (!deadline || Number(deadline) <= Date.now())
      throw new ApiException(409, "UNDO_EXPIRED", "The undo window has expired");
    // Guarded write: a concurrent finish that already set endedAt must win.
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, ownerId, status: "ended", endedAt: null },
      data: { status: "live" },
    });
    if (count === 0) throw new ApiException(409, "UNDO_EXPIRED", "The undo window has expired");
    await this.redis.del(endingKey(sessionId));
    return { status: "live" as const };
  }

  async finishEnd(ownerId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, ownerId, status: "ended" },
      select: { id: true, pin: true, endedAt: true },
    });
    if (!session) throw new ApiException(404, "NOT_FOUND", "Ended session not found");
    if (session.endedAt) return { status: "ended" as const };
    // A missing deadline means the Redis key was lost. The undo window can no
    // longer be honored, so finish now instead of leaving the session stuck.
    const deadline = await this.redis.get(endingKey(sessionId));
    if (deadline && Number(deadline) > Date.now())
      throw new ApiException(409, "UNDO_EXPIRED", "The undo window is still open");
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, ownerId, status: "ended", endedAt: null },
      data: { endedAt: new Date(), endReason: "host" },
    });
    if (count === 0) throw new ApiException(409, "UNDO_EXPIRED", "The session was reopened");
    await this.redis.del(endingKey(sessionId), pinKey(session.pin));
    await this.events.publish(sessionId, "session_ended", { reason: "host" });
    return { status: "ended" as const };
  }

  // The open session behind a PIN, for the join flow (ParticipantsService). The
  // id stays on the server until the student has joined.
  async openByPin(pin: string) {
    const session = await this.prisma.session.findFirst({
      where: { pin },
      orderBy: { startedAt: "desc" },
      select: { id: true, ownerId: true, status: true, endedAt: true },
    });
    if (!session) throw new ApiException(404, "NOT_FOUND", "No session found");
    if (session.status === "ended") {
      const deadline = await this.redis.get(endingKey(session.id));
      if (!session.endedAt && (!deadline || Number(deadline) <= Date.now())) {
        await this.finishEnd(session.ownerId, session.id);
      }
      throw new ApiException(410, "SESSION_ENDED", "Session ended");
    }
    const deadline = await this.redis.get(endingKey(session.id));
    if (deadline && Number(deadline) <= Date.now()) {
      await this.finishEnd(session.ownerId, session.id);
      throw new ApiException(410, "SESSION_ENDED", "Session ended");
    }
    return { id: session.id, status: session.status };
  }
}
