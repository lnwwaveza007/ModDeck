import { Module } from "@nestjs/common";
import { EventsModule } from "./events/events.module";
import { ClientController } from "./client.controller";
import { MetricsController } from "./metrics/metrics.controller";

@Module({
  imports: [EventsModule],
  controllers: [ClientController, MetricsController],
})
export class AppModule {}
