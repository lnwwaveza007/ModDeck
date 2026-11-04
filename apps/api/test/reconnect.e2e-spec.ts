// MD-13 ported into the product: a student loses the network, comes back on
// their own and finds the session as it is now. Real Postgres and Redis, real
// Socket.IO clients with auto reconnect on, and a TCP proxy as the "WiFi" in
// front of the api, so an outage really cuts the connection and really blocks
// new ones until it is over.
//
//   MD13_QUICK=1  runs the drops as 0.2 s / 0.5 s / 1 s (about 15 s in all)
//   default       runs the real 5 s / 30 s / 2 min (about 3 min in all)

import { randomBytes, randomUUID } from "node:crypto";
import net, { type AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  MAX_PARTICIPANTS,
  SEAT_HOLD_MS,
  type ClientToServerEvents,
  type JoinAck,
  type RoomEvent,
  type ServerToClientEvents,
} from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { PrismaService } from "../src/prisma/prisma.service";
import { AnswerLedgerService } from "../src/realtime/answer-ledger.service";
import { hashToken } from "../src/realtime/participant-token";
import { RoomEventsService } from "../src/realtime/room-events.service";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const QUICK = process.env.MD13_QUICK === "1";
const DROPS_MS = QUICK ? [200, 500, 1000] : [5_000, 30_000, 120_000];
jest.setTimeout(QUICK ? 30_000 : 240_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The student's WiFi: everything between the phone and the api.
class Wifi {
  private server?: net.Server;
  private readonly pipes = new Set<net.Socket>();
  port = 0;

  constructor(private target: number) {}

  /** Switches the network on, on the same port every time so clients find it again. */
  async on(): Promise<void> {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.target, "127.0.0.1");
      for (const pipe of [client, upstream]) {
        this.pipes.add(pipe);
        pipe.on("close", () => this.pipes.delete(pipe));
        pipe.on("error", () => pipe.destroy());
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Switches the network off: cuts every connection and refuses new ones. */
  async off(): Promise<void> {
    for (const pipe of this.pipes) pipe.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = undefined;
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }
}

async function startApi(port = 0): Promise<{ app: INestApplication; port: number }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(port, "127.0.0.1");
  return { app, port: (app.getHttpServer().address() as AddressInfo).port };
}

// A student phone: Socket.IO with auto reconnect, joining again after every connect
// and remembering the last seq, as LiveConnection does in the browser.
class Phone {
  readonly socket: ClientSocket;
  lastSeq = 0;
  readonly seen: number[] = [];
  readonly joins: (number | undefined)[] = [];
  connects = 0;
  lastMode?: "replay" | "snapshot";

  constructor(
    url: string,
    token: string,
    private readonly sessionId: string,
  ) {
    this.socket = io(url, {
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 50,
      reconnectionDelayMax: 500,
      timeout: 1000,
    });
    this.socket.on("connect", () => {
      this.connects += 1;
      void this.join();
    });
    this.socket.on("slide_changed", (event) => this.apply(event));
  }

  private apply(event: RoomEvent) {
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    this.seen.push(event.seq);
  }

  private async join() {
    const lastSeq = this.lastSeq || undefined;
    this.joins.push(lastSeq);
    const ack: JoinAck = await this.socket
      .timeout(5000)
      .emitWithAck("join", { sessionId: this.sessionId, lastSeq });
    if (!ack.ok) return;
    this.lastMode = ack.mode;
    if (ack.mode === "replay") for (const event of ack.events) this.apply(event);
    this.lastSeq = ack.seq;
  }

  async untilSeq(seq: number, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.lastSeq < seq) {
      if (Date.now() > deadline) throw new Error(`still at seq ${this.lastSeq}, wanted ${seq}`);
      await sleep(25);
    }
  }

  async untilConnects(count: number, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.connects < count || this.lastMode === undefined) {
      if (Date.now() > deadline) throw new Error(`only ${this.connects} connects`);
      await sleep(25);
    }
  }

  close() {
    this.socket.disconnect();
  }
}

