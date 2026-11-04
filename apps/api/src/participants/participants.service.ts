import { Injectable } from "@nestjs/common";
import {
  MAX_PARTICIPANTS,
  nicknameProblem,
  normalizeNickname,
  type JoinResult,
  type ParticipantMe,
  type PinInfo,
} from "@moddeck/shared";
import type { AuthUser } from "../auth/auth.types";
import { randomToken } from "../auth/crypto.util";
import { ApiException } from "../common/api-error";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../realtime/participant-token";
import { PresenceService } from "../realtime/presence.service";
import { SessionsService } from "../sessions/sessions.service";

// Participant token lifetime (technical design §3.6: 8 h, sliding).
export const PARTICIPANT_TTL_MS = 8 * 60 * 60 * 1000;

export interface JoinOutcome {
  result: JoinResult;
  /** false: the same participant came back (200). */
  created: boolean;
  /** The cookie to set. A rejoin with a valid cookie keeps its token. */
  token: string;
  expiresAt: Date;
}

const toResult = (p: {
  id: string;
  sessionId: string;
  loginType: "sso" | "guest";
  nickname: string;
}): JoinResult => ({
  participantId: p.id,
  sessionId: p.sessionId,
  loginType: p.loginType,
  nickname: p.nickname,
});

const requiresLogin = (settings: Prisma.JsonValue) =>
  typeof settings === "object" &&
  settings !== null &&
  !Array.isArray(settings) &&
  settings.requireKmuttLogin === true;

/**
 * Student join (F2) on the MD-7 guest model: a random token in an HttpOnly
 * cookie, only its SHA-256 stored, scoped to one session.
 */
