// Session history end to end (F10): the host's past sessions, the results of each activity read
// from PostgreSQL, and deleting a past session. Real Postgres and Redis.

import { randomBytes, randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { LiveSessionView, SessionResults, SessionSummary } from "@moddeck/shared";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { hashToken } from "../src/realtime/participant-token";

jest.setTimeout(60_000);

const SUBJECT = "e2e-history-host";
const OTHER_SUBJECT = "e2e-history-other-host";

describe("Session history (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let host: { id: string; cookie: string };
  let other: { id: string; cookie: string };

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { ssoSubject: { in: [SUBJECT, OTHER_SUBJECT] } },
    });
    const ownerId = { in: users.map((u) => u.id) };
    await prisma.session.deleteMany({ where: { ownerId } });
    await prisma.deck.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }

  const api = () => request(app.getHttpServer());
  const as = (r: request.Test, who = host) => r.set("Cookie", who.cookie);

  /** A deck with a content slide, a poll, a word cloud and a second poll that never runs. */
  async function deck(title = "History deck") {
    return prisma.deck.create({
      data: {
        ownerId: host.id,
        title,
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
              activity: {
                create: { type: "word_cloud", prompt: "One word?", maxEntriesPerPerson: 3 },
              },
            },
            {
              position: 3,
              kind: "poll",
              activity: {
                create: {
                  type: "poll",
                  prompt: "Exit poll",
                  options: {
                    create: [
                      { position: 0, label: "Yes" },
                      { position: 1, label: "No" },
                    ],
                  },
                },
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
  }

  async function participant(sessionId: string, nickname: string) {
    return prisma.participant.create({
      data: {
        sessionId,
        loginType: "guest",
        nickname,
        tokenHash: hashToken(randomBytes(32).toString("base64url")),
        tokenExpiresAt: new Date(Date.now() + 8 * 3600_000),
      },
    });
  }

  /**
   * A session that ran the poll and the word cloud, with Q&A. Answers go straight into
   * PostgreSQL, as the flush leaves them. One participant is removed: the room stopped counting
   * them, and so must history.
   */
  async function pastSession() {
    const d = await deck();
    const res = await as(api().post(`/decks/${d.id}/sessions`)).expect(201);
    const sessionId = (res.body as { id: string }).id;
    const poll = d.slides[1].activity!;
    const cloud = d.slides[2].activity!;
    const [alpha, beta] = poll.options;

    const [p1, p2, p3, removed] = await Promise.all([
      participant(sessionId, "Mint"),
      participant(sessionId, "Ploy"),
      participant(sessionId, "Krit"),
      participant(sessionId, "Gone"),
    ]);
    await prisma.participant.update({ where: { id: removed.id }, data: { status: "removed" } });

    const pollRun = await prisma.activityRun.create({
      data: { sessionId, activityId: poll.id, state: "closed", firstOpenedAt: new Date() },
    });
    const cloudRun = await prisma.activityRun.create({
      data: { sessionId, activityId: cloud.id, state: "results_shown", firstOpenedAt: new Date() },
    });
    const answeredAt = new Date();
    await prisma.answer.createMany({
      data: [
        { activityRunId: pollRun.id, participantId: p1.id, optionId: alpha.id, answeredAt },
        { activityRunId: pollRun.id, participantId: p2.id, optionId: alpha.id, answeredAt },
        { activityRunId: pollRun.id, participantId: p3.id, optionId: beta.id, answeredAt },
        { activityRunId: pollRun.id, participantId: removed.id, optionId: beta.id, answeredAt },
      ],
    });
    // Distinct times: the first spelling of a word is the one shown.
    let at = Date.now();
    const word = (participantId: string, text: string, hidden = false) => ({
      id: randomUUID(),
      activityRunId: cloudRun.id,
      participantId,
      text,
      normalizedText: text.toLowerCase(),
      hidden,
      createdAt: new Date((at += 1000)),
    });
    await prisma.wordEntry.createMany({
      data: [
        word(p1.id, "Fun"),
        word(p2.id, "fun"),
        word(p3.id, "hard"),
        word(p3.id, "rude", true),
        word(removed.id, "spam"),
      ],
    });

    const ask = (participantId: string, text: string, anonymous: boolean, status = "visible") =>
      prisma.question.create({
        data: {
          sessionId,
          participantId,
          text,
          anonymous,
          status: status as "visible" | "answered" | "hidden" | "deleted",
        },
      });
    const secret = await ask(p1.id, "Anonymous ask", true);
    await ask(p2.id, "Signed ask", false, "answered");
    await ask(p3.id, "Hidden ask", false, "hidden");
    await ask(p3.id, "Deleted ask", false, "deleted");
    await prisma.questionVote.createMany({
      data: [
        { questionId: secret.id, participantId: p2.id },
        { questionId: secret.id, participantId: p3.id },
      ],
    });

    return { deck: d, sessionId, poll, cloud, alpha, beta, secretAuthor: p1 };
  }

  const end = (sessionId: string) =>
    as(api().patch(`/sessions/${sessionId}`))
      .send({ status: "ended" })
      .expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ["error"] });
    await setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await cleanup();
    const auth = app.get(AuthService);
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

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it("lists the host's sessions newest first, deleted decks included, and no one else's", async () => {
    const first = await pastSession();
    await end(first.sessionId);
    const second = await pastSession();
    await end(second.sessionId);
    await as(api().delete(`/decks/${second.deck.id}`)).expect(204);

    const res = await as(api().get("/sessions")).expect(200);
    const list = res.body as SessionSummary[];
    const ids = list.map((s) => s.id);
    expect(ids.indexOf(second.sessionId)).toBeLessThan(ids.indexOf(first.sessionId));

    const row = list.find((s) => s.id === second.sessionId)!;
    expect(row).toMatchObject({
      status: "ended",
      deck: { id: second.deck.id, title: "History deck", deleted: true },
      // Four joined, one was removed.
      participantCount: 3,
    });
    expect(row.endedAt).not.toBeNull();
    expect(row).not.toHaveProperty("pin");

    const theirs = await as(api().get("/sessions"), other).expect(200);
    expect(theirs.body).toEqual([]);
  });

  it("refuses results while the session is open, then shows them from PostgreSQL", async () => {
    const s = await pastSession();
    const live = await as(api().get(`/sessions/${s.sessionId}/results`)).expect(409);
    expect(live.body.error.code).toBe("SESSION_LIVE");

    await end(s.sessionId);
    const res = await as(api().get(`/sessions/${s.sessionId}/results`)).expect(200);
    const results = res.body as SessionResults;

    expect(results.activities.map((a) => [a.slidePosition, a.activity.prompt, a.ran])).toEqual([
      [1, "Which one?", true],
      [2, "One word?", true],
      [3, "Exit poll", false],
    ]);

    // The removed participant's vote is left out, as it was in the room.
    const [poll, cloud, never] = results.activities;
    expect(poll.results).toEqual({ votes: { [s.alpha.id]: 2, [s.beta.id]: 1 }, answered: 3 });
    expect(poll.cloud).toBeNull();
    // Hidden words stay out of the cloud; the removed participant's word too.
    expect(cloud.cloud).toEqual({
      words: [
        { key: "fun", text: "Fun", count: 2 },
        { key: "hard", text: "hard", count: 1 },
      ],
      entries: 4,
    });
    expect(never.results).toBeNull();
    expect(never.cloud).toBeNull();

    // Deleted questions are gone, hidden ones stay marked, anonymous ones carry no name.
    expect(results.qaShown).toBe(true);
    const byText = Object.fromEntries(results.questions.map((q) => [q.text, q]));
    expect(Object.keys(byText).sort()).toEqual(["Anonymous ask", "Hidden ask", "Signed ask"]);
    expect(byText["Anonymous ask"]).not.toHaveProperty("author");
    expect(byText["Anonymous ask"].votes).toBe(2);
    expect(byText["Signed ask"]).toMatchObject({ author: "Ploy", status: "answered" });
    expect(byText["Hidden ask"].status).toBe("hidden");
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("Mint");
    expect(raw).not.toContain(s.secretAuthor.id);

    // The same numbers presenter control shows for this session.
    const view = (await as(api().get(`/sessions/${s.sessionId}/live`)).expect(200))
      .body as LiveSessionView;
    const pollRun = view.runs.find((r) => r.activityId === s.poll.id)!;
    const cloudRun = view.runs.find((r) => r.activityId === s.cloud.id)!;
    expect(view.tallies[pollRun.activityRunId]).toEqual(poll.results);
    expect(view.clouds[cloudRun.activityRunId]).toEqual(cloud.cloud);
  });

  it("hides another host's session", async () => {
    const s = await pastSession();
    await end(s.sessionId);
    await as(api().get(`/sessions/${s.sessionId}/results`), other).expect(404);
    await as(api().delete(`/sessions/${s.sessionId}`), other).expect(404);
    await as(api().get(`/sessions/not-a-uuid/results`)).expect(404);
    await as(api().delete(`/sessions/not-a-uuid`)).expect(404);
  });

  it("deletes an ended session with everything it left behind, never a live one", async () => {
    const s = await pastSession();
    const refused = await as(api().delete(`/sessions/${s.sessionId}`)).expect(409);
    expect(refused.body.error.code).toBe("SESSION_LIVE");

    await end(s.sessionId);
    await as(api().delete(`/sessions/${s.sessionId}`)).expect(204);
    await as(api().get(`/sessions/${s.sessionId}/results`)).expect(404);
    await as(api().delete(`/sessions/${s.sessionId}`)).expect(404);

    const left = await Promise.all([
      prisma.participant.count({ where: { sessionId: s.sessionId } }),
      prisma.activityRun.count({ where: { sessionId: s.sessionId } }),
      prisma.question.count({ where: { sessionId: s.sessionId } }),
      prisma.answer.count({ where: { activityRun: { sessionId: s.sessionId } } }),
    ]);
    expect(left).toEqual([0, 0, 0, 0]);
    // The deck stays.
    await as(api().get(`/decks/${s.deck.id}`)).expect(200);
  });

  it("asks for an unauthenticated host to log in", async () => {
    await api().get("/sessions").expect(401);
  });
});
