import { Module } from "@nestjs/common";
import { EventsModule } from "./events/events.module";
import { ClientController } from "./client.controller";

@Module({
  imports: [EventsModule],
  controllers: [ClientController],
})
export class AppModule {}
