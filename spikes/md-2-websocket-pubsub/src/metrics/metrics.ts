import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

// One registry for the whole process. Default metrics cover CPU
// (process_cpu_seconds_total), memory (process_resident_memory_bytes,
// nodejs_heap_*) and event loop lag (nodejs_eventloop_lag_*_seconds).
export const registry = new Registry();
registry.setDefaultLabels({ instance_name: process.env.INSTANCE_NAME ?? `api-${process.pid}` });
collectDefaultMetrics({ register: registry, eventLoopMonitoringPrecision: 10 });

export const wsConnections = new Gauge({
  name: "moddeck_ws_connections",
  help: "Open Socket.IO connections on this instance",
  registers: [registry],
});

export const wsMessagesReceived = new Counter({
  name: "moddeck_ws_messages_received_total",
  help: "Socket.IO events received from clients",
  labelNames: ["event"],
  registers: [registry],
});

// Counted per Engine.IO packet written to a socket, so a broadcast to a room of
// 300 counts 300. Includes broadcasts relayed from other instances via Redis.
export const wsPacketsSent = new Counter({
  name: "moddeck_ws_packets_sent_total",
  help: "Socket.IO message packets written to client sockets (broadcast fan-out)",
  registers: [registry],
});

export const wsHandlerDuration = new Histogram({
  name: "moddeck_ws_handler_duration_seconds",
  help: "Time spent in a gateway handler, including Redis round trips",
  labelNames: ["event"],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

// Redis server stats, read from INFO on each scrape (set by RedisInfoCollector).
export const redisUsedMemory = new Gauge({
  name: "moddeck_redis_used_memory_bytes",
  help: "Redis used_memory from INFO",
  registers: [registry],
});
export const redisCpuSeconds = new Gauge({
  name: "moddeck_redis_cpu_seconds_total",
  help: "Redis used_cpu_sys + used_cpu_user from INFO (use rate())",
  registers: [registry],
});
export const redisOpsPerSec = new Gauge({
  name: "moddeck_redis_instantaneous_ops_per_sec",
  help: "Redis instantaneous_ops_per_sec from INFO",
  registers: [registry],
});
export const redisClients = new Gauge({
  name: "moddeck_redis_connected_clients",
  help: "Redis connected_clients from INFO",
  registers: [registry],
});
