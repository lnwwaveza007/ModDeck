import { Global, Inject, Logger, Module, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

export const REDIS = Symbol("REDIS");

export function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

// One command connection per api instance for live state (seq, event log).
// The Socket.IO adapter opens its own pub/sub pair (RedisIoAdapter).
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const logger = new Logger("Redis");
        const client = new Redis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: true });
        client.on("error", (err: Error) => logger.error(err.message));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    // QUIT on a lazy client that never connected would open a connection first.
    if (this.redis.status === "ready") await this.redis.quit().catch(() => this.redis.disconnect());
    else this.redis.disconnect();
  }
}
