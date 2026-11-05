import { Injectable } from "@nestjs/common";
import type { ErrorCode } from "@moddeck/shared";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "./participant-token";
import { PresenceService } from "./presence.service";

// Who a socket is. Set once in the handshake and never taken from a payload.
// A participant can only ever join the room of its own token's session. A host
// (presenter control, audience screen) can join the rooms of sessions they own,
// checked at join time.
export type SocketIdentity =
  | { role: "participant"; participantId: string; sessionId: string }
  | { role: "host"; userId: string };

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
    private readonly auth: AuthService,
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
    return { role: "participant", participantId: participant.id, sessionId: participant.sessionId };
  }

  /** The host login cookie. The socket does not renew it: the REST calls of the same page do. */
  async authenticateHost(token: string | undefined): Promise<SocketIdentity> {
    if (!token) throw new RoomAuthError("UNAUTHORIZED", "Missing host login");
    const result = await this.auth.authenticate(token);
    if (!result) throw new RoomAuthError("UNAUTHORIZED", "Host login has expired");
    return { role: "host", userId: result.user.id };
  }

  /** A host may join the room of a session they own while it is open. */
  async assertHostCanJoin(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { ownerId: true, endedAt: true },
    });
    if (!session || session.ownerId !== userId) {
      throw new RoomAuthError("ROOM_FORBIDDEN", "This session belongs to another host");
    }
    if (session.endedAt) throw new RoomAuthError("SESSION_ENDED", "Session has ended");
  }
}
