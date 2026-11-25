// Admin impersonation end to end: an account on ADMIN_EMAILS acts as another user (their decks,
// their /auth/me) until it stops, and gets its own account back. Others get 403 ADMIN_ONLY.
// Real Postgres; the logins are made with AuthService like the other host suites.

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DeckSummary, MeView, UserSummary } from "@moddeck/shared";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { setupApp } from "../src/app.setup";
import { AuthService } from "../src/auth/auth.service";
import { PrismaService } from "../src/prisma/prisma.service";

type Login = { id: string; email: string; cookie: string };

const SUBJECTS = ["e2e-imp-admin", "e2e-imp-host", "e2e-imp-other"];
const ADMIN_EMAIL = `${SUBJECTS[0]}@kmutt.ac.th`;

describe("Admin impersonation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Login;
  let host: Login;
  let other: Login;

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { ssoSubject: { in: SUBJECTS } } });
    const ids = { in: users.map((u) => u.id) };
    await prisma.deck.deleteMany({ where: { ownerId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
  }

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const saved = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = ` ${ADMIN_EMAIL.toUpperCase()} , nobody@kmutt.ac.th`;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication({ logger: ["error"] });
      await setupApp(app);
      await app.init();
    } finally {
      if (saved === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = saved;
    }
    prisma = app.get(PrismaService);
    await cleanup();

    const auth = app.get(AuthService);
    const login = async (subject: string): Promise<Login> => {
      const email = `${subject}@kmutt.ac.th`;
      const user = await auth.upsertUser({ subject, email, displayName: subject, studentId: null });
      const { token } = await auth.createSession(user);
      return { id: user.id, email, cookie: `host_session=${encodeURIComponent(token)}` };
    };
    [admin, host, other] = await Promise.all(SUBJECTS.map((s) => login(s)));

    await api().post("/decks").set("Cookie", host.cookie).send({ title: "Host deck" }).expect(201);
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it("tells the web whether the account is an admin", async () => {
    const me = await api().get("/auth/me").set("Cookie", admin.cookie).expect(200);
    expect(me.body).toMatchObject({ id: admin.id, isAdmin: true, impersonator: null });

    const notAdmin = await api().get("/auth/me").set("Cookie", host.cookie).expect(200);
    expect(notAdmin.body).toMatchObject({ id: host.id, isAdmin: false, impersonator: null });
  });

  it("keeps the admin tools from everyone else", async () => {
    const search = await api().get("/admin/users").set("Cookie", other.cookie).expect(403);
    expect(search.body.error.code).toBe("ADMIN_ONLY");
    const start = await api()
      .post("/auth/impersonation")
      .set("Cookie", other.cookie)
      .send({ userId: host.id })
      .expect(403);
    expect(start.body.error.code).toBe("ADMIN_ONLY");
    await api().get("/admin/users").expect(401);
  });

  it("finds users by email or name", async () => {
    const res = await api()
      .get("/admin/users")
      .query({ q: "E2E-IMP-HO" })
      .set("Cookie", admin.cookie)
      .expect(200);
    expect((res.body as UserSummary[]).map((u) => u.id)).toEqual([host.id]);
    expect(res.body[0]).toEqual({ id: host.id, email: host.email, displayName: SUBJECTS[1] });
  });

  it("acts as the user until the admin stops", async () => {
    await api()
      .post("/auth/impersonation")
      .set("Cookie", admin.cookie)
      .send({ userId: admin.id })
      .expect(422);
    await api()
      .post("/auth/impersonation")
      .set("Cookie", admin.cookie)
      .send({ userId: "0190d6a4-0000-7000-8000-000000000000" })
      .expect(404);

    const started = await api()
      .post("/auth/impersonation")
      .set("Cookie", admin.cookie)
      .send({ userId: host.id })
      .expect(200);
    expect(started.body).toMatchObject({
      id: host.id,
      isAdmin: true,
      impersonator: { id: admin.id, email: admin.email },
    });

    const me = await api().get("/auth/me").set("Cookie", admin.cookie).expect(200);
    expect((me.body as MeView).id).toBe(host.id);
    const decks = await api().get("/decks").set("Cookie", admin.cookie).expect(200);
    expect((decks.body as DeckSummary[]).map((d) => d.title)).toEqual(["Host deck"]);

    // The admin tools still answer while impersonating a non-admin.
    await api().get("/admin/users").set("Cookie", admin.cookie).expect(200);
    // The impersonated user's own login is untouched.
    const hostMe = await api().get("/auth/me").set("Cookie", host.cookie).expect(200);
    expect(hostMe.body).toMatchObject({ id: host.id, impersonator: null });

    await api().delete("/auth/impersonation").set("Cookie", admin.cookie).expect(204);
    const back = await api().get("/auth/me").set("Cookie", admin.cookie).expect(200);
    expect(back.body).toMatchObject({ id: admin.id, impersonator: null });
    const own = await api().get("/decks").set("Cookie", admin.cookie).expect(200);
    expect(own.body).toEqual([]);

    // Stopping again is a no-op.
    await api().delete("/auth/impersonation").set("Cookie", admin.cookie).expect(204);
  });
});
