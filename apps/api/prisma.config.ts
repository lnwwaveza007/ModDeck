import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Repo-root .env is shared with docker-compose.
config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` runs without a database (Docker build), so fall back to the compose default.
    url: process.env.DATABASE_URL ?? "postgresql://moddeck:moddeck@localhost:5432/moddeck",
  },
});
