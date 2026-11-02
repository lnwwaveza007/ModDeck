import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
