import { Injectable } from "@nestjs/common";
import type { ErrorCode } from "@moddeck/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "./participant-token";
import { PresenceService } from "./presence.service";

// Who a socket is. Set once in the handshake and never taken from a payload,
// so a socket can only ever join the room of its own token's session.
export interface SocketIdentity {
  participantId: string;
  sessionId: string;
}

export class RoomAuthError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class RoomAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  async authenticate(token: string | undefined, now = new Date()): Promise<SocketIdentity> {
    if (!token) throw new RoomAuthError("UNAUTHORIZED", "Missing participant token");

    const participant = await this.prisma.participant.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        sessionId: true,
        status: true,
        tokenExpiresAt: true,
        lastSeenAt: true,
        session: true,
      },
    });
    if (!participant) throw new RoomAuthError("UNAUTHORIZED", "Unknown participant token");
    if (participant.tokenExpiresAt <= now) {
      throw new RoomAuthError("TOKEN_EXPIRED", "Participant token has expired");
    }
    if (participant.status !== "active") {
      throw new RoomAuthError("PARTICIPANT_REMOVED", "Participant was removed from the session");
    }
    if (participant.session.status === "ended") {
      throw new RoomAuthError("SESSION_ENDED", "Session has ended");
    }
    // Back after more than 15 min: the seat may be taken. A full room says so (MD-5 §6.5).
    if (!(await this.presence.canSeat(participant, this.prisma, now))) {
      throw new RoomAuthError("SESSION_FULL", "Session is full");
    }
    return { participantId: participant.id, sessionId: participant.sessionId };
  }
}
