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

  async incrementVote(pin: string, option: string): Promise<void> {
    await this.redisClient.hincrby(this.getVotesKey(pin), option, 1);
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

  // Q&A message: keep the last 200 per room, expire with the room.
  async recordQuestion(pin: string, question: string): Promise<void> {
    const key = `moddeck:room:${pin}:questions`;
    await this.redisClient
      .multi()
      .rpush(key, question)
      .ltrim(key, -200, -1)
      .expire(key, 86400)
      .exec();
  }

  async redisInfo(): Promise<Record<string, string>> {
    const raw = await this.redisClient.info();
    const out: Record<string, string> = {};
    for (const line of raw.split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
    }
    return out;
  }
}
