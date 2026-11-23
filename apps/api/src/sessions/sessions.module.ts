import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { SessionsController } from "./sessions.controller";
import { HistoryService } from "./history.service";
import { LiveService } from "./live.service";
import { CohostController } from "./cohost.controller";
import { CohostService } from "./cohost.service";
import { SessionAccessService } from "./session-access.service";
import { SessionsService } from "./sessions.service";

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [SessionsController, CohostController],
  providers: [SessionsService, LiveService, HistoryService, SessionAccessService, CohostService],
  exports: [SessionsService, SessionAccessService],
})
export class SessionsModule {}
