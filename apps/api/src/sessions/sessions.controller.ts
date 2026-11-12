import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  activityActionBodySchema,
  currentSlideBodySchema,
  wordVisibilityBodySchema,
  type ActivityActionBody,
  type WordVisibilityBody,
} from "@moddeck/shared";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodBody } from "../common/api-error";
import { LiveService } from "./live.service";
import { SessionsService } from "./sessions.service";

// PATCH /sessions/{id} takes one change at a time: end the session, or move to a slide.
const sessionPatchSchema = z.union([
  z.object({ status: z.literal("ended") }).strict(),
  currentSlideBodySchema.strict(),
]);

@Controller()
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly live: LiveService,
  ) {}

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

  // Presenter control and the audience screen start from this, then follow the socket.
  @Get("sessions/:sessionId/live")
  @UseGuards(AuthGuard)
  liveView(@CurrentUser() user: AuthUser, @Param("sessionId") id: string) {
    return this.live.view(user.id, id);
  }

  @Patch("sessions/:sessionId")
  @UseGuards(AuthGuard)
  update(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") id: string,
    @Body(new ZodBody(sessionPatchSchema)) body: z.infer<typeof sessionPatchSchema>,
  ) {
    if ("currentSlideId" in body) return this.live.moveTo(user.id, id, body.currentSlideId);
    return this.sessions.end(user.id, id);
  }

  // Start, stop, show results, reopen (with an optional countdown).
  @Patch("sessions/:sessionId/activities/:activityId")
  @UseGuards(AuthGuard)
  act(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") id: string,
    @Param("activityId") activityId: string,
    @Body(new ZodBody(activityActionBodySchema)) body: ActivityActionBody,
  ) {
    return this.live.act(user.id, id, activityId, body);
  }

  // Hide or show one Word Cloud word (a rude or off-topic one). `wordKey` is the normalized word,
  // URL-encoded: Thai and any other text goes through encodeURIComponent.
  @Patch("sessions/:sessionId/activities/:activityId/words/:wordKey")
  @UseGuards(AuthGuard)
  setWordHidden(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") id: string,
    @Param("activityId") activityId: string,
    @Param("wordKey") wordKey: string,
    @Body(new ZodBody(wordVisibilityBodySchema)) body: WordVisibilityBody,
  ) {
    return this.live.setWordHidden(user.id, id, activityId, wordKey, body.hidden);
  }
}
