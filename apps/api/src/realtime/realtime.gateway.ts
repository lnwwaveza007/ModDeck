import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  PRESENCE_HEARTBEAT_MS,
  joinPayloadSchema,
  type ErrorBody,
  type JoinAck,
} from "@moddeck/shared";
import { MetricsService } from "../metrics/metrics.service";
import { hostTokenFromHandshake, tokenFromHandshake, wantsHostRole } from "./participant-token";
import { PresenceService } from "./presence.service";
import { RoomAuthError, RoomAuthService } from "./room-auth.service";
import { RoomEventsService, roomName } from "./room-events.service";
import type { RealtimeServer, RealtimeSocket, SocketData } from "./realtime.types";

interface EnginePacketSource {
  on(event: "packetCreate", cb: (packet: { type: string }) => void): void;
}

// The live channel: one namespace, one room per session (technical design §3.4).
@WebSocketGateway({
  cors: { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: RealtimeServer;

  constructor(
    private readonly auth: RoomAuthService,
    private readonly roomEvents: RoomEventsService,
    private readonly metrics: MetricsService,
    private readonly presence: PresenceService,
  ) {}

  // One heartbeat timer per connected socket.
  private readonly heartbeats = new Map<string, NodeJS.Timeout>();

  afterInit(server: RealtimeServer) {
    this.roomEvents.attach(server);

    // Handshake: a socket without a valid participant token (or, when it asks
    // for the host role, a valid host login) never connects. The rejection
    // reaches the client as connect_error with `data.code`.
    server.use((socket, next) => {
      const { handshake } = socket;
      const identity = wantsHostRole(handshake)
        ? this.auth.authenticateHost(hostTokenFromHandshake(handshake))
        : this.auth.authenticate(tokenFromHandshake(handshake));
      identity
        .then((identity) => {
          socket.data.identity = identity;
          next();
        })
        .catch((err: unknown) => {
          const error = toErrorBody(err);
          if (error.code === "INTERNAL") this.logger.error(`Handshake failed: ${String(err)}`);
          next(Object.assign(new Error(error.message), { data: error }));
        });
    });

    // Count every message packet written to a client, including broadcasts
    // that arrive from other instances through the Redis adapter.
    server.engine.on("connection", (rawSocket: EnginePacketSource) => {
      rawSocket.on("packetCreate", (packet) => {
        if (packet.type === "message") this.metrics.packetsSent.inc();
      });
    });
  }

  handleConnection(client: RealtimeSocket) {
    this.metrics.connections.inc();
    client.onAny((event: string) => this.metrics.messagesReceived.inc({ event }));

    // Presence: the seat hold of 15 min counts from the last time we saw the socket.
    // A host holds no seat.
    const { identity } = client.data;
    if (identity.role !== "participant") return;
    const { participantId } = identity;
    this.touch(participantId);
    this.heartbeats.set(
      client.id,
      setInterval(() => this.touch(participantId), PRESENCE_HEARTBEAT_MS).unref(),
    );
  }

  handleDisconnect(client: RealtimeSocket) {
    this.metrics.connections.dec();
    clearInterval(this.heartbeats.get(client.id));
    this.heartbeats.delete(client.id);
    // A socket that failed the handshake has no identity.
    const identity = client.data.identity as SocketData["identity"] | undefined;
    if (identity?.role === "participant") this.touch(identity.participantId);
  }

  // A failed write only makes the hold start a little early, so it is logged, not thrown.
  private touch(participantId: string) {
    this.presence.touch(participantId).catch((err: unknown) => {
      this.logger.warn(`Presence update failed: ${String(err)}`);
    });
  }

  // First message after every (re)connect. Joins the room of the socket's own
  // session (a host: of a session they own) and returns the state to continue
  // from (MD-13).
  @SubscribeMessage("join")
  async handleJoin(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<JoinAck> {
    const { identity } = client.data;

    const parsed = joinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return this.reject(client, null, {
        code: "INVALID_PAYLOAD",
        message: "join needs { sessionId: uuid, lastSeq?: integer >= 0 }",
      });
    }
    const { sessionId } = parsed.data;
    if (identity.role === "participant" && sessionId !== identity.sessionId) {
      return this.reject(client, identity.sessionId, {
        code: "ROOM_FORBIDDEN",
        message: "The participant token does not belong to this session",
      });
    }
    if (identity.role === "host") {
      try {
        await this.auth.assertHostCanJoin(identity.userId, sessionId);
      } catch (err) {
        if (!(err instanceof RoomAuthError)) throw err;
        // Another host's session: its seq is none of this socket's business.
        return this.reject(client, null, toErrorBody(err));
      }
    }

    await client.join(roomName(sessionId));
    const state = await this.roomEvents.sync(sessionId, parsed.data.lastSeq);
    client.emit("state", state);
    return { ok: true, ...state };
  }

  private async reject(
    client: RealtimeSocket,
    sessionId: string | null,
    error: ErrorBody,
  ): Promise<JoinAck> {
    const own = client.data.identity.role === "participant" ? client.data.identity.sessionId : null;
    const seq = await this.roomEvents.currentSeq(sessionId ?? own ?? "");
    client.emit("error", { ...error, seq });
    return { ok: false, error };
  }
}

function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof RoomAuthError) return { code: err.code, message: err.message };
  return { code: "INTERNAL", message: "Could not check the participant token" };
}
