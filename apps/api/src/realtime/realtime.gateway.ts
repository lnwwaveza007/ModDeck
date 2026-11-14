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
  votePayloadSchema,
  wordPayloadSchema,
  type AnswerAck,
  type ErrorBody,
  type JoinAck,
  type VoteResult,
  type WordResult,
} from "@moddeck/shared";
import { MetricsService } from "../metrics/metrics.service";
import { hostTokenFromHandshake, tokenFromHandshake, wantsHostRole } from "./participant-token";
import { PollStoreService } from "./poll-store.service";
import { PresenceService } from "./presence.service";
import { RoomAuthError, RoomAuthService } from "./room-auth.service";
import { RoomEventsService, roomName } from "./room-events.service";
import type { RealtimeServer, RealtimeSocket, SocketData } from "./realtime.types";
import { VoteBatcherService } from "./vote-batcher.service";
import { WordBatcherService } from "./word-batcher.service";
import { WordStoreService } from "./word-store.service";

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
    private readonly polls: PollStoreService,
    private readonly voteBatcher: VoteBatcherService,
    private readonly words: WordStoreService,
    private readonly wordBatcher: WordBatcherService,
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

  // A student's vote. The ack is what lets the phone say "Answer sent" (MD-5 rule 6). The session
  // and the participant come from the handshake, never from the payload.
  @SubscribeMessage("vote")
  async handleVote(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<AnswerAck<VoteResult>> {
    const { identity } = client.data;
    if (identity.role !== "participant") {
      return voteError("ROOM_FORBIDDEN", "Only a participant can vote");
    }
    const parsed = votePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return voteError(
        "INVALID_PAYLOAD",
        "vote needs { activityRunId: uuid, optionIds: [uuid], answerId: uuid }",
      );
    }
    const { activityRunId, optionIds, answerId } = parsed.data;
    try {
      const outcome = await this.polls.submit(
        identity.sessionId,
        identity.participantId,
        activityRunId,
        optionIds[0],
        answerId,
      );
      switch (outcome.status) {
        case "accepted":
          this.voteBatcher.schedule(identity.sessionId, activityRunId);
          return { ok: true, duplicate: false, result: { optionIds: [outcome.optionId] } };
        case "duplicate":
          return { ok: true, duplicate: true, result: { optionIds: [outcome.optionId] } };
        case "closed":
          return voteError("ACTIVITY_CLOSED", "Voting has closed");
        case "bad_option":
          return voteError("INVALID_PAYLOAD", "The option is not in this poll");
        case "not_found":
          return voteError("NOT_FOUND", "This poll is not running in your session");
      }
    } catch (err) {
      // Safe to send again: the answerId keeps it from counting twice.
      this.logger.error(`Vote failed: ${String(err)}`);
      return voteError("INTERNAL", "Could not save the vote");
    }
  }

  // A student's word. The limit per student, the length and the state of the activity are all
  // checked here: a phone that skips its own checks gets the same answer.
  @SubscribeMessage("word")
  async handleWord(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() payload: unknown,
  ): Promise<AnswerAck<WordResult>> {
    const { identity } = client.data;
    if (identity.role !== "participant") {
      return wordError("ROOM_FORBIDDEN", "Only a participant can send a word");
    }
    const parsed = wordPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return wordError(
        "INVALID_PAYLOAD",
        "word needs { activityRunId: uuid, text: string, answerId: uuid }",
      );
    }
    const { activityRunId, text, answerId } = parsed.data;
    try {
      const outcome = await this.words.submit(
        identity.sessionId,
        identity.participantId,
        activityRunId,
        text,
        answerId,
      );
      switch (outcome.status) {
        case "accepted":
          this.wordBatcher.schedule(identity.sessionId, activityRunId);
          return { ok: true, duplicate: false, result: { text: outcome.text, sent: outcome.sent } };
        case "duplicate":
          return { ok: true, duplicate: true, result: { text: outcome.text, sent: outcome.sent } };
        case "invalid":
          return wordError("INVALID_PAYLOAD", "The word is empty or too long", {
            field: "text",
            reason: outcome.problem,
          });
        case "limit":
          return wordError("LIMIT_REACHED", "You have sent all the words you may send");
        case "closed":
          return wordError("ACTIVITY_CLOSED", "This word cloud is closed");
        case "not_found":
          return wordError("NOT_FOUND", "This word cloud is not running in your session");
      }
    } catch (err) {
      // Safe to send again: the answerId keeps it from counting twice.
      this.logger.error(`Word failed: ${String(err)}`);
      return wordError("INTERNAL", "Could not save the word");
    }
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

function voteError(code: ErrorBody["code"], message: string): AnswerAck<VoteResult> {
  return { ok: false, error: { code, message } };
}

function wordError(
  code: ErrorBody["code"],
  message: string,
  details?: ErrorBody["details"],
): AnswerAck<WordResult> {
  return { ok: false, error: { code, message, ...(details && { details }) } };
}

function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof RoomAuthError) return { code: err.code, message: err.message };
  return { code: "INTERNAL", message: "Could not check the participant token" };
}
