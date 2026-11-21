import { Injectable } from "@nestjs/common";
import type { ParticipantRow, ServerToClientEvents } from "@moddeck/shared";
import { PrismaService } from "../prisma/prisma.service";
import { hostRoomName } from "./reaction.service";
import { RoomEventsService } from "./room-events.service";
import type { RealtimeServer, RealtimeSocket } from "./realtime.types";

// Every socket of one participant (two tabs, a phone and a laptop for SSO).
export const participantRoomName = (participantId: string) => `participant:${participantId}`;
// Every participant socket of one session, joined at connect, before `join`. Nothing is sent to
// it: it only answers "who is online" for the host's participant list.
export const peopleRoomName = (sessionId: string) => `people:${sessionId}`;

/** A row of the host's participant list, without its online flag. */
export const participantRowSelect = {
  id: true,
  nickname: true,
  loginType: true,
  joinedAt: true,
} as const;

export const toParticipantRow = (
  p: { id: string; nickname: string; loginType: "sso" | "guest"; joinedAt: Date },
  online: boolean,
): ParticipantRow => ({
  id: p.id,
  nickname: p.nickname,
  loginType: p.loginType,
  online,
  joinedAt: p.joinedAt.toISOString(),
});

type HostEvent = "participant_update" | "participant_removed";

/**
 * Reaches one participant, or the host's screens, about participants (F13). The rooms live in the
 * Socket.IO adapter, so fetchSockets() and disconnectSockets() work across api instances.
 */
@Injectable()
export class ParticipantChannelService {
  private server?: RealtimeServer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roomEvents: RoomEventsService,
  ) {}

  attach(server: RealtimeServer) {
    this.server = server;
  }

  /** Call on connect: the socket joins the rooms that find it by participant and by session. */
  enter(client: RealtimeSocket, participantId: string, sessionId: string) {
    void client.join([participantRoomName(participantId), peopleRoomName(sessionId)]);
  }

  /** Participants of the session with at least one connected socket. */
  async onlineIds(sessionId: string): Promise<Set<string>> {
    const sockets = await this.io().in(peopleRoomName(sessionId)).fetchSockets();
    const ids = new Set<string>();
    for (const socket of sockets) {
      const { identity } = socket.data;
      if (identity?.role === "participant") ids.add(identity.participantId);
    }
    return ids;
  }

  async isOnline(participantId: string): Promise<boolean> {
    return (await this.io().in(participantRoomName(participantId)).fetchSockets()).length > 0;
  }

  /**
   * Sends the participant's row, as it is now, to the host's screens. Call after a socket came or
   * went, or a rename. A removed participant is not sent: they left the list.
   */
  async announce(sessionId: string, participantId: string): Promise<void> {
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, sessionId, status: "active" },
      select: participantRowSelect,
    });
    if (!participant) return;
    const online = await this.isOnline(participantId);
    this.toHosts(sessionId, "participant_update", toParticipantRow(participant, online));
  }

  toHosts<E extends HostEvent>(
    sessionId: string,
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ) {
    const room = this.io().to(hostRoomName(sessionId)) as unknown as {
      emit: (event: string, ...args: unknown[]) => boolean;
    };
    room.emit(event, ...payload);
  }

  /** Tells the participant's phones their new name. */
  renamed(participantId: string, nickname: string) {
    this.io().to(participantRoomName(participantId)).emit("renamed", { nickname });
  }

  /**
   * Says "removed" to every socket of the participant, then closes them. If the message is lost
   * on the way, the phone reconnects after a server disconnect and the handshake refuses it with
   * the same code, so the student sees the removed screen either way.
   */
  async kick(sessionId: string, participantId: string): Promise<void> {
    const room = participantRoomName(participantId);
    const seq = await this.roomEvents.currentSeq(sessionId);
    this.io().to(room).emit("error", {
      code: "PARTICIPANT_REMOVED",
      message: "You were removed from this session",
      seq,
    });
    this.io().in(room).disconnectSockets(true);
  }

  private io(): RealtimeServer {
    if (!this.server) throw new Error("ParticipantChannelService used before the gateway started");
    return this.server;
  }
}
