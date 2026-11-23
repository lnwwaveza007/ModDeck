import { Injectable } from "@nestjs/common";
import { nicknameProblem, normalizeNickname, type ParticipantRow } from "@moddeck/shared";
import { z } from "zod";
import { ApiException } from "../common/api-error";
import { PrismaService } from "../prisma/prisma.service";
import {
  ParticipantChannelService,
  participantRowSelect,
  toParticipantRow,
} from "../realtime/participant-channel.service";
import { PollStoreService } from "../realtime/poll-store.service";
import { VoteBatcherService } from "../realtime/vote-batcher.service";
import { WordBatcherService } from "../realtime/word-batcher.service";
import { WordStoreService } from "../realtime/word-store.service";
import { SessionAccessService } from "../sessions/session-access.service";

const uuid = z.uuid();
const notFound = () => new ApiException(404, "NOT_FOUND", "Participant not found");

/**
 * The host's participant list (F13, MD-5 §2.5): who joined, who is online, rename a guest, remove
 * anyone. Removal is a status change (docs/db/schema.md): the participant's answers stay in
 * PostgreSQL for the export, marked as removed, and leave every live result of the session.
 */
@Injectable()
export class HostParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channel: ParticipantChannelService,
    private readonly polls: PollStoreService,
    private readonly words: WordStoreService,
    private readonly voteBatcher: VoteBatcherService,
    private readonly wordBatcher: WordBatcherService,
    private readonly access: SessionAccessService,
  ) {}

  /** Everyone still in the session, first joined first. Also works after the end (all offline). */
  async list(userId: string, sessionId: string): Promise<ParticipantRow[]> {
    await this.access.check(userId, sessionId, "member");
    const [participants, online] = await Promise.all([
      this.prisma.participant.findMany({
        where: { sessionId, status: "active" },
        select: participantRowSelect,
        orderBy: { joinedAt: "asc" },
      }),
      this.channel.onlineIds(sessionId),
    ]);
    return participants.map((p) => toParticipantRow(p, online.has(p.id)));
  }

  /**
   * The host types a new name for a guest. It passes the join rules: length, characters, staff
   * names and the host's own name, and no other participant of the session may have it.
   */
  async rename(
    userId: string,
    sessionId: string,
    participantId: string,
    raw: string,
  ): Promise<ParticipantRow> {
    const session = await this.openSession(userId, sessionId);
    if (!uuid.safeParse(participantId).success) throw notFound();
    const nickname = normalizeNickname(raw);
    const problem = nicknameProblem(nickname, [session.owner.displayName]);
    if (problem) {
      throw new ApiException(422, "NICKNAME_INVALID", "Nickname breaks the nickname rules", {
        fields: { nickname: problem },
      });
    }

    const { row, changed } = await this.prisma.$transaction(async (tx) => {
      // The same lock as a join, so a student joining with this name at the same moment cannot
      // end up sharing it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
      const participant = await tx.participant.findFirst({
        where: { id: participantId, sessionId, status: "active" },
        select: participantRowSelect,
      });
      if (!participant) throw notFound();
      if (participant.loginType !== "guest") {
        throw new ApiException(409, "NOT_A_GUEST", "A KMUTT participant shows their KMUTT name");
      }
      if (participant.nickname === nickname) return { row: participant, changed: false };
      const taken = await tx.participant.findFirst({
        where: {
          sessionId,
          id: { not: participantId },
          nickname: { equals: nickname, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (taken) throw new ApiException(409, "NICKNAME_TAKEN", "Nickname is already used");
      const updated = await tx.participant.update({
        where: { id: participantId },
        data: { nickname },
        select: participantRowSelect,
      });
      return { row: updated, changed: true };
    });

    const result = toParticipantRow(row, await this.channel.isOnline(participantId));
    if (changed) {
      this.channel.renamed(participantId, row.nickname);
      this.channel.toHosts(sessionId, "participant_update", result);
    }
    return result;
  }

  /**
   * Removes a participant: their token stops working for this session (REST, socket handshake,
   * and an SSO login on another device), their sockets close, and their answers leave the live
   * results. Safe to send again: a second call finds them removed and finishes the clean-up.
   */
  async remove(userId: string, sessionId: string, participantId: string): Promise<void> {
    await this.openSession(userId, sessionId);
    if (!uuid.safeParse(participantId).success) throw notFound();
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, sessionId },
      select: { status: true },
    });
    if (!participant) throw notFound();
    if (participant.status === "active") {
      await this.prisma.participant.update({
        where: { id: participantId },
        data: { status: "removed" },
        select: { id: true },
      });
    }

    // Refuse their answers first, then take back the ones already counted, so none slips in
    // between. Closed runs too: results shown later must not bring them back.
    await this.polls.markRemoved(sessionId, participantId);
    await this.channel.kick(sessionId, participantId);
    const runs = await this.prisma.activityRun.findMany({
      where: { sessionId },
      select: { id: true, activity: { select: { type: true } } },
    });
    for (const run of runs) {
      if (run.activity.type === "poll") {
        if (await this.polls.dropVote(sessionId, run.id, participantId)) {
          await this.voteBatcher.publishNow(sessionId, run.id);
        }
      } else if (await this.words.dropWords(sessionId, run.id, participantId)) {
        await this.wordBatcher.publishNow(sessionId, run.id);
      }
    }
    this.channel.toHosts(sessionId, "participant_removed", { participantId });
  }

  /** Renaming and removing people is part of running the session: the controller does it. */
  private async openSession(userId: string, sessionId: string) {
    const session = await this.access.check(userId, sessionId, "control");
    if (session.status === "ended") {
      throw new ApiException(409, "SESSION_ENDED", "The session has ended");
    }
    return session;
  }
}
