import { Injectable } from "@nestjs/common";
import type { ErrorCode } from "@moddeck/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "./participant-token";

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
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(token: string | undefined, now = new Date()): Promise<SocketIdentity> {
    if (!token) throw new RoomAuthError("UNAUTHORIZED", "Missing participant token");

    const participant = await this.prisma.participant.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        sessionId: true,
        status: true,
        tokenExpiresAt: true,
        session: { select: { status: true } }, // only fetch what you need
      },
    });

    if (!participant) throw new RoomAuthError("UNAUTHORIZED", "Unknown participant token");

    if (participant.tokenExpiresAt <= now) {
      throw new RoomAuthError("TOKEN_EXPIRED", "Participant token has expired");
    }

    if (participant.status !== "active") {
      throw new RoomAuthError("PARTICIPANT_REMOVED", "Participant was removed from the session");
    }

    // Guard against null relation or unassigned session
    if (!participant.session || !participant.sessionId) {
      throw new RoomAuthError("UNAUTHORIZED", "Session not found for participant");
    }

    // participant.session is now narrowed from (Session | null) -> Session
    if (participant.session.status === "ended") {
      throw new RoomAuthError("SESSION_ENDED", "Session has ended");
    }

    // participant.sessionId is now narrowed from (string | null) -> string
    return { participantId: participant.id, sessionId: participant.sessionId };
  }
}
