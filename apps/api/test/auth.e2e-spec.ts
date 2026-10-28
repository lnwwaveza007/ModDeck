// Host login (MD-7) end to end: /auth/login -> Entra -> /auth/callback -> cookie
// -> /auth/me -> /auth/logout, against the real database. Entra is faked: the ID
// token is signed with a test key (JWKS override) and the token endpoint is a
// stubbed fetch, so no network or tenant is needed.

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT, generateKeyPair } from "jose";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { decodeTx } from "../src/auth/oidc.service";
import { sha256Hex } from "../src/auth/crypto.util";
import { JWKS } from "../src/auth/token-validator.service";
import { PrismaService } from "../src/prisma/prisma.service";

const TENANT = "79845616-9df0-43e0-8842-e300feb2642a";
const CLIENT = "f9a6b49a-0163-4d7f-9f9b-76fc04d52c39";
const APP = "https://app.test";
const SUBJECT = "e2e-host-oid";
const SSO_ENV = { ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, APP_BASE_URL: APP };

const cookieFrom = (res: request.Response, name: string): string | undefined => {
  const raw = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return raw.find((c) => c.startsWith(`${name}=`));
};
const cookieValue = (setCookie: string) =>
  decodeURIComponent(setCookie.split(";")[0].split("=")[1]);

async function bootstrap(env: Record<string, string>, override?: (b: unknown) => unknown) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (override) builder = override(builder) as typeof builder;
    const app = (await builder.compile()).createNestApplication();
    await app.init();
    return app;
  } finally {
    process.env = saved;
  }
}

describe("host login (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  const realFetch = global.fetch;

  beforeAll(async () => {
    keys = await generateKeyPair("RS256");
    app = await bootstrap(SSO_ENV, (b) =>
      (b as ReturnType<typeof Test.createTestingModule>)
        .overrideProvider(JWKS)
        .useValue(async () => keys.publicKey),
    );
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  afterAll(async () => {
    // Cascades to host_sessions.
    await prisma.user.deleteMany({ where: { ssoSubject: SUBJECT } });
    await app.close();
  });

  const idToken = (nonce: string) =>
    new SignJWT({
      oid: SUBJECT,
      tid: TENANT,
      nonce,
      name: "E2E Host",
      email: "E2E.Host@kmutt.ac.th",
      employeeid: "64070001",
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`)
      .setAudience(CLIENT)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);

  async function startLogin(returnTo = "/decks/abc") {
    const res = await request(app.getHttpServer()).get("/auth/login").query({ returnTo });
    const txCookie = cookieFrom(res, "host_oidc_tx");
    return { res, txCookie, tx: decodeTx(txCookie && cookieValue(txCookie)) };
  }

  it("redirects to Entra with PKCE S256, state and nonce", async () => {
    const { res, txCookie, tx } = await startLogin();
    expect(res.status).toBe(302);

    const url = new URL(res.headers.location);
    expect(`${url.origin}${url.pathname}`).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT);
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(tx?.state);
    expect(url.searchParams.get("nonce")).toBe(tx?.nonce);
    expect(txCookie).toMatch(/HttpOnly/);
    expect(txCookie).toMatch(/Path=\/api\/auth/);
  });

  it("logs in, stores only a hash in host_sessions, then logs out", async () => {
    const { txCookie, tx } = await startLogin();
    if (!txCookie || !tx) throw new Error("no login transaction");

    const tokenRequest = jest.fn();
    global.fetch = (async (_url: string, init: RequestInit) => {
      tokenRequest(new URLSearchParams(init.body as URLSearchParams).get("code_verifier"));
      return new Response(JSON.stringify({ id_token: await idToken(tx.nonce) }));
    }) as typeof fetch;

    const callback = await request(app.getHttpServer())
      .get("/auth/callback")
      .query({ code: "auth-code", state: tx.state })
      .set("Cookie", txCookie.split(";")[0]);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(`${APP}/decks/abc`);
    expect(tokenRequest).toHaveBeenCalledWith(tx.verifier);

    const sessionCookie = cookieFrom(callback, "host_session");
    if (!sessionCookie) throw new Error("no host_session cookie");
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Secure/);
    expect(sessionCookie).toMatch(/SameSite=Lax/);

    const token = cookieValue(sessionCookie);
    const row = await prisma.hostSession.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    expect(row?.user).toMatchObject({
      ssoSubject: SUBJECT,
      email: "e2e.host@kmutt.ac.th",
      studentId: "64070001",
    });
    // A host login is not a room participant.
    expect(await prisma.participant.count({ where: { userId: row!.userId } })).toBe(0);

    const cookie = `host_session=${encodeURIComponent(token)}`;
    const me = await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: "e2e.host@kmutt.ac.th", displayName: "E2E Host" });

    await request(app.getHttpServer()).post("/auth/logout").set("Cookie", cookie).expect(204);
    expect(await prisma.hostSession.count({ where: { id: row!.id } })).toBe(0);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", cookie).expect(401);
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const { txCookie } = await startLogin();
    const res = await request(app.getHttpServer())
      .get("/auth/callback")
      .query({ code: "auth-code", state: "forged" })
      .set("Cookie", txCookie!.split(";")[0]);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${APP}/login?error=invalid_state`);
  });

  it("drops an expired host session", async () => {
    const user = await prisma.user.upsert({
      where: { ssoSubject: SUBJECT },
      create: { ssoSubject: SUBJECT, email: "e2e.host@kmutt.ac.th", displayName: "E2E Host" },
      update: {},
    });
    const token = "expired-token";
    await prisma.hostSession.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", `host_session=${token}`)
      .expect(401);
    expect(await prisma.hostSession.count({ where: { tokenHash: sha256Hex(token) } })).toBe(0);
  });
});

describe("host login without SSO configured (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ ENTRA_TENANT_ID: "" });
  });

  afterAll(async () => {
    await app.close();
  });

  it("still boots, and login answers 503", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
    await request(app.getHttpServer()).get("/auth/login").expect(503);
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });
});
