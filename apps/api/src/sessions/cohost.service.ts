import { Injectable } from "@nestjs/common";
import type {
  CohostAccepted,
  CohostAcceptBody,
  CohostInviteCreated,
  ControlChange,
  PendingCohostInvite,
  SessionControlState,
  SessionControlView,
} from "@moddeck/shared";
import { randomBytes } from "node:crypto";
import type { AuthUser } from "../auth/auth.types";
import { ApiException } from "../common/api-error";
import type { AuditAction, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ParticipantChannelService } from "../realtime/participant-channel.service";
import { hashToken } from "../realtime/participant-token";
import { appUrl } from "./join-url";
import { SessionAccessService } from "./session-access.service";

/** An invite lasts as long as a login (8 h), and never past the end of its session. */
const INVITE_TTL_MS = 8 * 60 * 60 * 1000;

const inviteInvalid = () =>
  new ApiException(404, "INVITE_INVALID", "This co-host invite is used, cancelled or expired");
const sessionEnded = () => new ApiException(409, "SESSION_ENDED", "The session has ended");

type Tx = Prisma.TransactionClient;

/**
 * The co-host of a session (F12, MD-5 §2.5): one TA per session, invited by KMUTT email or by a
 * one-time link. The co-host moderates Q&A and sees the participant list on their own device, and
 * can take over presenter control when the owner's laptop fails; the owner can take it back.
 * Each invite, accept, removal and change of control is written to the session's audit log, and
 * told to the host room so the other screen can say so.
 */
