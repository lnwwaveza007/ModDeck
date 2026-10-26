import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { setupApp } from "./app.setup";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await setupApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
