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
import { joinPayloadSchema, type ErrorBody, type JoinAck } from "@moddeck/shared";
import { MetricsService } from "../metrics/metrics.service";
import { tokenFromHandshake } from "./participant-token";
import { RoomAuthError, RoomAuthService } from "./room-auth.service";
import { RoomEventsService, roomName } from "./room-events.service";
import type { RealtimeServer, RealtimeSocket } from "./realtime.types";

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
  ) {}

  afterInit(server: RealtimeServer) {
    this.roomEvents.attach(server);

    // Handshake: a socket without a valid participant token never connects.
    // The rejection reaches the client as connect_error with `data.code`.
    server.use((socket, next) => {
      this.auth
        .authenticate(tokenFromHandshake(socket.handshake))
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
  }

  handleDisconnect() {
    this.metrics.connections.dec();
  }

  // First message after every (re)connect. Joins the room of the socket's own
  // session and returns the state to continue from (MD-13).
  @SubscribeMessage("join")
  async handleJoin(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<JoinAck> {
    const { sessionId } = client.data.identity;

    const parsed = joinPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return this.reject(client, {
        code: "INVALID_PAYLOAD",
        message: "join needs { sessionId: uuid, lastSeq?: integer >= 0 }",
      });
    }
    if (parsed.data.sessionId !== sessionId) {
      return this.reject(client, {
        code: "ROOM_FORBIDDEN",
        message: "The participant token does not belong to this session",
      });
    }

    await client.join(roomName(sessionId));
    const state = await this.roomEvents.sync(sessionId, parsed.data.lastSeq);
    client.emit("state", state);
    return { ok: true, ...state };
  }

  private async reject(client: RealtimeSocket, error: ErrorBody): Promise<JoinAck> {
    const seq = await this.roomEvents.currentSeq(client.data.identity.sessionId);
    client.emit("error", { ...error, seq });
    return { ok: false, error };
  }
}

function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof RoomAuthError) return { code: err.code, message: err.message };
  return { code: "INTERNAL", message: "Could not check the participant token" };
}
