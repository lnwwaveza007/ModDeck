import { Module } from "@nestjs/common";
import { AnswerLedgerService } from "./answer-ledger.service";
import { PresenceService } from "./presence.service";
import { RealtimeGateway } from "./realtime.gateway";
import { RoomAuthService } from "./room-auth.service";
import { RoomEventsService } from "./room-events.service";

// Feature modules publish live updates with RoomEventsService.publish().
@Module({
  providers: [
    RealtimeGateway,
    RoomAuthService,
    RoomEventsService,
    PresenceService,
    AnswerLedgerService,
  ],
  exports: [RoomEventsService, PresenceService, AnswerLedgerService],
})
export class RealtimeModule {}