describe("reconnect and state recovery (MD-13, e2e)", () => {
  let api: { app: INestApplication; port: number };
  let prisma: PrismaService;
  const phones: Phone[] = [];
  const wifis: Wifi[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    api = await startApi();
    prisma = api.app.get(PrismaService);
  });

  afterAll(async () => {
    for (const phone of phones) phone.close();
    for (const wifi of wifis) await wifi.off();
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    await api.app.close();
  });

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

  async function createParticipant(sessionId: string, lastSeenAt = new Date()) {
    const token = randomBytes(32).toString("base64url");
    const participant = await prisma.participant.create({
      data: {
        sessionId,
        loginType: "guest",
        nickname: `p-${token.slice(0, 8)}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
        lastSeenAt,
      },
    });
    return { token, participant };
  }

  const publish = (sessionId: string, index: number) =>
    api.app
      .get(RoomEventsService)
      .publish(sessionId, "slide_changed", { slideId: `s${index}`, index });

  describe.each([
    ["5 s", DROPS_MS[0]],
    ["30 s", DROPS_MS[1]],
    ["2 min", DROPS_MS[2]],
  ])("WiFi off for %s", (_label, dropMs) => {
    it("rejoins by itself and gets the events it missed, once each", async () => {
      const session = await createSession();
      const { token } = await createParticipant(session.id);
      const wifi = new Wifi(api.port);
      wifis.push(wifi);
      await wifi.on();

      const phone = new Phone(wifi.url, token, session.id);
      phones.push(phone);
      await phone.untilConnects(1);
      await publish(session.id, 0);
      await phone.untilSeq(1);

      await wifi.off();
      // Events the class goes through while the phone has no network.
      await publish(session.id, 1);
      await publish(session.id, 2);
      await sleep(dropMs);
      await publish(session.id, 3);
      await wifi.on();

      // seq 1 came before the drop, 2 to 4 during it.
      await phone.untilSeq(4);
      expect(phone.connects).toBeGreaterThanOrEqual(2);
      // Same session, replay from where it stopped: no gap, no duplicate.
      expect(phone.seen).toEqual([1, 2, 3, 4]);
      expect(phone.joins.at(-1)).toBe(1);
      expect(phone.lastMode).toBe("replay");

      // Live again.
      await publish(session.id, 4);
      await phone.untilSeq(5);
      expect(phone.seen).toEqual([1, 2, 3, 4, 5]);
    });

    it("keeps the seat while offline", async () => {
      const session = await createSession();
      const { token, participant } = await createParticipant(session.id);
      const wifi = new Wifi(api.port);
      wifis.push(wifi);
      await wifi.on();
      const phone = new Phone(wifi.url, token, session.id);
      phones.push(phone);
      await phone.untilConnects(1);

      const before = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
      await wifi.off();
      await sleep(Math.min(dropMs, 1000));

      const row = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
      expect(row.status).toBe("active");
      // The hold clock started when the socket dropped, not when the student joined.
      expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before.lastSeenAt.getTime());
      expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(SEAT_HOLD_MS);
      await wifi.on();
      await phone.untilConnects(2);
    });
  });

  it("recovers every connected client after an api restart", async () => {
    const restartable = await startApi();
    const session = await createSession();
    const wifi = new Wifi(restartable.port);
    wifis.push(wifi);
    await wifi.on();

    const students = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const { token } = await createParticipant(session.id);
        const phone = new Phone(wifi.url, token, session.id);
        phones.push(phone);
        return phone;
      }),
    );
    await Promise.all(students.map((phone) => phone.untilConnects(1)));
    const events = restartable.app.get(RoomEventsService);
    await events.publish(session.id, "slide_changed", { slideId: "s0", index: 0 });
    await Promise.all(students.map((phone) => phone.untilSeq(1)));

    // The api process goes away: every socket is cut, a new one starts on the same port.
    await restartable.app.close();
    const next = await startApi(restartable.port);
    try {
      await next.app
        .get(RoomEventsService)
        .publish(session.id, "slide_changed", { slideId: "s2", index: 2 });

      await Promise.all(students.map((phone) => phone.untilSeq(2)));
      for (const phone of students) {
        expect(phone.connects).toBeGreaterThanOrEqual(2);
        expect(phone.seen.at(-1)).toBe(2);
        expect(new Set(phone.seen).size).toBe(phone.seen.length); // no event twice
      }
    } finally {
      await next.app.close();
    }
  });

  describe("answers are counted once", () => {
    it("runs the answer once for a retried answerId", async () => {
      const ledger = api.app.get(AnswerLedgerService);
      const session = await createSession();
      const answerId = randomUUID();
      let counted = 0;
      const apply = async () => ({ total: ++counted });

      const first = await ledger.once(session.id, answerId, apply);
      const retry = await ledger.once(session.id, answerId, apply);
      const other = await ledger.once(session.id, randomUUID(), apply);

      expect(first).toEqual({ duplicate: false, result: { total: 1 } });
      expect(retry).toEqual({ duplicate: true, result: { total: 1 } });
      expect(other).toEqual({ duplicate: false, result: { total: 2 } });
      expect(counted).toBe(2);
    });

    it("counts once when the same answer is sent many times at once", async () => {
      const ledger = api.app.get(AnswerLedgerService);
      const session = await createSession();
      const answerId = randomUUID();
      let counted = 0;

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () =>
          ledger.once(session.id, answerId, async () => {
            await sleep(30);
            return { total: ++counted };
          }),
        ),
      );

      expect(counted).toBe(1);
      expect(outcomes.filter((o) => !o.duplicate)).toHaveLength(1);
      expect(outcomes.filter((o) => o.duplicate)).toHaveLength(19);
    });

    it("lets a retry try again when the first attempt failed", async () => {
      const ledger = api.app.get(AnswerLedgerService);
      const session = await createSession();
      const answerId = randomUUID();

      await expect(
        ledger.once(session.id, answerId, async () => {
          throw new Error("redis down");
        }),
      ).rejects.toThrow("redis down");
      await expect(ledger.once(session.id, answerId, async () => "ok")).resolves.toEqual({
        duplicate: false,
        result: "ok",
      });
    });

    it("still knows the answer after an api restart and across instances", async () => {
      const session = await createSession();
      const answerId = randomUUID();
      const before = await startApi();
      await before.app.get(AnswerLedgerService).once(session.id, answerId, async () => "counted");
      await before.app.close();

      const after = await startApi();
      try {
        const retry = await after.app
          .get(AnswerLedgerService)
          .once(session.id, answerId, async () => {
            throw new Error("must not run again");
          });
        expect(retry).toEqual({ duplicate: true, result: "counted" });
        // And the instance that has been up the whole time agrees.
        const sameId = await api.app
          .get(AnswerLedgerService)
          .once(session.id, answerId, async () => {
            throw new Error("must not run again");
          });
        expect(sameId.duplicate).toBe(true);
      } finally {
        await after.app.close();
      }
    });
  });

  describe("seat hold (15 min)", () => {
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

    function connectsAs(token: string) {
      const socket: ClientSocket = io(`http://127.0.0.1:${api.port}`, {
        transports: ["websocket"],
        auth: { token },
        reconnection: false,
      });
      return new Promise<"connected" | string>((resolve) => {
        socket.once("connect", () => {
          socket.disconnect();
          resolve("connected");
        });
        socket.once("connect_error", (err) => {
          resolve((err as Error & { data?: { code: string } }).data?.code ?? err.message);
        });
      });
    }

    async function fillRoom(sessionId: string, seats: number, lastSeenAt = new Date()) {
      await prisma.participant.createMany({
        data: Array.from({ length: seats }, (_, i) => ({
          sessionId,
          loginType: "guest" as const,
          nickname: `full-${randomBytes(4).toString("hex")}-${i}`,
          tokenHash: hashToken(randomBytes(16).toString("hex")),
          tokenExpiresAt: new Date(Date.now() + 3600_000),
          lastSeenAt,
        })),
      });
    }

    it("lets a student back in after 14 minutes offline even when the room is full", async () => {
      const session = await createSession();
      const away = await createParticipant(session.id, minutesAgo(14));
      await fillRoom(session.id, MAX_PARTICIPANTS - 1);

      await expect(connectsAs(away.token)).resolves.toBe("connected");
    });

    it("frees the seat after 15 minutes, and says the session is full when it was taken", async () => {
      const session = await createSession();
      const away = await createParticipant(session.id, minutesAgo(16));
      await fillRoom(session.id, MAX_PARTICIPANTS);

      await expect(connectsAs(away.token)).resolves.toBe("SESSION_FULL");
    });

    it("lets a student back in after 16 minutes when nobody took the seat", async () => {
      const session = await createSession();
      const away = await createParticipant(session.id, minutesAgo(16));
      await fillRoom(session.id, 10);

      await expect(connectsAs(away.token)).resolves.toBe("connected");
      // The student is seated again: the hold clock restarted.
      await sleep(200); // the touch on connect is fire and forget
      const row = await prisma.participant.findUniqueOrThrow({
        where: { id: away.participant.id },
      });
      expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(5_000);
    });

    it("gives a new student the seat of someone offline for over 15 minutes", async () => {
      const session = await createSession();
      await fillRoom(session.id, MAX_PARTICIPANTS - 1);
      await fillRoom(session.id, 1, minutesAgo(16));
      const join = (nickname: string) =>
        request(api.app.getHttpServer())
          .post(`/pins/${session.pin}/participants`)
          .send({ nickname });

      await join("Takes the seat").expect(201);
      // The room is full again: 300 held seats.
      const late = await join("Too late").expect(409);
      expect(late.body.error.code).toBe("SESSION_FULL");
    });
  });
});
