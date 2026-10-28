import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { loadAuthConfig } from "./auth.config";
import { AuthGuard } from "./auth.guard";
import type { AuthService } from "./auth.service";
import type { AuthUser } from "./auth.types";
import { SESSION_COOKIE } from "./cookies";

const cfg = loadAuthConfig({
  ENTRA_TENANT_ID: "79845616-9df0-43e0-8842-e300feb2642a",
  ENTRA_CLIENT_ID: "f9a6b49a-0163-4d7f-9f9b-76fc04d52c39",
  APP_BASE_URL: "https://app.test",
});

const user: AuthUser = {
  id: "u1",
  email: "host@kmutt.ac.th",
  displayName: "Host",
  studentId: null,
};

function setup(cookie: string | undefined, authResult: unknown) {
  const authenticate = jest.fn().mockResolvedValue(authResult);
  const guard = new AuthGuard({ authenticate } as unknown as AuthService, cfg);
  const req: { headers: { cookie?: string }; user?: AuthUser } = {
    headers: { cookie },
  };
  const res = { cookie: jest.fn() };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { guard, ctx, req, res, authenticate };
}

describe("AuthGuard", () => {
  it("rejects requests without cookies", async () => {
    const { guard, ctx, authenticate } = setup(undefined, null);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects requests that have other cookies but no session cookie", async () => {
    const { guard, ctx, authenticate } = setup("theme=dark; foo=bar", null);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects an unknown or expired session", async () => {
    const { guard, ctx, authenticate } = setup(`${SESSION_COOKIE}=stale`, null);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).toHaveBeenCalledWith("stale");
  });

  it("allows a valid session and attaches the user to the request", async () => {
    const { guard, ctx, req, res, authenticate } = setup(
      `theme=dark; ${SESSION_COOKIE}=tok123; foo=bar`,
      { user },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith("tok123");
    expect(req.user).toEqual(user);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("refreshes the cookie with secure attributes when the session slides", async () => {
    const renewedExpiresAt = new Date(Date.now() + 8 * 3600_000);
    const { guard, ctx, res } = setup(`${SESSION_COOKIE}=tok123`, {
      user,
      renewedExpiresAt,
    });
    await guard.canActivate(ctx);
    expect(res.cookie).toHaveBeenCalledWith(SESSION_COOKIE, "tok123", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: renewedExpiresAt,
    });
  });
});
