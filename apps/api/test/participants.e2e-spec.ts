// Student join end to end against the real database and Redis: PIN check,
// guest and KMUTT join, rejoin, nickname rules, session full, the wrong-PIN
// limit, /participants/me and a late join on the live socket.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  MAX_PARTICIPANTS,
  type ClientToServerEvents,
  type JoinAck,
  type ServerToClientEvents,
} from "@moddeck/shared";
import Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";
import { REDIS } from "../src/redis/redis.module";

jest.setTimeout(30_000);

const SUBJECTS = ["e2e-join-host", "e2e-join-student", "e2e-join-student-2"];

describe("student join (e2e)", () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let host: { id: string; cookie: string };
  let student: { id: string; cookie: string };
  let deckId: string;
  let slideIds: string[];

  async function login(subject: string, displayName: string) {
    const auth = app.get(AuthService);
    const user = await auth.upsertUser({
      subject,
      email: `${subject}@kmutt.ac.th`,
      displayName,
      studentId: "64070001",
    });
    const { token } = await auth.createSession(user);
    return { id: user.id, cookie: `host_session=${encodeURIComponent(token)}` };
  }

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: { in: SUBJECTS } } });
    const ids = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId: ids } });
    await prisma.deck.deleteMany({ where: { ownerId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
  }

  async function startSession(settings: { requireKmuttLogin?: boolean } = {}) {
    for (;;) {
      const pin = String(100000 + Math.floor(Math.random() * 900000));
      const taken = await prisma.session.findFirst({ where: { pin } });
      if (taken) continue;
      return prisma.session.create({
        data: { deckId, ownerId: host.id, pin, settings, currentSlideId: slideIds[0] },
      });
    }
  }

  async function seat(sessionId: string, count: number) {
    await prisma.participant.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        sessionId,
        loginType: "guest" as const,
        nickname: `seat${i}`,
        tokenHash: hashToken(randomBytes(16).toString("hex")),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      })),
    });
  }

  // A browser: its own device cookie, so the wrong-PIN limit of one test does
  // not leak into another.
  const device = () => `moddeck_dev=${randomBytes(16).toString("base64url")}`;
  const api = () => request(app.getHttpServer());

  function cookieFrom(res: request.Response, name: string): string | undefined {
    const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
    const line = raw?.find((c) => c.startsWith(`${name}=`));
    return line?.split(";")[0];
  }

  function joinGuest(pin: string, nickname: string, cookies: string[] = [device()]) {
    return api().post(`/pins/${pin}/participants`).set("Cookie", cookies).send({ nickname });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ["error"] });
    await setupApp(app);
    await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    prisma = app.get(PrismaService);
    // Wrong PINs from earlier runs on this IP must not count.
    await app.get<Redis>(REDIS).del("pin-fail:ip:127.0.0.1", "pin-fail:ip:::ffff:127.0.0.1");
    await cleanup();
    host = await login(SUBJECTS[0], "Somchai Jaidee");
    student = await login(SUBJECTS[1], "Ploy Student");
    const deck = await prisma.deck.create({
      data: {
        ownerId: host.id,
        title: "INT365 Software Engineering",
        slides: { create: [0, 1, 2].map((position) => ({ position, kind: "text" as const })) },
      },
      include: { slides: { orderBy: { position: "asc" } } },
    });
    deckId = deck.id;
    slideIds = deck.slides.map((s) => s.id);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  describe("GET /pins/:pin", () => {
    it("tells the join screen about a live session", async () => {
      const session = await startSession();
      await seat(session.id, 2);
      const res = await api().get(`/pins/${session.pin}`).set("Cookie", device()).expect(200);
      expect(res.body).toEqual({
        status: "live",
        title: "INT365 Software Engineering",
        hostName: "Somchai Jaidee",
        participantCount: 2,
        requireLogin: false,
        joined: null,
      });
      expect(JSON.stringify(res.body)).not.toContain(session.id);
    });

    it("answers 404 for an unknown or malformed PIN, and 410 for an ended session", async () => {
      await api().get("/pins/000000").set("Cookie", device()).expect(404);
      await api().get("/pins/12ab").set("Cookie", device()).expect(404);
      const session = await startSession();
      await prisma.session.update({
        where: { id: session.id },
        data: { status: "ended", endedAt: new Date() },
      });
      const res = await api().get(`/pins/${session.pin}`).set("Cookie", device()).expect(410);
      expect(res.body.error.code).toBe("SESSION_ENDED");
    });
  });

  describe("guest join", () => {
    it("joins with a nickname and sets an HttpOnly participant cookie", async () => {
      const session = await startSession();
      const res = await joinGuest(session.pin, "  พลอย   P ").expect(201);
      expect(res.body).toMatchObject({
        sessionId: session.id,
        loginType: "guest",
        nickname: "พลอย P",
      });
      expect(res.headers.location).toBe(
        `/api/sessions/${session.id}/participants/${res.body.participantId}`,
      );
      const raw = (res.headers["set-cookie"] as unknown as string[]).find((c) =>
        c.startsWith("moddeck_pt="),
      );
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);

      const token = decodeURIComponent(cookieFrom(res, "moddeck_pt")!.split("=")[1]);
      const row = await prisma.participant.findUniqueOrThrow({
        where: { id: res.body.participantId },
      });
      expect(row.tokenHash).toBe(hashToken(token));
      expect(row.tokenHash).not.toBe(token);
    });

    it("lets the same browser rejoin as the same participant", async () => {
      const session = await startSession();
      const browser = [device()];
      const first = await joinGuest(session.pin, "Ploy", browser).expect(201);
      browser.push(cookieFrom(first, "moddeck_pt")!);

      const info = await api().get(`/pins/${session.pin}`).set("Cookie", browser).expect(200);
      expect(info.body.joined).toEqual({ sessionId: session.id, nickname: "Ploy" });

      const again = await joinGuest(session.pin, "Ploy", browser).expect(200);
      expect(again.body.participantId).toBe(first.body.participantId);
      expect(await prisma.participant.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it("refuses nicknames that break the rules, or are taken in any case", async () => {
      const session = await startSession();
      for (const [nickname, problem] of [
        ["P", "TOO_SHORT"],
        ["Ploy!", "INVALID_CHARS"],
        ["teacher", "RESERVED"],
        ["somchai jaidee", "RESERVED"],
      ]) {
        const res = await joinGuest(session.pin, nickname).expect(422);
        expect(res.body.error).toMatchObject({
          code: "NICKNAME_INVALID",
          details: { fields: { nickname: problem } },
        });
      }
      await joinGuest(session.pin, "Ploy").expect(201);
      const taken = await joinGuest(session.pin, "PLOY").expect(409);
      expect(taken.body.error.code).toBe("NICKNAME_TAKEN");
    });

    it("is refused when the session requires a KMUTT login", async () => {
      const session = await startSession({ requireKmuttLogin: true });
      const info = await api().get(`/pins/${session.pin}`).set("Cookie", device()).expect(200);
      expect(info.body.requireLogin).toBe(true);
      const res = await joinGuest(session.pin, "Ploy").expect(403);
      expect(res.body.error.code).toBe("LOGIN_REQUIRED");
    });

    it("is refused to a removed participant", async () => {
      const session = await startSession();
      const browser = [device()];
      const first = await joinGuest(session.pin, "Ploy", browser).expect(201);
      browser.push(cookieFrom(first, "moddeck_pt")!);
      await prisma.participant.update({
        where: { id: first.body.participantId },
        data: { status: "removed" },
      });
      const res = await joinGuest(session.pin, "Ploy", browser).expect(403);
      expect(res.body.error.code).toBe("PARTICIPANT_REMOVED");
    });
  });

  describe("KMUTT join", () => {
    it("joins with the KMUTT login and its real name", async () => {
      const session = await startSession({ requireKmuttLogin: true });
      const res = await api()
        .post(`/pins/${session.pin}/participants`)
        .set("Cookie", [device(), student.cookie])
        .expect(201);
      expect(res.body).toMatchObject({ loginType: "sso", nickname: "Ploy Student" });
      const row = await prisma.participant.findUniqueOrThrow({
        where: { id: res.body.participantId },
      });
      expect(row.userId).toBe(student.id);
    });

    it("is the same participant on a second device, and shares a name with a guest", async () => {
      const session = await startSession();
      const first = await api()
        .post(`/pins/${session.pin}/participants`)
        .set("Cookie", [device(), student.cookie])
        .expect(201);
      const second = await api()
        .post(`/pins/${session.pin}/participants`)
        .set("Cookie", [device(), student.cookie])
        .expect(200);
      expect(second.body.participantId).toBe(first.body.participantId);

      // Two students may share a real name: the guest rule does not apply.
      const other = await login(SUBJECTS[2], "Ploy Student");
      await api()
        .post(`/pins/${session.pin}/participants`)
        .set("Cookie", [device(), other.cookie])
        .expect(201);
      // A guest may not take a name already in the session.
      await joinGuest(session.pin, "ploy student").expect(409);
    });

    it("needs a login when no nickname is sent", async () => {
      const session = await startSession();
      const res = await api()
        .post(`/pins/${session.pin}/participants`)
        .set("Cookie", device())
        .expect(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("session full", () => {
    it(`stops new students at ${MAX_PARTICIPANTS} but lets a seated one back in`, async () => {
      const session = await startSession();
      await seat(session.id, MAX_PARTICIPANTS - 1);
      const browser = [device()];
      const last = await joinGuest(session.pin, "Last seat", browser).expect(201);
      browser.push(cookieFrom(last, "moddeck_pt")!);

      const info = await api().get(`/pins/${session.pin}`).set("Cookie", device()).expect(409);
      expect(info.body.error.code).toBe("SESSION_FULL");
      const late = await joinGuest(session.pin, "Too late").expect(409);
      expect(late.body.error.code).toBe("SESSION_FULL");

      await api().get(`/pins/${session.pin}`).set("Cookie", browser).expect(200);
      await joinGuest(session.pin, "Last seat", browser).expect(200);
    });

    it("never seats more than the limit when many join at once", async () => {
      const session = await startSession();
      await seat(session.id, MAX_PARTICIPANTS - 5);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) => joinGuest(session.pin, `Rush ${i}`)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(15);
      expect(await prisma.participant.count({ where: { sessionId: session.id } })).toBe(
        MAX_PARTICIPANTS,
      );
    });
  });

  describe("wrong-PIN limit", () => {
    it("blocks a device after 5 wrong PINs, even for the right PIN", async () => {
      const session = await startSession();
      const browser = device();
      for (let i = 0; i < 5; i++) {
        await api().get("/pins/000000").set("Cookie", browser).expect(404);
      }
      const blocked = await api().get(`/pins/${session.pin}`).set("Cookie", browser).expect(429);
      expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      await joinGuest(session.pin, "Blocked", [browser]).expect(429);

      // Another phone on the same campus IP is not blocked.
      await api().get(`/pins/${session.pin}`).set("Cookie", device()).expect(200);
    });

    it("gives a browser without a device cookie one", async () => {
      const res = await api().get("/pins/000000").expect(404);
      expect(cookieFrom(res, "moddeck_dev")).toMatch(/^moddeck_dev=[\w-]{16,}$/);
    });
  });

  describe("GET /participants/me and late join", () => {
    it("tells a late joiner the session and the current slide", async () => {
      const session = await startSession();
      await prisma.session.update({
        where: { id: session.id },
        data: { currentSlideId: slideIds[1] },
      });
      const joined = await joinGuest(session.pin, "Late").expect(201);
      const pt = cookieFrom(joined, "moddeck_pt")!;

      const me = await api().get("/participants/me").set("Cookie", pt).expect(200);
      expect(me.body).toEqual({
        participantId: joined.body.participantId,
        sessionId: session.id,
        loginType: "guest",
        nickname: "Late",
        title: "INT365 Software Engineering",
        status: "live",
        slideCount: 3,
        currentSlide: { id: slideIds[1], index: 1 },
      });

      // The live socket accepts the cookie and starts from the current slide.
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: { cookie: pt },
      });
      try {
        const ack = await new Promise<JoinAck>((resolve, reject) => {
          socket.on("connect_error", reject);
          socket.on("connect", () => socket.emit("join", { sessionId: session.id }, resolve));
        });
        expect(ack).toMatchObject({
          ok: true,
          mode: "snapshot",
          snapshot: { status: "live", currentSlideId: slideIds[1] },
        });
      } finally {
        socket.disconnect();
      }
    });

    it("answers 401 without a participant cookie and 410 once the session ends", async () => {
      await api().get("/participants/me").expect(401);
      const session = await startSession();
      const joined = await joinGuest(session.pin, "Leaving").expect(201);
      await prisma.session.update({ where: { id: session.id }, data: { status: "ended" } });
      const res = await api()
        .get("/participants/me")
        .set("Cookie", cookieFrom(joined, "moddeck_pt")!)
        .expect(410);
      expect(res.body.error.code).toBe("SESSION_ENDED");
    });
  });
});
