import { Inject, Injectable } from "@nestjs/common";
import {
  EVENT_LOG_SIZE,
  type RoomEvent,
  type RoomEventData,
  type RoomEventType,
  type StatePayload,
} from "@moddeck/shared";
import Redis, { type Result } from "ioredis";
import { MetricsService } from "../metrics/metrics.service";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import type { RealtimeServer } from "./realtime.types";

// Live session keys expire a day after the last event (MD-2 §7).
const LIVE_KEY_TTL_SECONDS = 24 * 60 * 60;

// All keys of one session share the hash tag {sid} (technical design §5.2).
const seqKey = (sessionId: string) => `seq:{${sessionId}}`;
const logKey = (sessionId: string) => `log:{${sessionId}}`;

interface UntypedEmitter {
  emit(event: string, payload: unknown): boolean;
}

export const roomName = (sessionId: string) => `session:${sessionId}`;

// Takes the next seq and appends the event to the replay log in one atomic
// step, so the log order is the seq order on every instance.
// KEYS: seq, log. ARGV: event JSON without seq (starts with "{"), log size, TTL.
const PUBLISH_SCRIPT = `
local seq = redis.call('INCR', KEYS[1])
local event = '{"seq":' .. seq .. ',' .. string.sub(ARGV[1], 2)
redis.call('RPUSH', KEYS[2], event)
redis.call('LTRIM', KEYS[2], -tonumber(ARGV[2]), -1)
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return seq
`;

declare module "ioredis" {
  interface RedisCommander<Context> {
    publishRoomEvent(
      seqKey: string,
      logKey: string,
      event: string,
      logSize: number,
      ttlSeconds: number,
    ): Result<number, Context>;
  }
}

// Sequence numbers and replay log for session rooms (MD-13). Every event
// broadcast to a room goes through publish(), so every one carries a seq.
@Injectable()
export class RoomEventsService {
  private server?: RealtimeServer;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {
    this.redis.defineCommand("publishRoomEvent", { numberOfKeys: 2, lua: PUBLISH_SCRIPT });
  }

  attach(server: RealtimeServer) {
    this.server = server;
  }

  // Numbers the event, logs it, and broadcasts it to the room on every api
  // instance (through the Socket.IO Redis adapter). Resolves to the event sent.
  async publish<T extends RoomEventType>(
    sessionId: string,
    type: T,
    data: RoomEventData[T],
  ): Promise<RoomEvent<T>> {
    if (!this.server) throw new Error("RoomEventsService used before the gateway started");
    const at = Date.now();
    const body = JSON.stringify({ type, sessionId, at, data });
    const seq = await this.redis.publishRoomEvent(
      seqKey(sessionId),
      logKey(sessionId),
      body,
      EVENT_LOG_SIZE,
      LIVE_KEY_TTL_SECONDS,
    );
    const event = { seq, type, sessionId, at, data } as RoomEvent<T>;
    // The typed emit() cannot match a generic event name to its payload.
    const room = this.server.to(roomName(sessionId)) as unknown as UntypedEmitter;
    room.emit(type, event);
    this.metrics.roomEventsPublished.inc({ type });
    return event;
  }

  async currentSeq(sessionId: string): Promise<number> {
    return Number((await this.redis.get(seqKey(sessionId))) ?? 0);
  }

  // State for a client that (re)joins after `lastSeq`. Call after the socket
  // has joined the room: an event published in between then arrives both live
  // and in the replay, and the client drops the one with a seq it already has.
  async sync(sessionId: string, lastSeq?: number): Promise<StatePayload> {
    const [[, rawSeq], [, rawLog]] = (await this.redis
      .multi()
      .get(seqKey(sessionId))
      .lrange(logKey(sessionId), 0, -1)
      .exec()) as [[null, string | null], [null, string[]]];
    const seq = Number(rawSeq ?? 0);

    if (lastSeq !== undefined && lastSeq <= seq) {
      const events = rawLog.map((line) => JSON.parse(line) as RoomEvent);
      const oldest = events.length > 0 ? events[0].seq : seq + 1;
      // Replay only if no event after lastSeq has been trimmed from the log.
      if (oldest <= lastSeq + 1) {
        return { mode: "replay", sessionId, seq, events: events.filter((e) => e.seq > lastSeq) };
      }
    }

    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true, currentSlideId: true },
    });
    return { mode: "snapshot", sessionId, seq, snapshot: session };
  }
}
