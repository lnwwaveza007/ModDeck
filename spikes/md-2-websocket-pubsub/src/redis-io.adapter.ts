import { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server, ServerOptions } from "socket.io";

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string = process.env.REDIS_URL ?? "redis://localhost:6379",
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
    });
    const subClient = pubClient.duplicate();

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        pubClient.once("ready", () => resolve());
        pubClient.once("error", (err) => reject(err));
      }),
      new Promise<void>((resolve, reject) => {
        subClient.once("ready", () => resolve());
        subClient.once("error", (err) => reject(err));
      }),
    ]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    console.log(`[RedisIoAdapter] Connected to Redis Pub/Sub at ${this.redisUrl}`);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
