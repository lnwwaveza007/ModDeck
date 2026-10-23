import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Same default as docker-compose.yml.
const LOCAL_DATABASE_URL = "postgresql://moddeck:moddeck@localhost:5432/moddeck";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? LOCAL_DATABASE_URL }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
