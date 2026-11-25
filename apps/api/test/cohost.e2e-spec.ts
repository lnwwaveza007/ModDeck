// Co-host end to end (F12): the owner invites one TA, by KMUTT email or by a one-time link. The
// co-host joins from another device, moderates Q&A, cannot edit slides, and can take over
// presenter control; the owner takes it back. Participants cannot call any of it. Real Postgres and
// Redis; the owner's laptop on one api instance and the co-host's device on another.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PARTICIPANT_COOKIE,
  type ClientToServerEvents,
  type CohostInviteCreated,
  type ControlUpdate,
  type ErrorEvent,
  type JoinAck,
  type PendingCohostInvite,
  type ServerToClientEvents,
  type SessionControlView,
} from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Login = { id: string; email: string; cookie: string };

jest.setTimeout(60_000);

const SUBJECTS = ["e2e-cohost-owner", "e2e-cohost-ta", "e2e-cohost-student", "e2e-cohost-other"];
const SETTLE_MS = 400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("Co-host (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  let owner: Login;
  let ta: Login;
  let student: Login;
  let other: Login;
  const sockets: ClientSocket[] = [];

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: { in: SUBJECTS } } });
    const ids = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId: ids } });
    await prisma.deck.deleteMany({ where: { ownerId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
  }

  const laptop = () => request(a.app.getHttpServer());
  const device = () => request(b.app.getHttpServer());
  const as = (r: request.Test, who: Login) => r.set("Cookie", who.cookie);

  async function liveSession() {
    const deck = await prisma.deck.create({
      data: {
        ownerId: owner.id,
        title: "Co-host deck",
        slides: {
          create: [
            { position: 0, kind: "content", elements: [] },
            { position: 1, kind: "content", elements: [] },
          ],
        },
      },
      include: { slides: { orderBy: { position: "asc" } } },
    });
    const res = await as(laptop().post(`/decks/${deck.id}/sessions`), owner).expect(201);
    return { sessionId: (res.body as { id: string }).id, deckId: deck.id, slides: deck.slides };
  }

  const invite = (sessionId: string, body: { email?: string } = {}) =>
    as(laptop().post(`/sessions/${sessionId}/cohost-invites`), owner).send(body);

  const accept = (who: Login, body: { token: string } | { inviteId: string }) =>
    as(device().post("/cohost-invites/accept"), who).send(body);

  const tokenOf = (created: CohostInviteCreated) => created.url.split("/cohost/")[1];

  async function withCohost() {
    const live = await liveSession();
    const created = (await invite(live.sessionId).expect(201)).body as CohostInviteCreated;
    await accept(ta, { token: tokenOf(created) }).expect(200);
    return live;
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

  async function join(socket: ClientSocket, sessionId: string): Promise<JoinAck> {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(err));
    });
    return new Promise<JoinAck>((resolve) => socket.emit("join", { sessionId }, resolve));
  }

  async function hostScreen(url: string, who: Login, sessionId: string) {
    const socket = connect(url, { role: "host" }, who.cookie);
    const ack = await join(socket, sessionId);
    expect(ack.ok).toBe(true);
    const updates: ControlUpdate[] = [];
    socket.on("control_update", (update) => updates.push(update));
    return { socket, updates };
  }

  async function participant(sessionId: string, userId?: string) {
    const token = randomBytes(32).toString("base64url");
    const row = await prisma.participant.create({
      data: {
        sessionId,
        userId,
        loginType: userId ? "sso" : "guest",
        nickname: `p-${randomBytes(3).toString("hex")}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      },
    });
    return { id: row.id, token };
  }

  const audit = async (sessionId: string) =>
    (
      await prisma.sessionAuditLog.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
        select: { action: true, actorId: true },
      })
    ).map(({ action, actorId }) => [action, actorId]);

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
    await cleanup();
    const auth = a.app.get(AuthService);
    const login = async (subject: string, domain = "kmutt.ac.th"): Promise<Login> => {
      const email = `${subject}@${domain}`;
      const user = await auth.upsertUser({ subject, email, displayName: subject, studentId: null });
      const { token } = await auth.createSession(user);
      return { id: user.id, email, cookie: `host_session=${encodeURIComponent(token)}` };
    };
    [owner, ta, student, other] = await Promise.all([
      login(SUBJECTS[0]),
      login(SUBJECTS[1]),
      login(SUBJECTS[2], "mail.kmutt.ac.th"),
      login(SUBJECTS[3]),
    ]);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  it("invites by KMUTT email: only that account sees and accepts it, from another device", async () => {
    const { sessionId } = await liveSession();
    const laptopScreen = await hostScreen(a.url, owner, sessionId);

    await invite(sessionId, { email: "someone@gmail.com" }).expect(422);
    const created = (await invite(sessionId, { email: ta.email.toUpperCase() }).expect(201))
      .body as CohostInviteCreated;
    expect(created.invite.email).toBe(ta.email);

    // The invited account finds it after login; nobody else does.
    const mine = (await as(device().get("/cohost-invites"), ta).expect(200))
      .body as PendingCohostInvite[];
    expect(mine).toEqual([expect.objectContaining({ id: created.invite.id, sessionId })]);
    expect((await as(device().get("/cohost-invites"), other).expect(200)).body).toEqual([]);

    // Another account cannot use it, not even with the link.
    const wrong = await accept(other, { token: tokenOf(created) }).expect(403);
    expect(wrong.body.error.code).toBe("INVITE_WRONG_ACCOUNT");
    await accept(other, { inviteId: created.invite.id }).expect(403);

    await accept(ta, { inviteId: created.invite.id }).expect(200, { sessionId });
    await wait(SETTLE_MS);
    expect(laptopScreen.updates.map((u) => u.change)).toEqual(["invited", "accepted"]);
    expect(laptopScreen.updates[1].cohost).toMatchObject({
      userId: ta.id,
      displayName: SUBJECTS[1],
    });

    // The co-host's own device joins the room as a host.
    await hostScreen(b.url, ta, sessionId);
    const view = (await as(device().get(`/sessions/${sessionId}/control`), ta).expect(200))
      .body as SessionControlView;
    expect(view).toMatchObject({ role: "cohost", controllerId: owner.id, invite: null });
    await as(device().get(`/sessions/${sessionId}/live`), ta).expect(200);
    await as(device().get(`/sessions/${sessionId}/participants`), ta).expect(200);

    expect(await audit(sessionId)).toEqual([
      ["cohost_invited", owner.id],
      ["cohost_accepted", ta.id],
    ]);
  });

  it("keeps one co-host: a link works once, and a second invite is refused", async () => {
    const { sessionId } = await liveSession();
    const first = (await invite(sessionId).expect(201)).body as CohostInviteCreated;
    // A new invite replaces the one that waits: the old link no longer works.
    const second = (await invite(sessionId).expect(201)).body as CohostInviteCreated;
    expect((await accept(ta, { token: tokenOf(first) }).expect(404)).body.error.code).toBe(
      "INVITE_INVALID",
    );
    // The owner cannot use their own link.
    await as(laptop().post("/cohost-invites/accept"), owner)
      .send({ token: tokenOf(second) })
      .expect(403);

    await accept(ta, { token: tokenOf(second) }).expect(200, { sessionId });
    // One use: after it the link is gone, for everyone.
    await accept(ta, { token: tokenOf(second) }).expect(404);
    await accept(other, { token: tokenOf(second) }).expect(404);
    expect((await invite(sessionId).expect(409)).body.error.code).toBe("COHOST_EXISTS");
  });

  it("lets the co-host moderate Q&A but not run the slides or edit the deck", async () => {
    const { sessionId, deckId, slides } = await withCohost();
    const phone = await participant(sessionId);
    const question = await prisma.question.create({
      data: { sessionId, participantId: phone.id, text: "Why?", anonymous: true },
    });

    await as(device().patch(`/sessions/${sessionId}/questions/${question.id}/status`), ta)
      .send({ action: "answer" })
      .expect(200);

    const move = await as(device().patch(`/sessions/${sessionId}`), ta)
      .send({ currentSlideId: slides[1].id })
      .expect(403);
    expect(move.body.error.code).toBe("NOT_CONTROLLER");
    await as(device().patch(`/sessions/${sessionId}`), ta)
      .send({ status: "ended" })
      .expect(403);
    await as(device().delete(`/sessions/${sessionId}/participants/${phone.id}`), ta).expect(403);
    // Inviting or removing a co-host stays with the owner.
    await as(device().delete(`/sessions/${sessionId}/cohost`), ta).expect(403);

    // Slides belong to the deck, and the deck to the owner only.
    await as(device().get(`/decks/${deckId}`), ta).expect(404);
    await as(device().delete(`/decks/${deckId}/slides/${slides[0].id}`), ta).expect(404);
    expect(await prisma.slide.count({ where: { deckId } })).toBe(2);
  });

  it("hands presenter control over and back, and tells the other screen", async () => {
    const { sessionId, slides } = await withCohost();
    const laptopScreen = await hostScreen(a.url, owner, sessionId);
    const taScreen = await hostScreen(b.url, ta, sessionId);

    const taken = (await as(device().post(`/sessions/${sessionId}/takeovers`), ta).expect(200))
      .body as SessionControlView;
    expect(taken.controllerId).toBe(ta.id);
    await wait(SETTLE_MS);
    expect(laptopScreen.updates.at(-1)).toMatchObject({ change: "takeover", controllerId: ta.id });

    await as(device().patch(`/sessions/${sessionId}`), ta)
      .send({ currentSlideId: slides[1].id })
      .expect(200);
    // The owner's laptop is out of control now, until they take it back.
    await as(laptop().patch(`/sessions/${sessionId}`), owner)
      .send({ currentSlideId: slides[0].id })
      .expect(403);
    // A second take-over changes nothing and logs nothing.
    await as(device().post(`/sessions/${sessionId}/takeovers`), ta).expect(200);

    await as(laptop().post(`/sessions/${sessionId}/takeovers`), owner).expect(200);
    await wait(SETTLE_MS);
    expect(taScreen.updates.at(-1)).toMatchObject({ change: "takeback", controllerId: owner.id });
    await as(laptop().patch(`/sessions/${sessionId}`), owner)
      .send({ currentSlideId: slides[0].id })
      .expect(200);
    await as(device().patch(`/sessions/${sessionId}`), ta)
      .send({ currentSlideId: slides[1].id })
      .expect(403);

    expect(await audit(sessionId)).toEqual([
      ["cohost_invited", owner.id],
      ["cohost_accepted", ta.id],
      ["takeover", ta.id],
      ["takeback", owner.id],
    ]);
  });

  it("refuses every co-host action to a participant, on REST and on the socket", async () => {
    const { sessionId } = await withCohost();
    // A KMUTT student in the session: logged in, and a participant, but no role.
    const phone = await participant(sessionId, student.id);
    const question = await prisma.question.create({
      data: { sessionId, participantId: phone.id, text: "Mine", anonymous: false },
    });
    const both = `${student.cookie}; ${PARTICIPANT_COOKIE}=${phone.token}`;
    const calls = [
      device().get(`/sessions/${sessionId}/control`),
      device().post(`/sessions/${sessionId}/takeovers`),
      device().post(`/sessions/${sessionId}/cohost-invites`).send({}),
      device().delete(`/sessions/${sessionId}/cohost`),
      device().get(`/sessions/${sessionId}/live`),
      device().get(`/sessions/${sessionId}/participants`),
      device().patch(`/sessions/${sessionId}/questions/${question.id}/status`).send({
        action: "hide",
      }),
    ];
    for (const call of calls) await call.set("Cookie", both).expect(404);

    const control = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(control.controllerId).toBeNull();

    // The socket: the host room is closed to them, and the phone hears nothing of control.
    const asHost = connect(b.url, { role: "host" }, student.cookie);
    expect(await join(asHost, sessionId)).toMatchObject({
      ok: false,
      error: { code: "ROOM_FORBIDDEN" },
    });
    const phoneSocket = connect(b.url, { token: phone.token });
    expect((await join(phoneSocket, sessionId)).ok).toBe(true);
    const heard: ControlUpdate[] = [];
    phoneSocket.on("control_update", (u) => heard.push(u));
    await as(device().post(`/sessions/${sessionId}/takeovers`), ta).expect(200);
    await wait(SETTLE_MS);
    expect(heard).toEqual([]);
  });

  it("removes the co-host: control returns to the owner and their screen closes", async () => {
    const { sessionId } = await withCohost();
    const taScreen = await hostScreen(b.url, ta, sessionId);
    const errors: ErrorEvent[] = [];
    taScreen.socket.on("error", (e) => errors.push(e));
    const closed = new Promise<void>((resolve) =>
      taScreen.socket.once("disconnect", () => resolve()),
    );
    await as(device().post(`/sessions/${sessionId}/takeovers`), ta).expect(200);

    await as(laptop().delete(`/sessions/${sessionId}/cohost`), owner).expect(204);
    await closed;
    expect(errors.map((e) => e.code)).toContain("ROOM_FORBIDDEN");
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.controllerId).toBeNull();
    await as(device().get(`/sessions/${sessionId}/control`), ta).expect(404);
    expect((await audit(sessionId)).map(([action]) => action)).toEqual([
      "cohost_invited",
      "cohost_accepted",
      "takeover",
      "cohost_removed",
    ]);
  });

  it("closes invites and take-overs when the session ends", async () => {
    const { sessionId } = await liveSession();
    const created = (await invite(sessionId).expect(201)).body as CohostInviteCreated;
    await as(laptop().patch(`/sessions/${sessionId}`), owner)
      .send({ status: "ended" })
      .expect(200);
    expect((await accept(ta, { token: tokenOf(created) }).expect(409)).body.error.code).toBe(
      "SESSION_ENDED",
    );
    await invite(sessionId).expect(409);
  });
});
