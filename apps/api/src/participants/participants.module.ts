import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SessionsModule } from "../sessions/sessions.module";
import { ParticipantsController } from "./participants.controller";
import { ParticipantsService } from "./participants.service";
import { PinLimiterService } from "./pin-limiter.service";

@Module({
  imports: [AuthModule, SessionsModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService, PinLimiterService],
})
export class ParticipantsModule {}
