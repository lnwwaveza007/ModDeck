import "dotenv/config";
import { defineConfig } from "prisma/config";

// Same default as docker-compose.yml, so the CLI works against the local
// container without a .env file.
const LOCAL_DATABASE_URL = "postgresql://moddeck:moddeck@localhost:5432/moddeck";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL,
  },
});
