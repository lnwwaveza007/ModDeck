import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";

// Prometheus metrics from MD-8 §11. One registry per app instance (not the
// prom-client global), so two instances can run in one process in tests.
//
// Default metrics include CPU, memory and event loop lag
// (nodejs_eventloop_lag_p99_seconds and friends). Messages per second is
// rate(moddeck_ws_messages_received_total[1m]) in PromQL.
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly connections = new Gauge({
    name: "moddeck_ws_connections",
    help: "Open Socket.IO connections on this instance",
    registers: [this.registry],
  });

  readonly messagesReceived = new Counter({
    name: "moddeck_ws_messages_received_total",
    help: "Socket.IO events received from clients",
    labelNames: ["event"],
    registers: [this.registry],
  });

  // Counted per packet written to a socket, so a broadcast to a room of 300
  // counts 300. Includes broadcasts relayed from other instances via Redis.
  readonly packetsSent = new Counter({
    name: "moddeck_ws_packets_sent_total",
    help: "Socket.IO message packets written to client sockets (broadcast fan-out)",
    registers: [this.registry],
  });

  readonly roomEventsPublished = new Counter({
    name: "moddeck_room_events_published_total",
    help: "Sequenced room events published by this instance",
    labelNames: ["type"],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({
      instance_name: process.env.INSTANCE_NAME ?? `api-${process.pid}`,
    });
    collectDefaultMetrics({ register: this.registry, eventLoopMonitoringPrecision: 10 });
  }
}
