// Host Q&A moderation end to end (F6): the host sees questions live, marks them answered, hides
// them, pins one to the projector, and opens or closes Q&A. Real Postgres and Redis; the host's
// screen on one api instance and the phones on another, as on staging.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PARTICIPANT_COOKIE,
  VOTE_BATCH_MS,
  type ClientToServerEvents,
  type JoinAck,
  type LiveQuestion,
  type LiveSessionView,
  type ParticipantMe,
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
type QuestionEvent = RoomEvent<"question_update">;
type Update = QuestionEvent["data"]["updates"][number];

jest.setTimeout(60_000);

const SUBJECT = "e2e-qa-host";
const OTHER_SUBJECT = "e2e-qa-other-host";
// Long enough for a batch to leave the instance and reach the other one.
const SETTLE_MS = VOTE_BATCH_MS * 4;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("Q&A moderation (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  let host: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  const sockets: ClientSocket[] = [];

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { ssoSubject: { in: [SUBJECT, OTHER_SUBJECT] } },
    });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  const api = () => request(a.app.getHttpServer());
  const phoneApi = () => request(b.app.getHttpServer());
  const asHost = (r: request.Test, who = host) => r.set("Cookie", who.cookie);
  const asPhone = (r: request.Test, token: string) =>
    r.set("Cookie", `${PARTICIPANT_COOKIE}=${token}`);

  async function liveSession(qaEnabled = true): Promise<string> {
    const deck = await prisma.deck.create({
      data: {
        ownerId: host.id,
        title: "Q&A deck",
        qaEnabled,
        slides: { create: [{ position: 0, kind: "content", elements: [] }] },
      },
    });
    const res = await asHost(api().post(`/decks/${deck.id}/sessions`)).expect(201);
    return (res.body as { id: string }).id;
  }

  async function participant(sessionId: string, nickname: string) {
    const token = randomBytes(32).toString("base64url");
    const row = await prisma.participant.create({
      data: {
        sessionId,
        loginType: "guest",
        nickname,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      },
    });
    return { id: row.id, token };
  }

  /** A question straight in the database, past the one-per-20-seconds limit. */
  async function question(sessionId: string, participantId: string, text: string) {
    const row = await prisma.question.create({
      data: { sessionId, participantId, text, anonymous: false },
    });
    return row.id;
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

  async function joined(socket: ClientSocket, sessionId: string) {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (err) => reject(err));
    });
    const ack = await new Promise<JoinAck>((resolve) =>
      socket.emit("join", { sessionId }, resolve),
    );
    expect(ack.ok).toBe(true);
    return socket;
  }

  /** Every Q&A update a socket gets, flattened, and the qa_toggled events. */
  function collect(socket: ClientSocket) {
    const updates: Update[] = [];
    const toggles: RoomEvent<"qa_toggled">["data"][] = [];
    socket.on("question_update", (event) => updates.push(...event.data.updates));
    socket.on("qa_toggled", (event) => toggles.push(event.data));
    return { updates, toggles };
  }

  /** The host's screen on instance A, one phone on instance B. */
  async function room(sessionId: string) {
    const phone = await participant(sessionId, `p-${randomBytes(3).toString("hex")}`);
    const screen = await joined(connect(a.url, { role: "host" }, host.cookie), sessionId);
    const device = await joined(connect(b.url, { token: phone.token }), sessionId);
    return { phone, screen: collect(screen), device: collect(device) };
  }

  const setStatus = (sessionId: string, questionId: string, action: string, who = host) =>
    asHost(api().patch(`/sessions/${sessionId}/questions/${questionId}/status`), who).send({
      action,
    });

  const hostQuestions = async (sessionId: string) => {
    const res = await asHost(api().get(`/sessions/${sessionId}/live`)).expect(200);
    return (res.body as LiveSessionView).questions;
  };

  const studentList = async (sessionId: string, token: string) => {
    const res = await asPhone(phoneApi().get(`/sessions/${sessionId}/questions`), token).expect(
      200,
    );
    return (res.body as { questions: LiveQuestion[] }).questions;
  };

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
    await cleanup();
    const auth = a.app.get(AuthService);
    const login = async (subject: string) => {
      const user = await auth.upsertUser({
        subject,
        email: `${subject}@kmutt.ac.th`,
        displayName: subject,
        studentId: null,
      });
      const { token } = await auth.createSession(user);
      return { id: user.id, cookie: `host_session=${encodeURIComponent(token)}` };
    };
    host = await login(SUBJECT);
    other = await login(OTHER_SUBJECT);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  it("shows a new question to the host live, with no name when it is anonymous", async () => {
    const sessionId = await liveSession();
    const { phone, screen } = await room(sessionId);
    const named = await participant(sessionId, "Named Student");

    await asPhone(phoneApi().post(`/sessions/${sessionId}/questions`), phone.token)
      .send({ text: "Who am I?", anonymous: true })
      .expect(201);
    await asPhone(phoneApi().post(`/sessions/${sessionId}/questions`), named.token)
      .send({ text: "Signed question", anonymous: false })
      .expect(201);
    await wait(SETTLE_MS);

    const created = screen.updates.filter((u) => u.action === "created");
    expect(created).toHaveLength(2);
    const anonymous = created.find((u) => u.question.text === "Who am I?")!.question;
    expect(anonymous).not.toHaveProperty("author");
    expect(JSON.stringify(screen.updates)).not.toContain(phone.id);

    const list = await hostQuestions(sessionId);
    expect(list.find((q) => q.text === "Who am I?")).not.toHaveProperty("author");
    expect(list.find((q) => q.text === "Signed question")?.author).toBe("Named Student");
  });

  it("keeps one pin: pinning another question moves the old pin back, on every screen", async () => {
    const sessionId = await liveSession();
    const { phone, screen, device } = await room(sessionId);
    const q1 = await question(sessionId, phone.id, "First");
    const q2 = await question(sessionId, phone.id, "Second");

    const pinned = await setStatus(sessionId, q1, "pin").expect(200);
    expect((pinned.body as LiveQuestion).status).toBe("highlighted");
    await setStatus(sessionId, q2, "pin").expect(200);
    await wait(SETTLE_MS);

    const statuses = await hostQuestions(sessionId);
    expect(statuses.filter((q) => q.status === "highlighted").map((q) => q.id)).toEqual([q2]);
    for (const seen of [screen, device]) {
      expect(seen.updates.map((u) => u.action === "status" && [u.questionId, u.status])).toEqual([
        [q1, "highlighted"],
        [q1, "visible"],
        [q2, "highlighted"],
      ]);
    }
  });

  it("takes the pinned question off the projector when it is answered", async () => {
    const sessionId = await liveSession();
    const { phone } = await room(sessionId);
    const q1 = await question(sessionId, phone.id, "Pinned then answered");
    await setStatus(sessionId, q1, "pin").expect(200);
    await setStatus(sessionId, q1, "answer").expect(200);

    const list = await hostQuestions(sessionId);
    expect(list.find((q) => q.id === q1)?.status).toBe("answered");
    expect(list.some((q) => q.status === "highlighted")).toBe(false);
    // Answered questions stay in the student list.
    expect((await studentList(sessionId, phone.token)).map((q) => q.id)).toEqual([q1]);
  });

  it("hides a question from the students without sending its text, and shows it again", async () => {
    const sessionId = await liveSession();
    const { phone, screen, device } = await room(sessionId);
    const voter = await participant(sessionId, "Voter");
    const q1 = await question(sessionId, phone.id, "Something rude");

    await setStatus(sessionId, q1, "hide").expect(200);
    await wait(SETTLE_MS);
    expect(await studentList(sessionId, phone.token)).toEqual([]);
    expect(device.updates).toEqual([{ action: "status", questionId: q1, status: "hidden" }]);
    expect(JSON.stringify(device.updates)).not.toContain("Something rude");
    // The host keeps it, to show it again.
    expect((await hostQuestions(sessionId)).find((q) => q.id === q1)?.status).toBe("hidden");
    await asPhone(
      phoneApi().patch(`/sessions/${sessionId}/questions/${q1}/vote`),
      voter.token,
    ).expect(404);

    await setStatus(sessionId, q1, "restore").expect(200);
    await wait(SETTLE_MS);
    expect((await studentList(sessionId, phone.token)).map((q) => q.id)).toEqual([q1]);
    const back = screen.updates.at(-1);
    expect(back).toMatchObject({ action: "status", questionId: q1, status: "visible" });
    expect(back && "question" in back && back.question.text).toBe("Something rude");
  });

  it("sends nothing for a press that changes nothing", async () => {
    const sessionId = await liveSession();
    const { phone, screen } = await room(sessionId);
    const q1 = await question(sessionId, phone.id, "Answered twice");
    await setStatus(sessionId, q1, "answer").expect(200);
    await setStatus(sessionId, q1, "answer").expect(200);
    await wait(SETTLE_MS);
    expect(screen.updates).toHaveLength(1);
  });

  it("closes Q&A: the list stays, asking and voting stop, and it opens again", async () => {
    const sessionId = await liveSession();
    const { phone, screen, device } = await room(sessionId);
    const asker = await participant(sessionId, "Asker");
    const q1 = await question(sessionId, phone.id, "Before the close");

    await asHost(api().patch(`/sessions/${sessionId}`))
      .send({ qaOpen: false })
      .expect(200);
    await wait(SETTLE_MS);
    for (const seen of [screen, device])
      expect(seen.toggles).toEqual([{ open: false, shown: true }]);

    const me = await asPhone(phoneApi().get("/participants/me"), asker.token).expect(200);
    expect(me.body as ParticipantMe).toMatchObject({ qaEnabled: true, qaOpen: false });
    expect((await studentList(sessionId, asker.token)).map((q) => q.id)).toEqual([q1]);
    const ask = await asPhone(phoneApi().post(`/sessions/${sessionId}/questions`), asker.token)
      .send({ text: "After the close", anonymous: true })
      .expect(403);
    expect(ask.body.error.code).toBe("QA_CLOSED");
    await asPhone(
      phoneApi().patch(`/sessions/${sessionId}/questions/${q1}/vote`),
      asker.token,
    ).expect(403);
    // The host can still moderate a closed Q&A.
    await setStatus(sessionId, q1, "answer").expect(200);

    await asHost(api().patch(`/sessions/${sessionId}`))
      .send({ qaOpen: true })
      .expect(200);
    const view = await asHost(api().get(`/sessions/${sessionId}/live`)).expect(200);
    expect((view.body as LiveSessionView).qaOpen).toBe(true);
    await asPhone(phoneApi().post(`/sessions/${sessionId}/questions`), asker.token)
      .send({ text: "After the reopen", anonymous: true })
      .expect(201);
  });

  it("shows no Q&A tab for a deck without Q&A until the host opens it", async () => {
    const sessionId = await liveSession(false);
    const phone = await participant(sessionId, "Tabless");
    const me = () =>
      asPhone(phoneApi().get("/participants/me"), phone.token)
        .expect(200)
        .then((res) => res.body as ParticipantMe);

    expect(await me()).toMatchObject({ qaEnabled: false, qaOpen: false });
    await asPhone(phoneApi().get(`/sessions/${sessionId}/questions`), phone.token).expect(403);

    await asHost(api().patch(`/sessions/${sessionId}`))
      .send({ qaOpen: true })
      .expect(200);
    expect(await me()).toMatchObject({ qaEnabled: true, qaOpen: true });
    await asHost(api().patch(`/sessions/${sessionId}`))
      .send({ qaOpen: false })
      .expect(200);
    // It has been open once: the tab stays, read-only.
    expect(await me()).toMatchObject({ qaEnabled: true, qaOpen: false });
  });

  it("lets only the owner moderate, and only with a known action", async () => {
    const sessionId = await liveSession();
    const phone = await participant(sessionId, "Owner check");
    const q1 = await question(sessionId, phone.id, "Mine to moderate");

    await setStatus(sessionId, q1, "pin", other).expect(404);
    await api()
      .patch(`/sessions/${sessionId}/questions/${q1}/status`)
      .send({ action: "pin" })
      .expect(401);
    await setStatus(sessionId, q1, "delete").expect(422);
    await setStatus(sessionId, "not-a-uuid", "pin").expect(404);
    await asHost(api().patch(`/sessions/${sessionId}`), other)
      .send({ qaOpen: false })
      .expect(404);
    expect((await hostQuestions(sessionId))[0].status).toBe("visible");
  });
});
