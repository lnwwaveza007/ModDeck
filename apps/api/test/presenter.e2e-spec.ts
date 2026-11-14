// Presenter control end to end: the host moves slides and runs activities from one screen, and
// every connected screen (audience screen, student phones) follows over the socket. Real
// Postgres and Redis; two api instances behind one Redis, as on staging.

import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type {
  ActivityRunDto,
  ClientToServerEvents,
  ErrorBody,
  JoinAck,
  LiveSessionView,
  RoomEvent,
  RoomEventType,
  ServerToClientEvents,
} from "@moddeck/shared";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

jest.setTimeout(30_000);

const SUBJECTS = ["e2e-presenter-host-a", "e2e-presenter-host-b"];
// What the ticket asks on staging. Locally the same path takes a few ms.
const FOLLOW_BUDGET_MS = 150;

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("presenter control (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  let hostA: { id: string; cookie: string };
  let hostB: { id: string; cookie: string };
  const sockets: ClientSocket[] = [];

  async function login(subject: string) {
    const auth = a.app.get(AuthService);
    const user = await auth.upsertUser({
      subject,
      email: `${subject}@kmutt.ac.th`,
      displayName: subject,
      studentId: null,
    });
    const { token } = await auth.createSession(user);
    return { id: user.id, cookie: `host_session=${encodeURIComponent(token)}` };
  }

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: { in: SUBJECTS } } });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  const api = () => request(a.app.getHttpServer());
  const as = (host: { cookie: string }, r: request.Test) => r.set("Cookie", host.cookie);

  // A deck with a content slide, a poll and a word cloud, and a live session of it.
  async function liveSession(owner = hostA) {
    const deck = await prisma.deck.create({
      data: {
        ownerId: owner.id,
        title: "Presenter deck",
        slides: {
          create: [
            { position: 0, kind: "content", elements: [] },
            {
              position: 1,
              kind: "poll",
              activity: {
                create: {
                  type: "poll",
                  prompt: "Which one?",
                  options: {
                    create: [
                      { position: 0, label: "Alpha" },
                      { position: 1, label: "Beta" },
                    ],
                  },
                },
              },
            },
            {
              position: 2,
              kind: "word_cloud",
              activity: { create: { type: "word_cloud", prompt: "One word?" } },
            },
          ],
        },
      },
      include: {
        slides: {
          orderBy: { position: "asc" },
          include: { activity: { include: { options: { orderBy: { position: "asc" } } } } },
        },
      },
    });
    const res = await as(owner, api().post(`/decks/${deck.id}/sessions`)).expect(201);
    const sessionId = (res.body as { id: string }).id;
    return {
      deck,
      sessionId,
      poll: deck.slides[1].activity!,
      cloud: deck.slides[2].activity!,
    };
  }

  async function participantToken(sessionId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await prisma.participant.create({
      data: {
        sessionId,
        loginType: "guest",
        nickname: `p-${token.slice(0, 8)}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      },
    });
    return token;
  }

  function connect(url: string, auth: Record<string, string>, cookie?: string): ClientSocket {
    const socket: ClientSocket = io(url, {
      transports: ["websocket"],
      reconnection: false,
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

  function connectError(socket: ClientSocket): Promise<ErrorBody> {
    return new Promise((resolve, reject) => {
      socket.once("connect", () => reject(new Error("socket connected")));
      socket.once("connect_error", (err) => resolve((err as Error & { data: ErrorBody }).data));
    });
  }

  function join(socket: ClientSocket, sessionId: string): Promise<JoinAck> {
    return new Promise((resolve) => socket.emit("join", { sessionId }, resolve));
  }

  function next<T extends RoomEventType>(socket: ClientSocket, type: T): Promise<RoomEvent<T>> {
    return new Promise((resolve) =>
      (socket.once as (event: string, cb: (e: RoomEvent<T>) => void) => void)(type, resolve),
    );
  }

  // The host's two screens on instance A and a student phone on instance B, all in the room.
  async function room(sessionId: string) {
    // The token first: a socket that is already connecting would finish its handshake while the
    // insert runs, and `connected()` would then wait for a `connect` event that already happened.
    const token = await participantToken(sessionId);
    const screen = connect(a.url, { role: "host" }, hostA.cookie);
    const phone = connect(b.url, { token });
    await Promise.all([connected(screen), connected(phone)]);
    expect((await join(screen, sessionId)).ok).toBe(true);
    expect((await join(phone, sessionId)).ok).toBe(true);
    return { screen, phone };
  }

  const act = (sessionId: string, activityId: string, body: object) =>
    as(hostA, api().patch(`/sessions/${sessionId}/activities/${activityId}`)).send(body);

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
    await cleanup();
    hostA = await login(SUBJECTS[0]);
    hostB = await login(SUBJECTS[1]);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await cleanup();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  describe("host socket", () => {
    it("joins the room of an own session with the host login", async () => {
      const { sessionId } = await liveSession();
      const socket = connect(a.url, { role: "host" }, hostA.cookie);
      await connected(socket);
      const ack = await join(socket, sessionId);
      expect(ack).toMatchObject({ ok: true, mode: "snapshot" });
    });

    it("cannot join another host's session", async () => {
      const { sessionId } = await liveSession();
      const socket = connect(a.url, { role: "host" }, hostB.cookie);
      await connected(socket);
      const ack = await join(socket, sessionId);
      expect(ack).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "ROOM_FORBIDDEN" }),
      });
    });

    it("is refused without a host login", async () => {
      const socket = connect(a.url, { role: "host" });
      expect(await connectError(socket)).toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("slides", () => {
    it(`every screen follows a slide change within ${FOLLOW_BUDGET_MS} ms`, async () => {
      const { deck, sessionId } = await liveSession();
      const { screen, phone } = await room(sessionId);

      const target = deck.slides[2];
      const sentAt = Date.now();
      const onScreen = next(screen, "slide_changed").then((e) => ({ e, at: Date.now() }));
      const onPhone = next(phone, "slide_changed").then((e) => ({ e, at: Date.now() }));
      await as(hostA, api().patch(`/sessions/${sessionId}`))
        .send({ currentSlideId: target.id })
        .expect(200, { currentSlideId: target.id, index: 2 });

      for (const { e, at } of await Promise.all([onScreen, onPhone])) {
        expect(e.data).toMatchObject({ slideId: target.id, index: 2 });
        expect(at - sentAt).toBeLessThan(FOLLOW_BUDGET_MS);
      }
      const view = (await as(hostA, api().get(`/sessions/${sessionId}/live`)).expect(200))
        .body as LiveSessionView;
      expect(view.currentSlideId).toBe(target.id);
    });

    it("refuses a slide of another deck", async () => {
      const { sessionId } = await liveSession();
      const other = await liveSession();
      await as(hostA, api().patch(`/sessions/${sessionId}`))
        .send({ currentSlideId: other.deck.slides[0].id })
        .expect(422);
    });

    it("hides another host's session", async () => {
      const { deck, sessionId } = await liveSession();
      await as(hostB, api().patch(`/sessions/${sessionId}`))
        .send({ currentSlideId: deck.slides[1].id })
        .expect(404);
      await as(hostB, api().get(`/sessions/${sessionId}/live`)).expect(404);
    });

    it("never starts an activity when its slide is shown", async () => {
      const { deck, sessionId } = await liveSession();
      await as(hostA, api().patch(`/sessions/${sessionId}`))
        .send({ currentSlideId: deck.slides[1].id })
        .expect(200);
      const view = (await as(hostA, api().get(`/sessions/${sessionId}/live`)).expect(200))
        .body as LiveSessionView;
      expect(view.runs).toEqual([]);
    });
  });

  describe("live view", () => {
    it("gives the slides with activities and options", async () => {
      const { sessionId, poll } = await liveSession();
      const view = (await as(hostA, api().get(`/sessions/${sessionId}/live`)).expect(200))
        .body as LiveSessionView;
      expect(view.slides.map((s) => s.kind)).toEqual(["content", "poll", "word_cloud"]);
      expect(view.slides[1].activity).toEqual({
        id: poll.id,
        type: "poll",
        prompt: "Which one?",
        allowAnswerChange: false,
        maxEntries: 1,
        options: poll.options.map(({ id, label }) => ({ id, label })),
      });
      expect(view.currentSlideId).toBe(view.slides[0].id);
    });
  });

  describe("activities", () => {
    it("starts, stops, shows results and reopens from one screen", async () => {
      const { sessionId, poll } = await liveSession();
      const { screen, phone } = await room(sessionId);

      const steps: [string, string][] = [
        ["start", "live"],
        ["stop", "closed"],
        ["show_results", "results_shown"],
        ["reopen", "live"],
        ["show_results", "results_shown"],
      ];
      for (const [action, state] of steps) {
        const seen = Promise.all([next(screen, "activity_state"), next(phone, "activity_state")]);
        const res = await act(sessionId, poll.id, { action }).expect(200);
        expect((res.body as ActivityRunDto).state).toBe(state);
        for (const event of await seen) {
          expect(event.data).toMatchObject({ activityId: poll.id, state, endsAt: null });
        }
      }
      const run = await prisma.activityRun.findUniqueOrThrow({
        where: { sessionId_activityId: { sessionId, activityId: poll.id } },
      });
      expect(run.firstOpenedAt).not.toBeNull();
      expect(run.lastReopenedAt).not.toBeNull();
      expect(run.closedAt).not.toBeNull();
    });

    it("refuses a move the state does not allow", async () => {
      const { sessionId, poll } = await liveSession();
      const res = await act(sessionId, poll.id, { action: "stop" }).expect(409);
      expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION" });
      await act(sessionId, poll.id, { action: "start" }).expect(200);
      await act(sessionId, poll.id, { action: "start" }).expect(409);
    });

    it("refuses an activity of another deck", async () => {
      const { sessionId } = await liveSession();
      const other = await liveSession();
      await act(sessionId, other.poll.id, { action: "start" }).expect(404);
      await act(sessionId, randomUUID(), { action: "start" }).expect(404);
    });

    it("stops an activity by itself when its countdown ends", async () => {
      const { sessionId, cloud } = await liveSession();
      const { phone } = await room(sessionId);
      const closedEvent = new Promise<RoomEvent<"activity_state">>((resolve) =>
        phone.on("activity_state", (event) => {
          if (event.data.state === "closed") resolve(event);
        }),
      );
      const res = await act(sessionId, cloud.id, { action: "start", durationSeconds: 5 }).expect(
        200,
      );
      const { endsAt } = res.body as ActivityRunDto;
      expect(endsAt).toBeGreaterThan(Date.now() + 4000);

      const closed = await closedEvent;
      expect(closed.data).toMatchObject({ activityId: cloud.id, state: "closed", endsAt: null });
      expect(Date.now()).toBeGreaterThanOrEqual(endsAt! - 50);
    });

    it("stops a countdown that passed while no timer ran", async () => {
      const { sessionId, poll } = await liveSession();
      await act(sessionId, poll.id, { action: "start", durationSeconds: 60 }).expect(200);
      // As if the api restarted after the end time.
      await prisma.activityRun.updateMany({
        where: { sessionId, activityId: poll.id },
        data: { endsAt: new Date(Date.now() - 1000) },
      });
      const view = (await as(hostA, api().get(`/sessions/${sessionId}/live`)).expect(200))
        .body as LiveSessionView;
      expect(view.runs).toEqual([expect.objectContaining({ state: "closed", endsAt: null })]);
    });

    it("takes a timer on start or reopen only", async () => {
      const { sessionId, poll } = await liveSession();
      await act(sessionId, poll.id, { action: "start" }).expect(200);
      await act(sessionId, poll.id, { action: "stop", durationSeconds: 30 }).expect(422);
    });
  });

  describe("editing during a live session", () => {
    const editPoll = (deckId: string, slideId: string, body: object) =>
      as(hostA, api().patch(`/decks/${deckId}/slides/${slideId}/activity`)).send(body);

    it("allows wording edits after start and tells the room", async () => {
      const { deck, sessionId, poll } = await liveSession();
      const { phone } = await room(sessionId);
      await act(sessionId, poll.id, { action: "start" }).expect(200);

      const edited = next(phone, "activity_edited");
      const options = poll.options.map(({ id }, i) => ({ id, label: `Fixed ${i}` }));
      await editPoll(deck.id, deck.slides[1].id, { prompt: "Which one, really?", options }).expect(
        200,
      );
      expect((await edited).data).toEqual({
        activityId: poll.id,
        prompt: "Which one, really?",
        options: options.map(({ id, label }) => ({ id, label })),
        maxEntries: 1,
      });
    });

    it("blocks adding, removing or reordering options after start", async () => {
      const { deck, sessionId, poll } = await liveSession();
      await act(sessionId, poll.id, { action: "start" }).expect(200);
      const [first, second] = poll.options;
      const slideId = deck.slides[1].id;

      const added = await editPoll(deck.id, slideId, {
        prompt: "Q",
        options: [{ id: first.id, label: "A" }, { id: second.id, label: "B" }, { label: "C" }],
      }).expect(409);
      expect(added.body.error).toMatchObject({ code: "ACTIVITY_LOCKED" });
      await editPoll(deck.id, slideId, {
        prompt: "Q",
        options: [
          { id: second.id, label: "B" },
          { id: first.id, label: "A" },
        ],
      }).expect(409);
    });

    it("refuses a list that repeats an option id, and keeps the poll whole", async () => {
      const { deck, poll } = await liveSession();
      const [first] = poll.options;
      await editPoll(deck.id, deck.slides[1].id, {
        prompt: "Q",
        options: [
          { id: first.id, label: "A" },
          { id: first.id, label: "A again" },
        ],
      }).expect(422);

      const stored = await prisma.activityOption.count({ where: { activityId: poll.id } });
      expect(stored).toBe(2);
    });

    it("allows option changes before the activity starts", async () => {
      const { deck, poll } = await liveSession();
      const [first, second] = poll.options;
      const res = await editPoll(deck.id, deck.slides[1].id, {
        prompt: "Q",
        options: [{ id: second.id, label: "B" }, { id: first.id, label: "A" }, { label: "C" }],
      }).expect(200);
      expect(res.body.options.map((o: { label: string }) => o.label)).toEqual(["B", "A", "C"]);
    });

    it("blocks deleting an activity slide while the deck has a live session", async () => {
      const { deck, sessionId } = await liveSession();
      const res = await as(
        hostA,
        api().delete(`/decks/${deck.id}/slides/${deck.slides[2].id}`),
      ).expect(409);
      expect(res.body.error).toMatchObject({ code: "ACTIVITY_LOCKED" });

      // Content slides are not locked.
      await as(hostA, api().delete(`/decks/${deck.id}/slides/${deck.slides[0].id}`)).expect(204);

      await prisma.session.update({
        where: { id: sessionId },
        data: { status: "ended", endedAt: new Date() },
      });
      await as(hostA, api().delete(`/decks/${deck.id}/slides/${deck.slides[2].id}`)).expect(204);
    });
  });
});
