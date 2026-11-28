import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly liveParticipants = new Map<string, Map<string, number>>();

  readonly connections = new Gauge({
    name: "moddeck_ws_connections",
    help: "Open Socket.IO connections on this instance",
    registers: [this.registry],
  });
  readonly activeSessions = new Gauge({
    name: "moddeck_active_sessions",
    help: "Sessions with at least one connected participant on this instance",
    registers: [this.registry],
  });
  readonly participants = new Gauge({
    name: "moddeck_connected_participants",
    help: "Distinct participants connected on this instance",
    registers: [this.registry],
  });
  readonly answerRate = new Counter({
    name: "moddeck_answers_accepted_total",
    help: "Accepted poll answers and word submissions",
    labelNames: ["type"],
    registers: [this.registry],
  });
  readonly errors = new Counter({
    name: "moddeck_errors_total",
    help: "API and realtime operation errors",
    labelNames: ["source"],
    registers: [this.registry],
  });
  readonly flushLag = new Gauge({
    name: "moddeck_flush_pending_entries",
    help: "Entries waiting in answer and word flush streams",
    registers: [this.registry],
  });
  readonly messagesReceived = new Counter({
    name: "moddeck_ws_messages_received_total",
    help: "Socket.IO events received from clients",
    labelNames: ["event"],
    registers: [this.registry],
  });
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

  participantConnected(sessionId: string, participantId: string) {
    const participants = this.liveParticipants.get(sessionId) ?? new Map<string, number>();
    participants.set(participantId, (participants.get(participantId) ?? 0) + 1);
    this.liveParticipants.set(sessionId, participants);
    this.refreshPresenceGauges();
  }

  participantDisconnected(sessionId: string, participantId: string) {
    const participants = this.liveParticipants.get(sessionId);
    const count = participants?.get(participantId) ?? 0;
    if (count <= 1) participants?.delete(participantId);
    else participants?.set(participantId, count - 1);
    if (participants?.size === 0) this.liveParticipants.delete(sessionId);
    this.refreshPresenceGauges();
  }

  private refreshPresenceGauges() {
    this.activeSessions.set(this.liveParticipants.size);
    this.participants.set(
      [...this.liveParticipants.values()].reduce((sum, set) => sum + set.size, 0),
    );
  }
}
