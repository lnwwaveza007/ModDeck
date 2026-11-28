import { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics/metrics.service";
import { noStore } from "./common/no-store";
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
  app.use(noStore);
  const metrics = app.get(MetricsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const suppliedId = req.header("x-request-id");
    const requestId =
      suppliedId && /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedId) ? suppliedId : randomUUID();
    const sessionId = req.path.match(/\/sessions\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? null;
    const started = process.hrtime.bigint();
    res.setHeader("x-request-id", requestId);
    res.once("finish", () => {
      const status = res.statusCode;
      if (status >= 500) metrics.errors.inc({ source: "http" });
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: status >= 500 ? "error" : "info",
          message: "http_request",
          request_id: requestId,
          session_id: sessionId,
          method: req.method,
          path: req.path,
          status,
          duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
        }),
      );
    });
    next();
  });
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  });
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis();
  app.useWebSocketAdapter(adapter);
}
