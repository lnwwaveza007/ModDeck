// Live reactions end to end (R1-15): phones tap, the server drops taps that come too soon or while
// reactions are off, and the host's screens get the taps in batches. Real Postgres and Redis; two
// api instances behind one Redis, as on staging.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PARTICIPANT_COOKIE,
  REACTION_BATCH_MS,
  REACTION_INTERVAL_MS,
  type ClientToServerEvents,
  type JoinAck,
  type LiveSessionView,
  type ParticipantMe,
  type ReactionBurst,
  type RoomEvent,
  type ServerToClientEvents,
} from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

jest.setTimeout(60_000);

const SUBJECT = "e2e-reactions-host";
// Acceptance criterion: a tap shows on the projector within 1 s.
const DELIVERY_BUDGET_MS = 1000;
// Long enough for a batch to leave both instances after the last tap.
const SETTLE_MS = REACTION_BATCH_MS * 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("live reactions (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  let host: { id: string; cookie: string };
  const sockets: ClientSocket[] = [];

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: SUBJECT } });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  const api = () => request(a.app.getHttpServer());
  const asHost = (r: request.Test) => r.set("Cookie", host.cookie);

  /** A new deck takes the default for reactions: it says nothing about them. */
  async function liveSession(): Promise<string> {
    const deck = await prisma.deck.create({
      data: {
        ownerId: host.id,
        title: "Reactions deck",
        slides: { create: [{ position: 0, kind: "content", elements: [] }] },
      },
    });
    const res = await asHost(api().post(`/decks/${deck.id}/sessions`)).expect(201);
    return (res.body as { id: string }).id;
  }

  async function participantTokens(sessionId: string, count: number): Promise<string[]> {
    const tokens = Array.from({ length: count }, () => randomBytes(32).toString("base64url"));
    await prisma.participant.createMany({
      data: tokens.map((token) => ({
        sessionId,
        loginType: "guest" as const,
        nickname: `r-${token.slice(0, 10)}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      })),
    });
    return tokens;
  }

  function connect(url: string, auth: Record<string, string>, cookie?: string): ClientSocket {
    const socket: ClientSocket = io(url, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      auth,
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

  async function joined(socket: ClientSocket, sessionId: string) {
    await connected(socket);
    const ack = await new Promise<JoinAck>((resolve) =>
      socket.emit("join", { sessionId }, resolve),
    );
    expect(ack.ok).toBe(true);
    return socket;
  }

  /** Every burst a host screen gets, with the time it came. */
  function collect(screen: ClientSocket) {
    const bursts: { at: number; burst: ReactionBurst }[] = [];
    screen.on("reaction_burst", (burst) => bursts.push({ at: Date.now(), burst }));
    return {
      bursts,
      total: (emoji: string) =>
        bursts.reduce((sum, { burst }) => sum + (burst.counts[emoji as "👏"] ?? 0), 0),
    };
  }

  /** The audience screen on instance A and phones on instance B. */
  async function room(sessionId: string, phones = 1) {
    const tokens = await participantTokens(sessionId, phones);
    const screen = await joined(connect(a.url, { role: "host" }, host.cookie), sessionId);
    const devices = await Promise.all(
      tokens.map((token) => joined(connect(b.url, { token }), sessionId)),
    );
    return { screen, phones: devices, tokens };
  }

  const setReactions = (sessionId: string, reactionsEnabled: boolean) =>
    asHost(api().patch(`/sessions/${sessionId}`)).send({ reactionsEnabled });

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
    await cleanup();
    const auth = a.app.get(AuthService);
    const user = await auth.upsertUser({
      subject: SUBJECT,
      email: `${SUBJECT}@kmutt.ac.th`,
      displayName: SUBJECT,
      studentId: null,
    });
    const { token } = await auth.createSession(user);
    host = { id: user.id, cookie: `host_session=${encodeURIComponent(token)}` };
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  it("is on by default, for the host's screens and the phones", async () => {
    const sessionId = await liveSession();
    const view = await asHost(api().get(`/sessions/${sessionId}/live`)).expect(200);
    expect((view.body as LiveSessionView).reactionsEnabled).toBe(true);

    const [token] = await participantTokens(sessionId, 1);
    const me = await api()
      .get("/participants/me")
      .set("Cookie", `${PARTICIPANT_COOKIE}=${token}`)
      .expect(200);
    expect((me.body as ParticipantMe).reactionsEnabled).toBe(true);
  });

  it("shows a tap from a phone on the projector within 1 s, and never on the phones", async () => {
    const sessionId = await liveSession();
    const { screen, phones } = await room(sessionId, 2);
    const seen = collect(screen);
    const phoneBursts: unknown[] = [];
    for (const phone of phones) phone.on("reaction_burst", (burst) => phoneBursts.push(burst));

    const sentAt = Date.now();
    phones[0].emit("reaction", { emoji: "👏" });
    await wait(SETTLE_MS);

    expect(seen.bursts).toHaveLength(1);
    expect(seen.bursts[0].burst).toEqual({ sessionId, counts: { "👏": 1 } });
    expect(seen.bursts[0].at - sentAt).toBeLessThan(DELIVERY_BUDGET_MS);
    expect(phoneBursts).toEqual([]);
  });

  it("counts one tap per participant per second, even from two sockets", async () => {
    const sessionId = await liveSession();
    const { screen, phones, tokens } = await room(sessionId, 1);
    // The same participant on the other instance: another tab, another device.
    const twin = await joined(connect(a.url, { token: tokens[0] }), sessionId);
    const seen = collect(screen);

    for (let i = 0; i < 5; i++) phones[0].emit("reaction", { emoji: "❤️" });
    twin.emit("reaction", { emoji: "❤️" });
    await wait(SETTLE_MS);
    expect(seen.total("❤️")).toBe(1);

    // After the interval the next tap counts again.
    await wait(REACTION_INTERVAL_MS);
    phones[0].emit("reaction", { emoji: "😂" });
    await wait(SETTLE_MS);
    expect(seen.total("😂")).toBe(1);
  });

  it("drops an emoji outside the set, a tap from a host socket, and one before join", async () => {
    const sessionId = await liveSession();
    const { screen, phones, tokens } = await room(sessionId, 1);
    const early = connect(b.url, { token: tokens[0] });
    await connected(early);
    const seen = collect(screen);

    (phones[0].emit as (event: string, payload: unknown) => void)("reaction", { emoji: "👍" });
    (phones[0].emit as (event: string, payload: unknown) => void)("reaction", "🎉");
    screen.emit("reaction", { emoji: "🎉" });
    early.emit("reaction", { emoji: "🎉" });
    await wait(SETTLE_MS);
    expect(seen.bursts).toEqual([]);

    // None of the dropped taps used up the participant's second.
    phones[0].emit("reaction", { emoji: "🎉" });
    await wait(SETTLE_MS);
    expect(seen.total("🎉")).toBe(1);
  });

  it("batches 300 students tapping at once into a few bursts", async () => {
    const sessionId = await liveSession();
    const tokens = await participantTokens(sessionId, 300);
    const screen = await joined(connect(a.url, { role: "host" }, host.cookie), sessionId);
    // Half the room on each instance.
    const phones = await Promise.all(
      tokens.map((token, i) => joined(connect(i % 2 ? b.url : a.url, { token }), sessionId)),
    );
    const seen = collect(screen);
    let phoneMessages = 0;
    for (const phone of phones) phone.onAny(() => phoneMessages++);

    const sentAt = Date.now();
    phones.forEach((phone, i) => phone.emit("reaction", { emoji: i % 3 ? "👏" : "🎉" }));
    await wait(DELIVERY_BUDGET_MS + SETTLE_MS);

    expect(seen.total("👏") + seen.total("🎉")).toBe(300);
    expect(seen.total("🎉")).toBe(100);
    // One burst per instance per batch: 300 taps cost the projector a handful of messages.
    expect(seen.bursts.length).toBeLessThanOrEqual(10);
    // Each batch window holds at most one burst from each of the two instances.
    for (const { at } of seen.bursts) {
      const sameWindow = seen.bursts.filter((other) => Math.abs(other.at - at) < REACTION_BATCH_MS);
      expect(sameWindow.length).toBeLessThanOrEqual(4);
    }
    const last = Math.max(...seen.bursts.map(({ at }) => at));
    expect(last - sentAt).toBeLessThan(DELIVERY_BUDGET_MS);
    // The phones get nothing back from 300 taps.
    expect(phoneMessages).toBe(0);
  });

  it("lets the host turn reactions off and on again", async () => {
    const sessionId = await liveSession();
    const { screen, phones, tokens } = await room(sessionId, 2);
    const seen = collect(screen);
    const toggled = new Promise<RoomEvent<"reactions_toggled">>((resolve) =>
      phones[0].once("reactions_toggled", resolve),
    );

    await setReactions(sessionId, false).expect(200, { reactionsEnabled: false });
    expect((await toggled).data).toEqual({ enabled: false });

    phones[0].emit("reaction", { emoji: "😮" });
    await wait(SETTLE_MS);
    expect(seen.bursts).toEqual([]);

    // A screen or phone that loads now starts with reactions off.
    const view = await asHost(api().get(`/sessions/${sessionId}/live`)).expect(200);
    expect((view.body as LiveSessionView).reactionsEnabled).toBe(false);
    const me = await api()
      .get("/participants/me")
      .set("Cookie", `${PARTICIPANT_COOKIE}=${tokens[1]}`)
      .expect(200);
    expect((me.body as ParticipantMe).reactionsEnabled).toBe(false);

    await setReactions(sessionId, true).expect(200, { reactionsEnabled: true });
    phones[1].emit("reaction", { emoji: "😮" });
    await wait(SETTLE_MS);
    expect(seen.total("😮")).toBe(1);
  });

  it("replays the switch to a phone that missed it", async () => {
    const sessionId = await liveSession();
    const [token] = await participantTokens(sessionId, 1);
    const phone = connect(b.url, { token });
    await connected(phone);
    const first = await new Promise<JoinAck>((resolve) =>
      phone.emit("join", { sessionId }, resolve),
    );
    const lastSeq = first.ok ? first.seq : 0;
    // The phone drops off, and the host turns reactions off while it is away.
    phone.disconnect();
    await setReactions(sessionId, false).expect(200);

    const back = connect(b.url, { token });
    await connected(back);
    const ack = await new Promise<JoinAck>((resolve) =>
      back.emit("join", { sessionId, lastSeq }, resolve),
    );
    expect(ack).toMatchObject({ ok: true, mode: "replay" });
    const events = ack.ok && ack.mode === "replay" ? ack.events : [];
    expect(events).toContainEqual(
      expect.objectContaining({ type: "reactions_toggled", data: { enabled: false } }),
    );
  });

  it("drops taps after the session ends, and refuses the switch", async () => {
    const sessionId = await liveSession();
    const { screen, phones } = await room(sessionId, 1);
    const seen = collect(screen);

    await asHost(api().patch(`/sessions/${sessionId}`))
      .send({ status: "ended" })
      .expect(200);
    phones[0].emit("reaction", { emoji: "👏" });
    await wait(SETTLE_MS);
    expect(seen.bursts).toEqual([]);

    await setReactions(sessionId, true).expect(409);
  });

  it("refuses a switch body that is not a boolean, and a caller without the host login", async () => {
    const sessionId = await liveSession();
    await asHost(api().patch(`/sessions/${sessionId}`))
      .send({ reactionsEnabled: "off" })
      .expect(422);
    await api().patch(`/sessions/${sessionId}`).send({ reactionsEnabled: false }).expect(401);
  });
});
