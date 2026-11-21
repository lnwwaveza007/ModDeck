import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SessionsModule } from "../sessions/sessions.module";
import { ParticipantsController } from "./participants.controller";
import { ParticipantsService } from "./participants.service";
import { PinLimiterService } from "./pin-limiter.service";
import { QuestionsService } from "./questions.service";

@Module({
  imports: [AuthModule, RealtimeModule, SessionsModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService, PinLimiterService, QuestionsService],
})
export class ParticipantsModule {}