@Injectable()
export class ParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly presence: PresenceService,
  ) {}

  /** GET /pins/{pin}. `token` is the participant cookie, if any. */
  async pinInfo(pin: string, token: string | undefined): Promise<PinInfo> {
    const { id, status } = await this.sessions.openByPin(pin);
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id },
      select: {
        settings: true,
        deck: { select: { title: true } },
        owner: { select: { displayName: true } },
      },
    });
    const me = await this.findByToken(token, id);
    // Only held seats count: someone offline for over 15 min no longer takes a seat (MD-5 §6.5).
    const participantCount = await this.presence.seatedCount(id);
    // A participant who holds a seat always gets back in, even when the session is full.
    if ((!me || !this.presence.holdsSeat(me)) && participantCount >= MAX_PARTICIPANTS) {
      throw new ApiException(409, "SESSION_FULL", "Session is full");
    }
    return {
      status: status === "host_away" ? "host_away" : "live",
      title: session.deck.title,
      hostName: session.owner.displayName,
      participantCount,
      requireLogin: requiresLogin(session.settings),
      joined: me ? { sessionId: id, nickname: me.nickname } : null,
    };
  }

  /**
   * POST /pins/{pin}/participants. With a nickname: guest. Without: the KMUTT
   * login in `user`. `token` is the participant cookie, if any.
   */
  async join(
    pin: string,
    nicknameInput: string | undefined,
    user: AuthUser | null,
    token: string | undefined,
  ): Promise<JoinOutcome> {
    const { id: sessionId } = await this.sessions.openByPin(pin);
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { settings: true, owner: { select: { displayName: true } } },
    });

    const asGuest = nicknameInput !== undefined;
    if (!asGuest && !user) {
      throw new ApiException(401, "UNAUTHORIZED", "Log in with KMUTT or send a nickname");
    }
    if (asGuest && requiresLogin(session.settings)) {
      throw new ApiException(403, "LOGIN_REQUIRED", "This session requires a KMUTT login");
    }
    const nickname = asGuest ? normalizeNickname(nicknameInput) : user!.displayName;
    if (asGuest) {
      const problem = nicknameProblem(nickname, [session.owner.displayName]);
      if (problem) {
        throw new ApiException(422, "NICKNAME_INVALID", "Nickname breaks the nickname rules", {
          fields: { nickname: problem },
        });
      }
    }

    const expiresAt = new Date(Date.now() + PARTICIPANT_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      // One join at a time per session, so 300 joins at once cannot pass the
      // seat count or take the same nickname together.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;

      // Rejoin from the same browser: keep the participant and its token.
      const own = token
        ? await tx.participant.findUnique({ where: { tokenHash: hashToken(token) } })
        : null;
      if (
        own &&
        own.sessionId === sessionId &&
        (asGuest ? own.loginType === "guest" : own.userId === user!.id)
      ) {
        if (own.status !== "active") throw removed();
        if (!(await this.presence.canSeat(own, tx))) throw sessionFull();
        await tx.participant.update({
          where: { id: own.id },
          data: { tokenExpiresAt: expiresAt, lastSeenAt: new Date() },
        });
        return { result: toResult(own), created: false, token: token!, expiresAt };
      }

      // The same KMUTT account on another browser or device is the same
      // participant (MD-5 §6.6). It gets a new token.
      if (!asGuest) {
        const existing = await tx.participant.findUnique({
          where: { sessionId_userId: { sessionId, userId: user!.id } },
        });
        if (existing) {
          if (existing.status !== "active") throw removed();
          if (!(await this.presence.canSeat(existing, tx))) throw sessionFull();
          const fresh = randomToken(32);
          const updated = await tx.participant.update({
            where: { id: existing.id },
            data: {
              tokenHash: hashToken(fresh),
              tokenExpiresAt: expiresAt,
              lastSeenAt: new Date(),
              nickname,
            },
          });
          return { result: toResult(updated), created: false, token: fresh, expiresAt };
        }
      }

      const seated = await this.presence.seatedCount(sessionId, tx);
      if (seated >= MAX_PARTICIPANTS) throw sessionFull();
      if (asGuest) {
        const taken = await tx.participant.findFirst({
          where: { sessionId, nickname: { equals: nickname, mode: "insensitive" } },
          select: { id: true },
        });
        if (taken) throw new ApiException(409, "NICKNAME_TAKEN", "Nickname is already used");
      }

      const fresh = randomToken(32);
      const created = await tx.participant.create({
        data: {
          sessionId,
          userId: asGuest ? null : user!.id,
          loginType: asGuest ? "guest" : "sso",
          nickname,
          tokenHash: hashToken(fresh),
          tokenExpiresAt: expiresAt,
        },
      });
      return { result: toResult(created), created: true, token: fresh, expiresAt };
    });
  }

  /** GET /participants/me: who this cookie is, and where the session is now. */
  async me(token: string | undefined): Promise<ParticipantMe> {
    if (!token) throw new ApiException(401, "UNAUTHORIZED", "Missing participant token");
    const participant = await this.prisma.participant.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        session: {
          select: {
            status: true,
            deckId: true,
            deck: { select: { title: true } },
            currentSlide: { select: { id: true, position: true } },
          },
        },
      },
    });
    if (!participant) throw new ApiException(401, "UNAUTHORIZED", "Unknown participant token");
    if (participant.tokenExpiresAt <= new Date()) {
      throw new ApiException(401, "TOKEN_EXPIRED", "Participant token has expired");
    }
    if (participant.status !== "active") throw removed();
    const { session } = participant;
    if (session.status === "ended") {
      throw new ApiException(410, "SESSION_ENDED", "Session ended");
    }

    const [slideCount, index] = await Promise.all([
      this.prisma.slide.count({ where: { deckId: session.deckId } }),
      session.currentSlide
        ? this.prisma.slide.count({
            where: { deckId: session.deckId, position: { lt: session.currentSlide.position } },
          })
        : Promise.resolve(0),
    ]);
    return {
      ...toResult(participant),
      title: session.deck.title,
      status: session.status,
      slideCount,
      currentSlide: session.currentSlide ? { id: session.currentSlide.id, index } : null,
    };
  }

  private async findByToken(token: string | undefined, sessionId: string) {
    if (!token) return null;
    const participant = await this.prisma.participant.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        sessionId: true,
        nickname: true,
        status: true,
        tokenExpiresAt: true,
        lastSeenAt: true,
      },
    });
    const valid =
      participant &&
      participant.sessionId === sessionId &&
      participant.status === "active" &&
      participant.tokenExpiresAt > new Date();
    return valid ? participant : null;
  }
}

const sessionFull = () => new ApiException(409, "SESSION_FULL", "Session is full");

const removed = () =>
  new ApiException(403, "PARTICIPANT_REMOVED", "You were removed from this session");
