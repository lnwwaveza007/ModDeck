import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class VoteService implements OnModuleInit, OnModuleDestroy {
  private redisClient!: Redis;

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.redisClient.on("error", (err) => {
      console.error("[VoteService] Redis error:", err.message);
    });
  }

  onModuleDestroy() {
    this.redisClient?.disconnect();
  }

  private getVotesKey(pin: string): string {
    return `moddeck:room:${pin}:votes`;
  }

  async recordVote(pin: string, option: string): Promise<Record<string, number>> {
    const key = this.getVotesKey(pin);
    // Atomic increment inside Redis Hash
    await this.redisClient.hincrby(key, option, 1);
    return this.getVotes(pin);
  }

  async getVotes(pin: string): Promise<Record<string, number>> {
    const key = this.getVotesKey(pin);
    const rawVotes = await this.redisClient.hgetall(key);
    const parsed: Record<string, number> = {};
    for (const [option, count] of Object.entries(rawVotes)) {
      parsed[option] = parseInt(count, 10) || 0;
    }
    return parsed;
  }

  async resetVotes(pin: string): Promise<void> {
    const key = this.getVotesKey(pin);
    await this.redisClient.del(key);
  }
}
