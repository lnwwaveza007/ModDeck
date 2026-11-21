// Host participant management end to end (F13, MD-5 §2.5): the live list with online state, rename
// a guest, remove anyone. Removed participants are disconnected, cannot come back with the same
// token, and their answers leave the live results while their rows stay in PostgreSQL for the
// export. Real Postgres and Redis; two api instances behind one Redis, as on staging.

import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PARTICIPANT_COOKIE,
  type AnswerAck,
  type ClientToServerEvents,
  type ErrorEvent,
  type JoinAck,
  type LiveSessionView,
  type ParticipantRow,
  type RoomEvent,
  type ServerToClientEvents,
  type VoteResult,
  type WordResult,
} from "@moddeck/shared";
import type Redis from "ioredis";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";
import { PollStoreService } from "../src/realtime/poll-store.service";
import { REDIS } from "../src/redis/redis.module";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

jest.setTimeout(60_000);

const SUBJECT = "e2e-people-host";
const STUDENT_SUBJECT = "e2e-people-student";

async function startInstance(): Promise<{ app: INestApplication; url: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ["error"] });
  await setupApp(app);
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe("host participant management (e2e)", () => {
  let a: { app: INestApplication; url: string };
  let b: { app: INestApplication; url: string };
  let prisma: PrismaService;
  let redis: Redis;
  let host: { id: string; cookie: string };
  let otherHost: { cookie: string };
  let ssoStudentId: string;
  const sockets: ClientSocket[] = [];

  const api = () => request(a.app.getHttpServer());
  const as = (r: request.Test, cookie = host.cookie) => r.set("Cookie", cookie);

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { ssoSubject: { in: [SUBJECT, `${SUBJECT}-other`, STUDENT_SUBJECT] } },
    });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  /** A session on a deck with a poll (slide 1) and a word cloud (slide 2). */
  async function liveSession() {
    const deck = await prisma.deck.create({
      data: {
        ownerId: host.id,
        title: "People deck",
        slides: {
          create: [
            { position: 0, kind: "content", elements: [] },
            {
              position: 1,
              kind: "poll",
              activity: {
                create: {
                  type: "poll",
                  prompt: "Which layer?",
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
              activity: {
                create: { type: "word_cloud", prompt: "One word?", maxEntriesPerPerson: 3 },
              },
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
    const res = await as(api().post(`/decks/${deck.id}/sessions`)).expect(201);
    return {
      sessionId: (res.body as { id: string }).id,
      pollId: deck.slides[1].activity!.id,
      options: deck.slides[1].activity!.options.map((option) => option.id),
      cloudId: deck.slides[2].activity!.id,
    };
  }

  async function participant(
    sessionId: string,
    { nickname, sso = false }: { nickname?: string; sso?: boolean } = {},
  ) {
    const token = randomBytes(32).toString("base64url");
    const row = await prisma.participant.create({
      data: {
        sessionId,
        loginType: sso ? "sso" : "guest",
        userId: sso ? ssoStudentId : null,
        nickname: nickname ?? `p-${token.slice(0, 8)}`,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      },
    });
    return { token, participantId: row.id, cookie: `${PARTICIPANT_COOKIE}=${token}` };
  }

  function socketOf(url: string, auth: Record<string, string>, cookie?: string): ClientSocket {
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

  /** A phone on instance B. */
  const phone = (sessionId: string, token: string) => joined(socketOf(b.url, { token }), sessionId);

  /** Presenter control on instance A. */
  const hostScreen = (sessionId: string) =>
    joined(socketOf(a.url, { role: "host" }, host.cookie), sessionId);

  /** Waits for the first event of this name that passes `match`. */
  function nextEvent<T>(
    socket: ClientSocket,
    event: string,
    match: (payload: T) => boolean = () => true,
  ): Promise<T> {
    return new Promise((resolve) => {
      const on = socket.on as (event: string, cb: (payload: T) => void) => void;
      const off = socket.off as (event: string, cb: (payload: T) => void) => void;
      const listener = (payload: T) => {
        if (!match(payload)) return;
        off.call(socket, event, listener);
        resolve(payload);
      };
      on.call(socket, event, listener);
    });
  }

  const list = async (sessionId: string) =>
    (await as(api().get(`/sessions/${sessionId}/participants`)).expect(200))
      .body as ParticipantRow[];

  const rename = (sessionId: string, participantId: string, nickname: string) =>
    as(api().patch(`/sessions/${sessionId}/participants/${participantId}`)).send({ nickname });

  const remove = (sessionId: string, participantId: string) =>
    as(api().delete(`/sessions/${sessionId}/participants/${participantId}`));

  const act = (sessionId: string, activityId: string, action: string) =>
    as(api().patch(`/sessions/${sessionId}/activities/${activityId}`))
      .send({ action })
      .expect(200);

  const start = async (sessionId: string, activityId: string) =>
    (await act(sessionId, activityId, "start")).body.activityRunId as string;

  const vote = (socket: ClientSocket, activityRunId: string, optionId: string) =>
    new Promise<AnswerAck<VoteResult>>((resolve) =>
      socket.emit(
        "vote",
        { activityRunId, optionIds: [optionId], answerId: randomUUID() },
        resolve,
      ),
    );

  const word = (socket: ClientSocket, activityRunId: string, text: string) =>
    new Promise<AnswerAck<WordResult>>((resolve) =>
      socket.emit("word", { activityRunId, text, answerId: randomUUID() }, resolve),
    );

  const liveView = async (sessionId: string) =>
    (await as(api().get(`/sessions/${sessionId}/live`)).expect(200)).body as LiveSessionView;

  beforeAll(async () => {
    [a, b] = await Promise.all([startInstance(), startInstance()]);
    prisma = a.app.get(PrismaService);
    redis = a.app.get(REDIS);
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
    otherHost = await login(`${SUBJECT}-other`);
    ssoStudentId = (await login(STUDENT_SUBJECT)).id;
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([a.app.close(), b.app.close()]);
  });

  describe("the list", () => {
    it("shows who joined, guest or KMUTT, and who is online", async () => {
      const { sessionId } = await liveSession();
      const guest = await participant(sessionId, { nickname: "Ploy" });
      const sso = await participant(sessionId, { nickname: "Somchai K", sso: true });
      await phone(sessionId, guest.token);

      const rows = await list(sessionId);
      expect(rows).toEqual([
        expect.objectContaining({
          id: guest.participantId,
          nickname: "Ploy",
          loginType: "guest",
          online: true,
        }),
        expect.objectContaining({
          id: sso.participantId,
          nickname: "Somchai K",
          loginType: "sso",
          online: false,
        }),
      ]);
    });

    it("tells the host's screens when a phone comes online and when its last tab closes", async () => {
      const { sessionId } = await liveSession();
      const screen = await hostScreen(sessionId);
      const { token, participantId } = await participant(sessionId, { nickname: "Mint" });
      const mine = (online: boolean) => (row: ParticipantRow) =>
        row.id === participantId && row.online === online;

      const cameOnline = nextEvent<ParticipantRow>(screen, "participant_update", mine(true));
      const first = await phone(sessionId, token);
      expect(await cameOnline).toMatchObject({ nickname: "Mint", loginType: "guest" });

      // A second tab of the same phone: closing one of them keeps the student online.
      const second = await phone(sessionId, token);
      const stillOnline = nextEvent<ParticipantRow>(screen, "participant_update", mine(true));
      first.disconnect();
      await stillOnline;

      const wentOffline = nextEvent<ParticipantRow>(screen, "participant_update", mine(false));
      second.disconnect();
      await wentOffline;
      expect((await list(sessionId))[0].online).toBe(false);
    });

    it("belongs to the session's owner only", async () => {
      const { sessionId } = await liveSession();
      await as(api().get(`/sessions/${sessionId}/participants`), otherHost.cookie).expect(404);
      await api().get(`/sessions/${sessionId}/participants`).expect(401);
    });
  });

  describe("rename", () => {
    it("changes a guest's name on their phone, the host's screens and /participants/me", async () => {
      const { sessionId } = await liveSession();
      const { token, participantId, cookie } = await participant(sessionId, { nickname: "Rude" });
      const device = await phone(sessionId, token);
      const screen = await hostScreen(sessionId);

      const told = nextEvent<{ nickname: string }>(device, "renamed");
      const listed = nextEvent<ParticipantRow>(
        screen,
        "participant_update",
        (row) => row.id === participantId && row.nickname === "Guest Seven",
      );
      const res = await rename(sessionId, participantId, "  Guest  Seven ").expect(200);
      // Trimmed and with single spaces, as a nickname typed at join.
      expect(res.body).toMatchObject({ id: participantId, nickname: "Guest Seven", online: true });
      expect(await told).toEqual({ nickname: "Guest Seven" });
      expect(await listed).toMatchObject({ online: true, loginType: "guest" });
      const me = await api().get("/participants/me").set("Cookie", cookie).expect(200);
      expect(me.body.nickname).toBe("Guest Seven");
    });

    it("keeps the join rules for the new name", async () => {
      const { sessionId } = await liveSession();
      const { participantId } = await participant(sessionId, { nickname: "Fern" });
      await participant(sessionId, { nickname: "Ploy" });

      const tooShort = await rename(sessionId, participantId, "x").expect(422);
      expect(tooShort.body.error.code).toBe("NICKNAME_INVALID");
      const staff = await rename(sessionId, participantId, "Teacher").expect(422);
      expect(staff.body.error.details.fields.nickname).toBe("RESERVED");
      const taken = await rename(sessionId, participantId, "ploy").expect(409);
      expect(taken.body.error.code).toBe("NICKNAME_TAKEN");

      // A different case of their own name is not "taken".
      await rename(sessionId, participantId, "FERN").expect(200);
    });

    it("refuses a KMUTT participant: they show their KMUTT name", async () => {
      const { sessionId } = await liveSession();
      const { participantId } = await participant(sessionId, { nickname: "Somchai K", sso: true });
      const res = await rename(sessionId, participantId, "Somebody").expect(409);
      expect(res.body.error.code).toBe("NOT_A_GUEST");
    });

    it("refuses another host, an unknown participant and an ended session", async () => {
      const { sessionId } = await liveSession();
      const { participantId } = await participant(sessionId);
      await as(
        api().patch(`/sessions/${sessionId}/participants/${participantId}`),
        otherHost.cookie,
      )
        .send({ nickname: "Hacker" })
        .expect(404);
      await rename(sessionId, randomUUID(), "Nobody").expect(404);
      await rename(sessionId, "not-a-uuid", "Nobody").expect(404);

      await as(api().patch(`/sessions/${sessionId}`))
        .send({ status: "ended" })
        .expect(200);
      const ended = await rename(sessionId, participantId, "Later").expect(409);
      expect(ended.body.error.code).toBe("SESSION_ENDED");
    });
  });

  describe("remove", () => {
    it("disconnects every socket of the participant and keeps the same token out", async () => {
      const { sessionId } = await liveSession();
      const { token, participantId, cookie } = await participant(sessionId, { nickname: "Spam" });
      const device = await phone(sessionId, token);
      const screen = await hostScreen(sessionId);

      const told = nextEvent<ErrorEvent>(device, "error");
      const closed = nextEvent<string>(device, "disconnect");
      const left = nextEvent<{ participantId: string }>(screen, "participant_removed");
      await remove(sessionId, participantId).expect(204);

      expect((await told).code).toBe("PARTICIPANT_REMOVED");
      expect(await closed).toBe("io server disconnect");
      expect(await left).toEqual({ participantId });
      expect((await list(sessionId)).map((row) => row.id)).not.toContain(participantId);

      // The same token: the socket handshake, /participants/me and the join all refuse it.
      const again = socketOf(a.url, { token });
      const refused = await connected(again).then(
        () => null,
        (err: Error & { data?: { code: string } }) => err.data?.code,
      );
      expect(refused).toBe("PARTICIPANT_REMOVED");
      const me = await api().get("/participants/me").set("Cookie", cookie).expect(403);
      expect(me.body.error.code).toBe("PARTICIPANT_REMOVED");
      const { pin } = (await as(api().get(`/sessions/${sessionId}`)).expect(200)).body as {
        pin: string;
      };
      const rejoin = await api()
        .post(`/pins/${pin}/participants`)
        .set("Cookie", cookie)
        .send({ nickname: "Spam" })
        .expect(403);
      expect(rejoin.body.error.code).toBe("PARTICIPANT_REMOVED");

      // Sending it again is harmless.
      await remove(sessionId, participantId).expect(204);
    });

    it("keeps a KMUTT student out on another device too", async () => {
      const { sessionId } = await liveSession();
      const { participantId } = await participant(sessionId, { nickname: "Somchai K", sso: true });
      await remove(sessionId, participantId).expect(204);
      const row = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } });
      expect(row.status).toBe("removed");
    });

    it("refuses another host and an ended session", async () => {
      const { sessionId } = await liveSession();
      const { participantId } = await participant(sessionId);
      await as(
        api().delete(`/sessions/${sessionId}/participants/${participantId}`),
        otherHost.cookie,
      ).expect(404);
      await remove(sessionId, randomUUID()).expect(404);
      await as(api().patch(`/sessions/${sessionId}`))
        .send({ status: "ended" })
        .expect(200);
      expect((await remove(sessionId, participantId).expect(409)).body.error.code).toBe(
        "SESSION_ENDED",
      );
    });
  });

  describe("answers of a removed participant", () => {
    it("leave the live poll counts at once and stay in PostgreSQL", async () => {
      const { sessionId, pollId, options } = await liveSession();
      const runId = await start(sessionId, pollId);
      const kept = await participant(sessionId);
      const gone = await participant(sessionId);
      await vote(await phone(sessionId, kept.token), runId, options[0]);
      await vote(await phone(sessionId, gone.token), runId, options[1]);
      const screen = await hostScreen(sessionId);

      // Batches of the two votes may still be on their way: wait for the count without them.
      const update = nextEvent<RoomEvent<"vote_update">>(
        screen,
        "vote_update",
        (event) => event.data.activityRunId === runId && event.data.answered === 1,
      );
      await remove(sessionId, gone.participantId).expect(204);
      expect((await update).data).toMatchObject({
        activityRunId: runId,
        answered: 1,
        votes: { [options[0]]: 1, [options[1]]: 0 },
      });

      await act(sessionId, pollId, "stop");
      // The row stays for the export, marked by the participant's status.
      const rows = await prisma.answer.findMany({
        where: { activityRunId: runId },
        select: { participant: { select: { status: true } } },
      });
      expect(rows.map((row) => row.participant.status).sort()).toEqual(["active", "removed"]);

      // Redis lost the run (a restart, or the session ended): the counts from PostgreSQL agree.
      await redis.del(`run:{${sessionId}}:${runId}`, `ans:{${sessionId}}:${runId}`);
      await redis.del(`votes:{${sessionId}}:${runId}`);
      const { tallies } = await liveView(sessionId);
      expect(tallies[runId]).toEqual({ votes: { [options[0]]: 1 }, answered: 1 });
      await act(sessionId, pollId, "reopen");
      const reloaded = (await liveView(sessionId)).tallies[runId];
      expect(reloaded).toMatchObject({ answered: 1, votes: { [options[0]]: 1, [options[1]]: 0 } });
    });

    it("leave the word cloud, and a word only they sent is gone", async () => {
      const { sessionId, cloudId } = await liveSession();
      const runId = await start(sessionId, cloudId);
      const kept = await phone(sessionId, (await participant(sessionId)).token);
      const gone = await participant(sessionId);
      const goneSocket = await phone(sessionId, gone.token);
      await word(kept, runId, "kite");
      await word(goneSocket, runId, "kite");
      await word(goneSocket, runId, "rude");
      const screen = await hostScreen(sessionId);

      const update = nextEvent<RoomEvent<"word_update">>(
        screen,
        "word_update",
        (event) => event.data.activityRunId === runId && event.data.entries === 1,
      );
      await remove(sessionId, gone.participantId).expect(204);
      const { data } = await update;
      expect(data.entries).toBe(1);
      expect(data.words).toEqual([expect.objectContaining({ key: "kite", count: 1 })]);

      await act(sessionId, cloudId, "stop");
      expect(await prisma.wordEntry.count({ where: { activityRunId: runId } })).toBe(3);
    });

    it("cannot be counted once the removal has started, even when already on the way", async () => {
      const { sessionId, pollId, options } = await liveSession();
      const runId = await start(sessionId, pollId);
      const gone = await participant(sessionId);
      // The step that counts a vote is the one that refuses it.
      const polls = b.app.get(PollStoreService);
      await polls.markRemoved(sessionId, gone.participantId);
      const outcome = await polls.submit(
        sessionId,
        gone.participantId,
        runId,
        options[0],
        randomUUID(),
      );
      expect(outcome).toEqual({ status: "removed" });
      expect((await liveView(sessionId)).tallies[runId].answered).toBe(0);
    });
  });
});
