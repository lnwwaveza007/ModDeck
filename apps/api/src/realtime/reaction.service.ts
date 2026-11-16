import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  REACTION_BATCH_MS,
  REACTION_INTERVAL_MS,
  type ReactionBurst,
  type ReactionEmoji,
} from "@moddeck/shared";
import Redis, { type Result } from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import type { RealtimeServer } from "./realtime.types";

// Live session keys expire a day after the last change, as the event log does.
const LIVE_KEY_TTL_SECONDS = 24 * 60 * 60;

// All keys of one session share the hash tag {sid} (technical design §5.2).
const switchKey = (sid: string) => `reactions:{${sid}}`; // "1" on, "0" off
const lastTapKey = (sid: string, participantId: string) => `rtap:{${sid}}:${participantId}`;

/** The host's screens (presenter control, audience screen) of a session. Phones never join it. */
export const hostRoomName = (sessionId: string) => `hosts:${sessionId}`;

// The tap step: the switch and the per-participant limit in one round trip.
// KEYS: switch, last tap. ARGV: interval ms.
// Returns -1 when the switch is not in Redis yet, 0 when reactions are off, 1 for a tap that
// counts, and 2 for a tap that came too soon after the last one.
const TAP_SCRIPT = `
local on = redis.call('GET', KEYS[1])
if not on then return -1 end
if on == '0' then return 0 end
if redis.call('SET', KEYS[2], '1', 'PX', ARGV[1], 'NX') then return 1 end
return 2
`;

declare module "ioredis" {
  interface RedisCommander<Context> {
    reactionTap(switchKey: string, lastTapKey: string, intervalMs: number): Result<number, Context>;
  }
}

export type TapOutcome = "accepted" | "off" | "too_soon";

/**
 * Live reactions (F11, R1-15). A tap passes the on/off switch and the limit of one per
 * participant per REACTION_INTERVAL_MS, then waits for the next batch: every REACTION_BATCH_MS
 * this instance sends the taps of each room to the host's screens as one `reaction_burst`, so a
 * burst of 300 taps is one message, not 300. Nothing is saved, and nothing goes to the phones.
 *
 * Each instance batches the taps of its own sockets. With N instances a busy room gets up to N
 * bursts per batch, which the projector simply adds up.
 */
@Injectable()
export class ReactionService implements OnModuleDestroy {
  private readonly logger = new Logger(ReactionService.name);
  private server?: RealtimeServer;
  private readonly pending = new Map<string, Partial<Record<ReactionEmoji, number>>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {
    this.redis.defineCommand("reactionTap", { numberOfKeys: 2, lua: TAP_SCRIPT });
  }

  attach(server: RealtimeServer) {
    this.server = server;
  }

  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  /** A student's tap. It goes out with the next batch when it counts. */
  async tap(sessionId: string, participantId: string, emoji: ReactionEmoji): Promise<TapOutcome> {
    let result = await this.runTap(sessionId, participantId);
    if (result === -1) {
      // First tap of the session on this Redis, or Redis lost the key: the database decides.
      await this.loadSwitch(sessionId);
      result = await this.runTap(sessionId, participantId);
    }
    if (result === 0 || result === -1) return "off";
    if (result === 2) return "too_soon";
    this.add(sessionId, emoji);
    return "accepted";
  }

  /** The host turned reactions on or off. Taps already in a batch still go out. */
  async setEnabled(sessionId: string, enabled: boolean) {
    await this.redis.set(switchKey(sessionId), enabled ? "1" : "0", "EX", LIVE_KEY_TTL_SECONDS);
  }

  private runTap(sessionId: string, participantId: string) {
    return this.redis.reactionTap(
      switchKey(sessionId),
      lastTapKey(sessionId, participantId),
      REACTION_INTERVAL_MS,
    );
  }

  private async loadSwitch(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, settings: true },
    });
    const enabled = !!session && session.status !== "ended" && reactionsEnabled(session.settings);
    // NX: a host who just pressed the switch on another instance wins over this read.
    await this.redis.set(
      switchKey(sessionId),
      enabled ? "1" : "0",
      "EX",
      LIVE_KEY_TTL_SECONDS,
      "NX",
    );
  }

  private add(sessionId: string, emoji: ReactionEmoji) {
    const counts = this.pending.get(sessionId) ?? {};
    counts[emoji] = (counts[emoji] ?? 0) + 1;
    this.pending.set(sessionId, counts);
    if (this.timers.has(sessionId)) return;
    const timer = setTimeout(() => this.flush(sessionId), REACTION_BATCH_MS);
    timer.unref();
    this.timers.set(sessionId, timer);
  }

  private flush(sessionId: string) {
    this.timers.delete(sessionId);
    const counts = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    if (!counts) return;
    if (!this.server) {
      this.logger.error("ReactionService used before the gateway started");
      return;
    }
    const burst: ReactionBurst = { sessionId, counts };
    // Through the Socket.IO Redis adapter, so host screens on every instance get it.
    this.server.to(hostRoomName(sessionId)).emit("reaction_burst", burst);
  }
}

/** Reactions are on unless the session's settings turn them off. */
export function reactionsEnabled(settings: unknown): boolean {
  return (settings as { reactionsEnabled?: boolean } | null)?.reactionsEnabled !== false;
}
