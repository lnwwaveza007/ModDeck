import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { VoteService } from "./vote.service";

interface JoinPayload {
  pin: string;
  nickname?: string;
}

interface VotePayload {
  pin: string;
  option: string;
}

@WebSocketGateway({
  cors: {
    origin: "*",
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly voteService: VoteService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
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
    const { pin, option } = payload ?? {};

    if (!pin || !/^\d{6}$/.test(pin.toString()) || !option || typeof option !== "string") {
      client.emit("error", {
        code: "INVALID_VOTE",
        message: "Invalid vote payload: requires 6-digit PIN and option string",
      });
      return;
    }

    const roomPin = pin.toString();
    const cleanOption = option.trim().toUpperCase();

    // Atomic increment in Redis
    const updatedVotes = await this.voteService.recordVote(roomPin, cleanOption);

    this.logger.log(`Vote in room ${roomPin} for option ${cleanOption}`);

    // Broadcast update across all instances through Redis Pub/Sub
    this.server.to(roomPin).emit("vote_update", {
      pin: roomPin,
      option: cleanOption,
      votes: updatedVotes,
      timestamp: Date.now(),
    });
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
