import { Controller, Get, Header } from "@nestjs/common";
import { VoteService } from "../events/vote.service";
import {
  redisClients,
  redisCpuSeconds,
  redisOpsPerSec,
  redisUsedMemory,
  registry,
} from "./metrics";

@Controller()
export class MetricsController {
  constructor(private readonly voteService: VoteService) {}

  @Get("metrics")
  @Header("Content-Type", registry.contentType)
  async metrics() {
    try {
      const info = await this.voteService.redisInfo();
      redisUsedMemory.set(Number(info.used_memory ?? 0));
      redisCpuSeconds.set(Number(info.used_cpu_sys ?? 0) + Number(info.used_cpu_user ?? 0));
      redisOpsPerSec.set(Number(info.instantaneous_ops_per_sec ?? 0));
      redisClients.set(Number(info.connected_clients ?? 0));
    } catch {
      // Redis down: still serve process metrics
    }
    return registry.metrics();
  }
}
