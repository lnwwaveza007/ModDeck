import { Body, Controller, Delete, Get, HttpCode, Param, Patch, UseGuards } from "@nestjs/common";
import {
  renameParticipantBodySchema,
  type ParticipantRow,
  type RenameParticipantBody,
} from "@moddeck/shared";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodBody } from "../common/api-error";
import { HostParticipantsService } from "./host-participants.service";

// The participant list in presenter control (F13). The co-host reads it too; renaming and removing
// is for whoever runs presenter control.
@Controller("sessions/:sessionId/participants")
@UseGuards(AuthGuard)
export class HostParticipantsController {
  constructor(private readonly participants: HostParticipantsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
  ): Promise<ParticipantRow[]> {
    return this.participants.list(user.id, sessionId);
  }

  @Patch(":participantId")
  rename(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Param("participantId") participantId: string,
    @Body(new ZodBody(renameParticipantBodySchema)) body: RenameParticipantBody,
  ): Promise<ParticipantRow> {
    return this.participants.rename(user.id, sessionId, participantId, body.nickname);
  }

  @Delete(":participantId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Param("participantId") participantId: string,
  ): Promise<void> {
    await this.participants.remove(user.id, sessionId, participantId);
  }
}
