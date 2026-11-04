import { Injectable } from "@nestjs/common";
import { MAX_PARTICIPANTS, SEAT_HOLD_MS } from "@moddeck/shared";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type Db = Pick<PrismaService, "participant">;

// Who holds a seat (MD-5 rule 9, Q22). A participant keeps their seat while
// connected and for SEAT_HOLD_MS after the last moment they were seen online.
// A connected socket refreshes lastSeenAt on a heartbeat, and once more when it
// drops, so the hold clock starts from the real moment the network went away.
@Injectable()
export class PresenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active participants whose seat is still held. */
  seatedWhere(sessionId: string, now = new Date()): Prisma.ParticipantWhereInput {
    return {
      sessionId,
      status: "active",
      lastSeenAt: { gt: new Date(now.getTime() - SEAT_HOLD_MS) },
    };
  }

  seatedCount(sessionId: string, db: Db = this.prisma, now = new Date()): Promise<number> {
    return db.participant.count({ where: this.seatedWhere(sessionId, now) });
  }

  /** True when this participant is inside the hold window, so a full room cannot take their seat. */
  holdsSeat(participant: { lastSeenAt: Date }, now = new Date()): boolean {
    return participant.lastSeenAt.getTime() > now.getTime() - SEAT_HOLD_MS;
  }

  /**
   * Can a participant who may have been away longer than the hold sit down?
   * Inside the hold: always. After it: only if the room is not full.
   */
  async canSeat(
    participant: { id: string; sessionId: string; lastSeenAt: Date },
    db: Db = this.prisma,
    now = new Date(),
  ): Promise<boolean> {
    if (this.holdsSeat(participant, now)) return true;
    const others = await db.participant.count({
      where: { ...this.seatedWhere(participant.sessionId, now), id: { not: participant.id } },
    });
    return others < MAX_PARTICIPANTS;
  }

  /** Marks the participant as seen now. Fire and forget: presence must never break a socket. */
  async touch(participantId: string, db: Db = this.prisma): Promise<void> {
    await db.participant.update({ where: { id: participantId }, data: { lastSeenAt: new Date() } });
  }
}
