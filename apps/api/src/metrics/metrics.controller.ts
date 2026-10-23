import { Controller, Get, Header } from "@nestjs/common";
import { Registry } from "prom-client";
import { MetricsService } from "./metrics.service";

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @Header("Content-Type", Registry.PROMETHEUS_CONTENT_TYPE)
  scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
