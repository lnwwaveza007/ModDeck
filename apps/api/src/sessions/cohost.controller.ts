import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import {
  cohostAcceptBodySchema,
  cohostInviteBodySchema,
  type CohostAccepted,
  type CohostAcceptBody,
  type CohostInviteBody,
  type CohostInviteCreated,
  type PendingCohostInvite,
  type SessionControlView,
} from "@moddeck/shared";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodBody } from "../common/api-error";
import { CohostService } from "./cohost.service";

// Co-host and presenter control (F12). Every route needs the KMUTT login; the service checks the
// role in the session (owner, co-host). Participants have no role, so they get 404.
@Controller()
@UseGuards(AuthGuard)
export class CohostController {
  constructor(private readonly cohosts: CohostService) {}

  // Who owns, who co-hosts, the invite that waits, and who runs presenter control.
  @Get("sessions/:sessionId/control")
  control(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
  ): Promise<SessionControlView> {
    return this.cohosts.view(user.id, sessionId);
  }

  // Owner. 409 COHOST_EXISTS once the session has its one co-host.
  @Post("sessions/:sessionId/cohost-invites")
  invite(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Body(new ZodBody(cohostInviteBodySchema)) body: CohostInviteBody,
  ): Promise<CohostInviteCreated> {
    return this.cohosts.invite(user, sessionId, body.email);
  }

  // Owner. Cancels the invite that waits: its link stops working.
  @Delete("sessions/:sessionId/cohost-invites")
  @HttpCode(204)
  async cancelInvite(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) {
    await this.cohosts.cancelInvite(user.id, sessionId);
  }

  // Owner. The co-host's screens close.
  @Delete("sessions/:sessionId/cohost")
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param("sessionId") sessionId: string) {
    await this.cohosts.remove(user.id, sessionId);
  }

  // The caller takes presenter control: the co-host takes over, the owner takes back.
  @Post("sessions/:sessionId/takeovers")
  @HttpCode(200)
  takeover(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
  ): Promise<SessionControlView> {
    return this.cohosts.takeControl(user.id, sessionId);
  }

  @Get("cohost-invites")
  pending(@CurrentUser() user: AuthUser): Promise<PendingCohostInvite[]> {
    return this.cohosts.pendingFor(user);
  }

  @Post("cohost-invites/accept")
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthUser,
    @Body(new ZodBody(cohostAcceptBodySchema)) body: CohostAcceptBody,
  ): Promise<CohostAccepted> {
    return this.cohosts.accept(user, body);
  }
}
