import { Module } from "@nestjs/common";
import { EventsGateway } from "./events.gateway";
import { VoteService } from "./vote.service";

@Module({
  providers: [EventsGateway, VoteService],
  exports: [EventsGateway, VoteService],
})
export class EventsModule {}
