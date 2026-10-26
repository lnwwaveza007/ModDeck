// Two api instances share one Redis, as in production behind nginx. Needs the
// migrated and seeded database (see schema.e2e-spec.ts) and Redis on REDIS_URL
// (or the local docker-compose Redis).

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ClientToServerEvents,
  ErrorBody,
  JoinAck,
  RoomEvent,
  ServerToClientEvents,
} from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";
import { RoomEventsService } from "../src/realtime/room-events.service";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

jest.setTimeout(20_000);

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("realtime gateway across two instances (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  const sockets: ClientSocket[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    // Sessions cascade to participants.
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await Promise.all([a.app.close(), b.app.close()]);
  });

  // A fresh live session with a PIN no other test run uses.
  async function createSession() {
    const host = await prisma.user.findUniqueOrThrow({ where: { ssoSubject: "demo-host" } });
    const deck = await prisma.deck.findFirstOrThrow({ where: { ownerId: host.id } });
    const pin = String(100000 + Math.floor(Math.random() * 900000));
    const session = await prisma.session.create({
      data: { deckId: deck.id, ownerId: host.id, pin, settings: {} },
    });
    sessionIds.push(session.id);
    return session;
  }

  async function createParticipant(
    sessionId: string,
    overrides: { tokenExpiresAt?: Date; status?: "active" | "removed" } = {},
  ): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await prisma.participant.create({
      data: {
        sessionId,
        loginType: "guest",
        nickname: `p-${token.slice(0, 8)}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: overrides.tokenExpiresAt ?? new Date(Date.now() + 8 * 3600_000),
        status: overrides.status ?? "active",
      },
    });
    return token;
  }

  function connect(url: string, token?: string, cookie?: string): ClientSocket {
    const socket: ClientSocket = io(url, {
      transports: ["websocket"],
      reconnection: false,
      auth: token ? { token } : {},
      extraHeaders: cookie ? { cookie } : undefined,
    });
    sockets.push(socket);
    return socket;
  }

  function connected(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(err));
    });
  }

  function connectError(socket: ClientSocket): Promise<ErrorBody> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => reject(new Error("socket connected")));
      socket.once("connect_error", (err) => resolve((err as Error & { data: ErrorBody }).data));
    });
  }

  function join(socket: ClientSocket, sessionId: string, lastSeq?: number): Promise<JoinAck> {
    return socket.timeout(5000).emitWithAck("join", { sessionId, lastSeq });
  }

  function nextEvent<T extends RoomEvent["type"]>(socket: ClientSocket, type: T) {
    return new Promise<RoomEvent<T>>((resolve) => {
      socket.once(type, ((event: RoomEvent<T>) => resolve(event)) as never);
    });
  }

  it("broadcasts a room event to clients on both instances, with a seq", async () => {
    const session = await createSession();
    const onA = connect(a.url, await createParticipant(session.id));
    const onB = connect(b.url, await createParticipant(session.id));
    await Promise.all([connected(onA), connected(onB)]);
    await expect(join(onA, session.id)).resolves.toMatchObject({ ok: true, seq: 0 });
    await expect(join(onB, session.id)).resolves.toMatchObject({ ok: true, seq: 0 });

    // Published on instance A: reaches the client on B through Redis.
    const gotA1 = nextEvent(onA, "slide_changed");
    const gotB1 = nextEvent(onB, "slide_changed");
    await a.app.get(RoomEventsService).publish(session.id, "slide_changed", {
      slideId: "s1",
      index: 0,
    });
    const [a1, b1] = await Promise.all([gotA1, gotB1]);
    expect(b1).toEqual(a1);
    expect(b1).toMatchObject({ seq: 1, type: "slide_changed", data: { slideId: "s1", index: 0 } });

    // And the other way round, with the next seq.
    const gotA2 = nextEvent(onA, "participant_count");
    const gotB2 = nextEvent(onB, "participant_count");
    await b.app.get(RoomEventsService).publish(session.id, "participant_count", {
      online: 2,
      total: 2,
    });
    const [a2, b2] = await Promise.all([gotA2, gotB2]);
    expect(a2.seq).toBe(2);
    expect(b2.seq).toBe(2);
  });

  it("numbers events per session, and replays missed events on rejoin", async () => {
    const session = await createSession();
    const other = await createSession();
    const events = a.app.get(RoomEventsService);

    await events.publish(other.id, "slide_changed", { slideId: "x", index: 0 });
    for (let index = 0; index < 3; index++) {
      await events.publish(session.id, "slide_changed", { slideId: `s${index}`, index });
    }

    const socket = connect(b.url, await createParticipant(session.id));
    await connected(socket);
    const state = new Promise((resolve) => socket.once("state", resolve));
    const ack = await join(socket, session.id, 1);
    expect(ack).toMatchObject({ ok: true, mode: "replay", seq: 3 });
    expect(ack.ok && ack.mode === "replay" && ack.events.map((e) => e.seq)).toEqual([2, 3]);
    await expect(state).resolves.toMatchObject({ mode: "replay", seq: 3 });

    // First join (no lastSeq): snapshot from the database.
    const fresh = connect(a.url, await createParticipant(session.id));
    await connected(fresh);
    await expect(join(fresh, session.id)).resolves.toMatchObject({
      ok: true,
      mode: "snapshot",
      seq: 3,
      snapshot: { status: "live", currentSlideId: null },
    });
    await expect(events.currentSeq(other.id)).resolves.toBe(1);
  });

  it("refuses a socket without a valid token", async () => {
    const session = await createSession();
    const expired = await createParticipant(session.id, {
      tokenExpiresAt: new Date(Date.now() - 1),
    });
    const removed = await createParticipant(session.id, { status: "removed" });

    await expect(connectError(connect(a.url))).resolves.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(connectError(connect(a.url, "not-a-real-token"))).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(connectError(connect(b.url, expired))).resolves.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    await expect(connectError(connect(b.url, removed))).resolves.toMatchObject({
      code: "PARTICIPANT_REMOVED",
    });

    const ended = await createSession();
    const endedToken = await createParticipant(ended.id);
    await prisma.session.update({ where: { id: ended.id }, data: { status: "ended" } });
    await expect(connectError(connect(a.url, endedToken))).resolves.toMatchObject({
      code: "SESSION_ENDED",
    });
  });

  it("accepts the token from the participant cookie", async () => {
    const session = await createSession();
    const token = await createParticipant(session.id);
    const socket = connect(a.url, undefined, `other=1; moddeck_pt=${token}`);
    await connected(socket);
    await expect(join(socket, session.id)).resolves.toMatchObject({ ok: true });
  });

  it("does not let a socket join another session's room", async () => {
    const mine = await createSession();
    const theirs = await createSession();
    const intruder = connect(a.url, await createParticipant(mine.id));
    const member = connect(b.url, await createParticipant(theirs.id));
    await Promise.all([connected(intruder), connected(member)]);
    await join(member, theirs.id);

    const errorEvent = new Promise((resolve) => intruder.once("error", resolve));
    await expect(join(intruder, theirs.id)).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "ROOM_FORBIDDEN" }),
    });
    await expect(errorEvent).resolves.toMatchObject({ code: "ROOM_FORBIDDEN", seq: 0 });
    await expect(join(intruder, "not-a-uuid")).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_PAYLOAD" },
    });

    // The intruder gets nothing published to the other room.
    const leaked = jest.fn();
    intruder.on("slide_changed", leaked);
    const delivered = nextEvent(member, "slide_changed");
    await a.app.get(RoomEventsService).publish(theirs.id, "slide_changed", {
      slideId: "s",
      index: 0,
    });
    await delivered;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(leaked).not.toHaveBeenCalled();
  });

  it("serves Prometheus metrics", async () => {
    const res = await request(a.app.getHttpServer()).get("/metrics").expect(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    for (const name of [
      "moddeck_ws_connections",
      "moddeck_ws_messages_received_total",
      "moddeck_ws_packets_sent_total",
      "moddeck_room_events_published_total",
      "nodejs_eventloop_lag_p99_seconds",
    ]) {
      expect(res.text).toContain(name);
    }
    expect(res.text).toMatch(/moddeck_ws_messages_received_total\{event="join"[^}]*\} [1-9]/);
  });
});
