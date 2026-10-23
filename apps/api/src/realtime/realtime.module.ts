import { Module } from "@nestjs/common";
import { RealtimeGateway } from "./realtime.gateway";
import { RoomAuthService } from "./room-auth.service";
import { RoomEventsService } from "./room-events.service";

// Feature modules publish live updates with RoomEventsService.publish().
@Module({
  providers: [RealtimeGateway, RoomAuthService, RoomEventsService],
  exports: [RoomEventsService],
})
export class RealtimeModule {}