@Injectable()
export class CohostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SessionAccessService,
    private readonly channel: ParticipantChannelService,
  ) {}

  async view(userId: string, sessionId: string): Promise<SessionControlView> {
    const { role } = await this.access.check(userId, sessionId, "member");
    return { ...(await this.state(sessionId)), viewerId: userId, role };
  }

  /**
   * A new invite replaces the one that waits, so its old link stops working. With an email only
   * that KMUTT account can accept; without one, the first KMUTT login to open the link does.
   */
  async invite(
    owner: AuthUser,
    sessionId: string,
    email: string | undefined,
  ): Promise<CohostInviteCreated> {
    const session = await this.openSession(owner.id, sessionId, "owner");
    if (email && email === owner.email.toLowerCase()) {
      throw new ApiException(422, "INVALID_PAYLOAD", "You cannot invite yourself", {
        field: "email",
      });
    }
    const token = randomBytes(32).toString("base64url");
    const invite = await this.prisma.$transaction(async (tx) => {
      if (await tx.sessionCohost.findUnique({ where: { sessionId }, select: { userId: true } })) {
        throw new ApiException(409, "COHOST_EXISTS", "This session already has a co-host");
      }
      await tx.cohostInvite.deleteMany({ where: { sessionId } });
      const created = await tx.cohostInvite.create({
        data: {
          sessionId,
          email: email ?? null,
          tokenHash: hashToken(token),
          invitedBy: owner.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
        select: { id: true, email: true, expiresAt: true },
      });
      await this.audit(tx, session.id, owner.id, "cohost_invited", {
        inviteId: created.id,
        by: email ? "email" : "link",
        ...(email && { email }),
      });
      return created;
    });
    await this.announce(sessionId, "invited");
    return {
      invite: { ...invite, expiresAt: invite.expiresAt.toISOString() },
      url: appUrl(`/cohost/${token}`),
    };
  }

  async cancelInvite(ownerId: string, sessionId: string): Promise<void> {
    await this.access.check(ownerId, sessionId, "owner");
    const invite = await this.prisma.cohostInvite.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (!invite) return;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.cohostInvite.deleteMany({ where: { id: invite.id } });
      if (count) await this.audit(tx, sessionId, ownerId, "cohost_invite_cancelled", invite);
    });
    await this.announce(sessionId, "invite_cancelled");
  }

  /** Invites by email to the logged-in user, for sessions that are still open. */
  async pendingFor(user: AuthUser): Promise<PendingCohostInvite[]> {
    const invites = await this.prisma.cohostInvite.findMany({
      where: {
        email: user.email.toLowerCase(),
        expiresAt: { gt: new Date() },
        session: { endedAt: null, cohost: { is: null } },
      },
      select: {
        id: true,
        sessionId: true,
        expiresAt: true,
        session: { select: { deck: { select: { title: true } }, owner: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return invites.map((invite) => ({
      id: invite.id,
      sessionId: invite.sessionId,
      deckTitle: invite.session.deck.title,
      ownerName: invite.session.owner.displayName,
      expiresAt: invite.expiresAt.toISOString(),
    }));
  }

  /** Uses the invite: the user becomes the session's co-host, and the invite is gone. */
  async accept(user: AuthUser, body: CohostAcceptBody): Promise<CohostAccepted> {
    const invite = await this.prisma.cohostInvite.findFirst({
      where: "token" in body ? { tokenHash: hashToken(body.token) } : { id: body.inviteId },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        sessionId: true,
        session: {
          select: { ownerId: true, endedAt: true, cohost: { select: { userId: true } } },
        },
      },
    });
    // An invite by email is found by its id only from the invited account's own list.
    if (!invite || ("inviteId" in body && !invite.email)) throw inviteInvalid();
    const { session, sessionId } = invite;
    if (session.endedAt) throw sessionEnded();
    if (invite.expiresAt <= new Date()) throw inviteInvalid();
    if (session.ownerId === user.id) {
      throw new ApiException(403, "INVITE_WRONG_ACCOUNT", "The owner cannot be their own co-host");
    }
    if (invite.email && invite.email !== user.email.toLowerCase()) {
      throw new ApiException(403, "INVITE_WRONG_ACCOUNT", "This invite is for another account", {
        email: invite.email,
      });
    }
    if (session.cohost) {
      throw new ApiException(409, "COHOST_EXISTS", "This session already has a co-host");
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Two people opening one link at once: only the first one gets it.
        const { count } = await tx.cohostInvite.deleteMany({ where: { id: invite.id } });
        if (count === 0) throw inviteInvalid();
        await tx.sessionCohost.create({ data: { sessionId, userId: user.id } });
        await this.audit(tx, sessionId, user.id, "cohost_accepted", { inviteId: invite.id });
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ApiException(409, "COHOST_EXISTS", "This session already has a co-host");
      }
      throw error;
    }
    await this.announce(sessionId, "accepted");
    return { sessionId };
  }

  /** The owner removes the co-host. Presenter control comes back to the owner if they had it. */
  async remove(ownerId: string, sessionId: string): Promise<void> {
    await this.access.check(ownerId, sessionId, "owner");
    const removed = await this.prisma.$transaction(async (tx) => {
      const cohost = await tx.sessionCohost.findUnique({
        where: { sessionId },
        select: { userId: true },
      });
      if (!cohost) return null;
      await tx.sessionCohost.delete({ where: { sessionId } });
      await tx.session.updateMany({
        where: { id: sessionId, controllerId: cohost.userId },
        data: { controllerId: null },
      });
      await this.audit(tx, sessionId, ownerId, "cohost_removed", { userId: cohost.userId });
      return cohost.userId;
    });
    if (!removed) return;
    await this.announce(sessionId, "removed");
    await this.channel.kickHost(sessionId, removed);
  }

  /**
   * The caller takes presenter control: a co-host takes over, the owner takes it back. Nothing
   * changes (and nothing is logged) when the caller already has it.
   */
  async takeControl(userId: string, sessionId: string): Promise<SessionControlView> {
    const session = await this.openSession(userId, sessionId, "member");
    if (session.controllerId !== userId) {
      const takeback = session.role === "owner";
      await this.prisma.$transaction(async (tx) => {
        await tx.session.update({
          where: { id: sessionId },
          data: { controllerId: takeback ? null : userId },
          select: { id: true },
        });
        await this.audit(tx, sessionId, userId, takeback ? "takeback" : "takeover", {
          from: session.controllerId,
        });
      });
      await this.announce(sessionId, takeback ? "takeback" : "takeover");
    }
    return this.view(userId, sessionId);
  }

  private async openSession(
    userId: string,
    sessionId: string,
    need: "member" | "owner",
  ): Promise<Awaited<ReturnType<SessionAccessService["check"]>>> {
    const session = await this.access.check(userId, sessionId, need);
    if (session.status === "ended") throw sessionEnded();
    return session;
  }

  private async state(sessionId: string): Promise<SessionControlState> {
    const session = await this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        ownerId: true,
        controllerId: true,
        owner: { select: { id: true, displayName: true } },
        cohost: { select: { user: { select: { id: true, displayName: true, email: true } } } },
        cohostInvite: { select: { id: true, email: true, expiresAt: true } },
      },
    });
    const cohost = session.cohost?.user;
    const invite = session.cohostInvite;
    return {
      owner: { userId: session.owner.id, displayName: session.owner.displayName },
      cohost: cohost
        ? { userId: cohost.id, displayName: cohost.displayName, email: cohost.email }
        : null,
      invite:
        invite && invite.expiresAt > new Date()
          ? { id: invite.id, email: invite.email, expiresAt: invite.expiresAt.toISOString() }
          : null,
      controllerId: session.controllerId ?? session.ownerId,
    };
  }

  /** To the owner's and the co-host's screens. A lost one is fixed by the load after reconnect. */
  private async announce(sessionId: string, change: ControlChange) {
    this.channel.toHosts(sessionId, "control_update", { ...(await this.state(sessionId)), change });
  }

  private audit(
    tx: Tx,
    sessionId: string,
    actorId: string,
    action: AuditAction,
    details: Prisma.InputJsonObject,
  ) {
    return tx.sessionAuditLog.create({
      data: { sessionId, actorId, action, details },
      select: { id: true },
    });
  }
}
