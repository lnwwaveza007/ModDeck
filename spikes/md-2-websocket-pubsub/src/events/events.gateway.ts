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
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { VoteService } from "./vote.service";
import {
  wsConnections,
  wsHandlerDuration,
  wsMessagesReceived,
  wsPacketsSent,
} from "../metrics/metrics";

interface JoinPayload {
  pin: string;
  nickname?: string;
}

// clientMsgId and sentAt are optional and echoed back in the broadcast so a
// client can match the broadcast to its own message (used by the MD-8 load test).
interface VotePayload {
  pin: string;
  option: string;
  clientMsgId?: string;
  sentAt?: number;
}

interface QuestionPayload {
  pin: string;
  text: string;
  clientMsgId?: string;
  sentAt?: number;
}

interface BatchedVote {
  option: string;
  clientMsgId?: string;
  sentAt?: number;
}

// MD-8 fix: a vote burst made the api write one packet per vote per client
// (300 votes x 300 clients = 90,000 socket writes in ~1 s), which saturated the
// event loop. Votes are now counted in Redis immediately but broadcast at most
// once per room per interval, carrying the latest tally and the votes it covers.
// 0 restores the original one-broadcast-per-vote behaviour.
const VOTE_BROADCAST_INTERVAL_MS = Number(process.env.VOTE_BROADCAST_INTERVAL_MS ?? 50);

interface EnginePacketSource {
  on(event: "packetCreate", cb: (packet: { type: string }) => void): void;
}

@WebSocketGateway({
  cors: {
    origin: "*",
  },
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly pendingVotes = new Map<string, BatchedVote[]>();

  constructor(private readonly voteService: VoteService) {}

  afterInit(server: Server) {
    // Count every message packet written to a client, including broadcasts
    // that arrive from other instances through the Redis adapter.
    server.engine.on("connection", (rawSocket: EnginePacketSource) => {
      rawSocket.on("packetCreate", (packet) => {
        if (packet.type === "message") wsPacketsSent.inc();
      });
    });
  }

  handleConnection(client: Socket) {
    wsConnections.inc();
    client.onAny((event: string) => wsMessagesReceived.inc({ event }));
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    wsConnections.dec();
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("join")
  async handleJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: JoinPayload) {
    const { pin, nickname } = payload ?? {};

    // Validate 6-digit PIN
    if (!pin || !/^\d{6}$/.test(pin.toString())) {
      client.emit("error", {
        code: "INVALID_PIN",
        message: "Room PIN must be exactly 6 digits (e.g. 123456)",
      });
      return;
    }

    const roomPin = pin.toString();
    await client.join(roomPin);

    const votes = await this.voteService.getVotes(roomPin);

    this.logger.log(`Client ${client.id} joined room ${roomPin}`);

    // Confirmation back to joining client
    client.emit("joined", {
      pin: roomPin,
      nickname: nickname || `User-${client.id.slice(0, 4)}`,
      votes,
    });

    // Notify room peers
    client.to(roomPin).emit("user_joined", {
      pin: roomPin,
      nickname: nickname || `User-${client.id.slice(0, 4)}`,
      socketId: client.id,
    });
  }

  @SubscribeMessage("vote")
  async handleVote(@ConnectedSocket() client: Socket, @MessageBody() payload: VotePayload) {
    const endTimer = wsHandlerDuration.startTimer({ event: "vote" });
    const { pin, option, clientMsgId, sentAt } = payload ?? {};

    if (!pin || !/^\d{6}$/.test(pin.toString()) || !option || typeof option !== "string") {
      client.emit("error", {
        code: "INVALID_VOTE",
        message: "Invalid vote payload: requires 6-digit PIN and option string",
      });
      return;
    }

    const roomPin = pin.toString();
    const cleanOption = option.trim().toUpperCase();

    if (VOTE_BROADCAST_INTERVAL_MS <= 0) {
      // Original behaviour: increment, read tally, broadcast this vote.
      const updatedVotes = await this.voteService.recordVote(roomPin, cleanOption);
      this.logger.log(`Vote in room ${roomPin} for option ${cleanOption}`);
      this.server.to(roomPin).emit("vote_update", {
        pin: roomPin,
        option: cleanOption,
        votes: updatedVotes,
        timestamp: Date.now(),
        batch: [{ option: cleanOption, clientMsgId, sentAt }],
      });
      endTimer();
      return;
    }

    // Atomic increment in Redis, then queue for the next room broadcast.
    await this.voteService.incrementVote(roomPin, cleanOption);
    let pending = this.pendingVotes.get(roomPin);
    if (!pending) {
      pending = [];
      this.pendingVotes.set(roomPin, pending);
      setTimeout(() => void this.flushVotes(roomPin), VOTE_BROADCAST_INTERVAL_MS);
    }
    pending.push({ option: cleanOption, clientMsgId, sentAt });
    endTimer();
  }

  // Broadcast across all instances through Redis Pub/Sub: one packet per client
  // for every vote that arrived in this room during the interval.
  private async flushVotes(roomPin: string) {
    const batch = this.pendingVotes.get(roomPin) ?? [];
    this.pendingVotes.delete(roomPin);
    if (batch.length === 0) return;
    try {
      const votes = await this.voteService.getVotes(roomPin);
      this.server.to(roomPin).emit("vote_update", {
        pin: roomPin,
        option: batch[batch.length - 1].option,
        votes,
        timestamp: Date.now(),
        batch,
      });
    } catch (err: unknown) {
      this.logger.error(`vote_update flush failed for room ${roomPin}: ${String(err)}`);
    }
  }

  @SubscribeMessage("question")
  async handleQuestion(@ConnectedSocket() client: Socket, @MessageBody() payload: QuestionPayload) {
    const endTimer = wsHandlerDuration.startTimer({ event: "question" });
    const { pin, text, clientMsgId, sentAt } = payload ?? {};

    if (!pin || !/^\d{6}$/.test(pin.toString()) || !text || typeof text !== "string") {
      client.emit("error", {
        code: "INVALID_QUESTION",
        message: "Invalid question payload: requires 6-digit PIN and text string",
      });
      return;
    }

    const roomPin = pin.toString();
    const cleanText = text.slice(0, 500);
    await this.voteService.recordQuestion(roomPin, cleanText);

    this.logger.log(`Question in room ${roomPin}`);

    this.server.to(roomPin).emit("question_posted", {
      pin: roomPin,
      text: cleanText,
      from: client.id,
      timestamp: Date.now(),
      clientMsgId,
      sentAt,
    });
    endTimer();
  }

  @SubscribeMessage("reset_votes")
  async handleReset(@ConnectedSocket() client: Socket, @MessageBody() payload: { pin: string }) {
    const { pin } = payload ?? {};
    if (!pin || !/^\d{6}$/.test(pin.toString())) {
      client.emit("error", {
        code: "INVALID_PIN",
        message: "Invalid PIN for resetting votes",
      });
      return;
    }

    const roomPin = pin.toString();
    await this.voteService.resetVotes(roomPin);

    this.logger.log(`Votes reset for room ${roomPin}`);

    this.server.to(roomPin).emit("vote_update", {
      pin: roomPin,
      votes: {},
      timestamp: Date.now(),
    });
  }
}
