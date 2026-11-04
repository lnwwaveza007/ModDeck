import { INestApplication } from "@nestjs/common";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";

// Shared by main.ts and the e2e tests, so tests run the same wiring as prod.
// Fails if Redis is unreachable: without the adapter, broadcasts would only
// reach sockets on this instance.
export async function setupApp(app: INestApplication): Promise<void> {
  // nginx (production) and the Next rewrite (dev) sit on private addresses.
  // Trust their X-Forwarded-For, so req.ip is the student's address for the
  // wrong-PIN limit.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: string): void }).set(
    "trust proxy",
    "loopback, linklocal, uniquelocal",
  );
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
}
