import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import {
  questionActionBodySchema,
  type LiveQuestion,
  type QuestionActionBody,
} from "@moddeck/shared";
import { AuthGuard } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { ZodBody } from "../common/api-error";
import { QuestionsService } from "./questions.service";

// Q&A moderation in presenter control (F6). Owner only. The host's list comes with
// GET /sessions/{id}/live and follows the room's question_update events.
@Controller("sessions/:sessionId/questions")
@UseGuards(AuthGuard)
export class HostQuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  // Answer, hide, pin to the projector, or put back to visible.
  @Patch(":questionId/status")
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Param("questionId") questionId: string,
    @Body(new ZodBody(questionActionBodySchema)) body: QuestionActionBody,
  ): Promise<LiveQuestion> {
    return this.questions.setStatus(user.id, sessionId, questionId, body.action);
  }
}
