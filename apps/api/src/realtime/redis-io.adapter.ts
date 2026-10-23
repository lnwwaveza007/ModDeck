import { INestApplicationContext, Logger } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { Server, ServerOptions } from "socket.io";
import { redisUrl } from "../redis/redis.module";

const logger = new Logger("RedisIoAdapter");

// Socket.IO adapter that relays room broadcasts between api instances through
// Redis Pub/Sub (MD-2). With it, io.to(room).emit() reaches the sockets of
// that room on every instance.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly url: string = redisUrl(),
  ) {
    super(app);
  }

  // Resolves when both connections are ready; rejects if Redis is unreachable.
  async connectToRedis(): Promise<void> {
    const pubClient = new Redis(this.url, { maxRetriesPerRequest: null, lazyConnect: true });
    const subClient = pubClient.duplicate();
    this.clients = [pubClient, subClient];
    for (const client of this.clients) {
      client.on("error", (err: Error) => logger.error(err.message));
    }
    await Promise.all(this.clients.map((client) => client.connect()));
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await Promise.all(this.clients.map((client) => client.quit().catch(() => client.disconnect())));
    this.clients = [];
  }
}
