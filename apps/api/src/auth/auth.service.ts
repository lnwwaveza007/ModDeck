import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_CONFIG, type AuthConfig } from './auth.config';
import type { AuthUser, EntraIdentity } from './auth.types';
import { randomToken, sha256Hex } from './crypto.util';

const toAuthUser = (u: AuthUser): AuthUser => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  studentId: u.studentId,
});

/**
 * Host login sessions are stored as `participants` rows with session_id = NULL
 * (a host signs in before any live session exists). Room participants always
 * have a session_id, so the two never overlap.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthConfig,
  ) {}

  /** Create the user on first login, refresh name/email (and student ID if present) after. */
  async upsertUser(identity: EntraIdentity): Promise<AuthUser> {
    const user = await this.prisma.user.upsert({
      where: { ssoSubject: identity.subject },
      create: {
        ssoSubject: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
        studentId: identity.studentId,
      },
      update: {
        email: identity.email,
        displayName: identity.displayName,
        ...(identity.studentId ? { studentId: identity.studentId } : {}),
      },
    });
    return toAuthUser(user);
  }

  /** Random token goes in the cookie; only its SHA-256 hash is stored. */
  async createSession(user: AuthUser): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.cfg.sessionTtlMs);
    await this.prisma.participant.create({
      data: {
        sessionId: null,
        userId: user.id,
        loginType: 'sso',
        nickname: user.displayName,
        tokenHash: sha256Hex(token),
        tokenExpiresAt: expiresAt,
      },
    });
    // Opportunistic cleanup of expired host logins (never touches room participants).
    await this.prisma.participant.deleteMany({
      where: { sessionId: null, tokenExpiresAt: { lt: new Date() } },
    });
    return { token, expiresAt };
  }

  /**
   * Returns the user for a valid host login, or null. Slides the expiry forward
   * when less than half the lifetime is left; `renewedExpiresAt` tells the
   * caller to refresh the cookie.
   */
  async authenticate(
    token: string,
  ): Promise<{ user: AuthUser; renewedExpiresAt?: Date } | null> {
    const row = await this.prisma.participant.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    // Must be a host login: no room, linked user, still active.
    if (!row || row.sessionId !== null || !row.user || row.status !== 'active') {
      return null;
    }

    const now = Date.now();
    if (row.tokenExpiresAt.getTime() <= now) {
      await this.prisma.participant.deleteMany({ where: { id: row.id } });
      return null;
    }

    let renewedExpiresAt: Date | undefined;
    if (row.tokenExpiresAt.getTime() - now < this.cfg.sessionTtlMs / 2) {
      renewedExpiresAt = new Date(now + this.cfg.sessionTtlMs);
      await this.prisma.participant.update({
        where: { id: row.id },
        data: { tokenExpiresAt: renewedExpiresAt, lastSeenAt: new Date() },
      });
    }
    return { user: toAuthUser(row.user), renewedExpiresAt };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.participant.deleteMany({
      where: { tokenHash: sha256Hex(token), sessionId: null },
    });
  }
}
