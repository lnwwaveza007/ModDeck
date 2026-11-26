// Local runs read apps/api/.env (same as prisma.config.ts); Docker passes env vars.
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { setupApp } from "./app.setup";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await setupApp(app);
  // Only the signals that ask for a stop. With no list, Nest also traps crash signals such as
  // SIGSEGV and SIGABRT, shuts down cleanly and exits with code 0, which hides the crash.
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
