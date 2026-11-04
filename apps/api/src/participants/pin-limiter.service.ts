import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS } from "../redis/redis.module";

// Wrong-PIN limits (MD-5 §6.4, technical design §3.6 "Rate limits"). A whole
// lecture hall shares one campus IP, so the tight limit is per device and the
// IP limit only stops scripts.
export const DEVICE_LIMIT = 5;
export const IP_LIMIT = 200;
export const WINDOW_SECONDS = 60;

const deviceKey = (device: string) => `pin-fail:dev:${device}`;
const ipKey = (ip: string) => `pin-fail:ip:${ip}`;

@Injectable()
export class PinLimiterService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Seconds to wait when this device or IP is over its limit, else null. */
  async retryAfter(device: string | undefined, ip: string): Promise<number | null> {
    const checks: [string, number][] = [[ipKey(ip), IP_LIMIT]];
    if (device) checks.push([deviceKey(device), DEVICE_LIMIT]);
    const counts = await this.redis.mget(checks.map(([key]) => key));
    let wait: number | null = null;
    for (const [i, [key, limit]] of checks.entries()) {
      if (Number(counts[i] ?? 0) < limit) continue;
      const ttl = await this.redis.ttl(key);
      wait = Math.max(wait ?? 1, ttl > 0 ? ttl : WINDOW_SECONDS);
    }
    return wait;
  }

  /** Counts one wrong PIN. The window starts at the first miss. */
  async recordMiss(device: string | undefined, ip: string): Promise<void> {
    const multi = this.redis.multi();
    for (const key of device ? [ipKey(ip), deviceKey(device)] : [ipKey(ip)]) {
      multi.incr(key).expire(key, WINDOW_SECONDS, "NX");
    }
    await multi.exec();
  }
}
