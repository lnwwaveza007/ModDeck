import { Injectable } from "@nestjs/common";
import type { SessionRole } from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";

const uuid = z.uuid();

/**
 * What a host-side call needs (F12, MD-5 §2.5):
 * - `member`: the owner or the co-host. Reading the live session, Q&A moderation, the people list.
 * - `control`: whoever runs presenter control now. Slides, activities, toggles, ending the session.
 * - `owner`: the owner only. Inviting or removing the co-host.
 * Participants never pass: they have a participant token, not a role in the session.
 */
export type SessionNeed = "member" | "control" | "owner";

const accessSelect = {
  id: true,
  pin: true,
  status: true,
  deckId: true,
  ownerId: true,
  controllerId: true,
  startedAt: true,
  settings: true,
  currentSlideId: true,
  deck: { select: { title: true } },
  owner: { select: { displayName: true } },
} as const;

/** The role checks of every host-side REST call. The socket join has its own (RoomAuthService). */
@Injectable()
export class SessionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The session, with the caller's role and who is in control. A user with no role gets 404, as
   * for a session that does not exist: its id says nothing about who runs it. A member without
   * the right gets 403.
   */
  async check(userId: string, sessionId: string, need: SessionNeed) {
    const session = uuid.safeParse(sessionId).success
      ? await this.prisma.session.findFirst({
          where: { id: sessionId, OR: [{ ownerId: userId }, { cohost: { is: { userId } } }] },
          select: accessSelect,
        })
      : null;
    if (!session) throw new ApiException(404, "NOT_FOUND", "Session not found");
    const role: SessionRole = session.ownerId === userId ? "owner" : "cohost";
    const controllerId = session.controllerId ?? session.ownerId;
    if (need === "owner" && role !== "owner") {
      throw new ApiException(403, "ROOM_FORBIDDEN", "Only the session owner can do this");
    }
    if (need === "control" && controllerId !== userId) {
      throw new ApiException(403, "NOT_CONTROLLER", "Another host runs presenter control now", {
        controllerId,
      });
    }
    return { ...session, role, controllerId };
  }
}
