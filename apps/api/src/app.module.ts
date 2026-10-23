import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [PrismaModule, RedisModule, MetricsModule, RealtimeModule],
  controllers: [HealthController],
})
export class AppModule {}
