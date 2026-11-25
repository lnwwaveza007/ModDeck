import { Inject, Injectable, Logger } from "@nestjs/common";
import { USER_SEARCH_LIMIT, type UserSummary } from "@moddeck/shared";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { AUTH_CONFIG, type AuthConfig, isAdminEmail } from "./auth.config";
import type { AuthUser, EntraIdentity } from "./auth.types";
import { randomToken, sha256Hex } from "./crypto.util";

const toAuthUser = (u: AuthUser): AuthUser => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  studentId: u.studentId,
});

const toSummary = (u: UserSummary): UserSummary => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
});

export interface AuthResult {
  /** Who the request acts as: the impersonated user while an admin impersonates. */
  user: AuthUser;
  /** The admin who signed in, only while impersonating. */
  impersonator?: AuthUser;
  renewedExpiresAt?: Date;
}

/**
 * Host logins live in `host_sessions`, separate from room participants: a host
 * signs in before any live session exists.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

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
    await this.prisma.hostSession.create({
      data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt },
    });
    // Opportunistic cleanup of expired host logins.
    await this.prisma.hostSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { token, expiresAt };
  }

  /**
   * Returns the user for a valid host login, or null. Slides the expiry forward
   * when less than half the lifetime is left; `renewedExpiresAt` tells the
   * caller to refresh the cookie.
   */
  async authenticate(token: string): Promise<AuthResult | null> {
    const row = await this.prisma.hostSession.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true, impersonatedUser: true },
    });
    if (!row) return null;

    const now = Date.now();
    if (row.expiresAt.getTime() <= now) {
      await this.prisma.hostSession.deleteMany({ where: { id: row.id } });
      return null;
    }

    let renewedExpiresAt: Date | undefined;
    if (row.expiresAt.getTime() - now < this.cfg.sessionTtlMs / 2) {
      renewedExpiresAt = new Date(now + this.cfg.sessionTtlMs);
      await this.prisma.hostSession.update({
        where: { id: row.id },
        data: { expiresAt: renewedExpiresAt, lastSeenAt: new Date(now) },
      });
    }

    const signedIn = toAuthUser(row.user);
    if (row.impersonatedUserId) {
      // The list is checked on every request: an admin taken off ADMIN_EMAILS stops at once.
      if (row.impersonatedUser && isAdminEmail(this.cfg, signedIn.email)) {
        return { user: toAuthUser(row.impersonatedUser), impersonator: signedIn, renewedExpiresAt };
      }
      await this.prisma.hostSession.update({
        where: { id: row.id },
        data: { impersonatedUserId: null },
      });
    }
    return { user: signedIn, renewedExpiresAt };
  }

  isAdmin(user: Pick<AuthUser, "email">): boolean {
    return isAdminEmail(this.cfg, user.email);
  }

  /** Admin user picker: email or name contains `query`, case-insensitive. */
  async searchUsers(query: string): Promise<UserSummary[]> {
    const q = query.trim();
    const users = await this.prisma.user.findMany({
      where: q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ displayName: "asc" }, { email: "asc" }],
      take: USER_SEARCH_LIMIT,
      select: { id: true, email: true, displayName: true },
    });
    return users.map(toSummary);
  }

  /**
   * The login of `token` acts as `targetId` from the next request on. The caller checks that
   * `admin` (the signed-in account, not who it impersonates now) is an admin.
   */
  async startImpersonation(token: string, admin: AuthUser, targetId: string): Promise<AuthUser> {
    if (targetId === admin.id) {
      throw new ApiException(422, "INVALID_PAYLOAD", "You cannot impersonate yourself");
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new ApiException(404, "NOT_FOUND", "User not found");

    const { count } = await this.prisma.hostSession.updateMany({
      where: { tokenHash: sha256Hex(token), userId: admin.id },
      data: { impersonatedUserId: target.id },
    });
    if (count === 0) throw new ApiException(401, "UNAUTHORIZED", "Host login has expired");

    this.log.warn(`Admin ${admin.email} (${admin.id}) impersonates ${target.email} (${target.id})`);
    return toAuthUser(target);
  }

  /** Back to the admin's own account. A no-op when the login does not impersonate. */
  async stopImpersonation(token: string): Promise<void> {
    const row = await this.prisma.hostSession.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (!row?.impersonatedUserId) return;
    await this.prisma.hostSession.update({
      where: { id: row.id },
      data: { impersonatedUserId: null },
    });
    this.log.warn(
      `Admin ${row.user.email} (${row.userId}) stops impersonating ${row.impersonatedUserId}`,
    );
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.hostSession.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
}
