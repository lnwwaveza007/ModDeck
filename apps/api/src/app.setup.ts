import { INestApplication } from "@nestjs/common";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";

// Shared by main.ts and the e2e tests, so tests run the same wiring as prod.
// Fails if Redis is unreachable: without the adapter, broadcasts would only
// reach sockets on this instance.
export async function setupApp(app: INestApplication): Promise<void> {
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
}
