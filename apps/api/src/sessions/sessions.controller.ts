import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodBody } from "../common/api-error";
import { SessionsService } from "./sessions.service";

const sessionStateSchema = z.object({ status: z.enum(["live", "ended"]) });

@Controller()
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post("decks/:deckId/sessions")
  @UseGuards(AuthGuard)
  create(@CurrentUser() user: AuthUser, @Param("deckId") deckId: string) {
    return this.sessions.create(user.id, deckId);
  }

  @Get("sessions")
  @UseGuards(AuthGuard)
  list(@CurrentUser() user: AuthUser) {
    return this.sessions.list(user.id);
  }

  @Get("sessions/:sessionId")
  @UseGuards(AuthGuard)
  get(@CurrentUser() user: AuthUser, @Param("sessionId") id: string) {
    return this.sessions.get(user.id, id);
  }

  @Patch("sessions/:sessionId")
  @UseGuards(AuthGuard)
  updateState(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") id: string,
    @Body(new ZodBody(sessionStateSchema)) body: z.infer<typeof sessionStateSchema>,
  ) {
    if (body.status === "ended") return this.sessions.requestEnd(user.id, id);
    return this.sessions.undoEnd(user.id, id);
  }
}
