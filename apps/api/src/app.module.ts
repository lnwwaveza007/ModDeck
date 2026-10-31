import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { MetricsModule } from "./metrics/metrics.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { RedisModule } from "./redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { DecksModule } from "./decks/decks.module";
import { SlidesModule } from "./slides/slides.module";

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    MetricsModule,
    RealtimeModule,
    AuthModule,
    DecksModule,
    SlidesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
