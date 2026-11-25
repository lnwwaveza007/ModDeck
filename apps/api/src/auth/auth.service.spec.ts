import { loadAuthConfig, parseAdminEmails } from "./auth.config";
import { AuthService } from "./auth.service";
import type { PrismaService } from "../prisma/prisma.service";
import { ApiException } from "../common/api-error";

const admin = {
  id: "a1",
  email: "admin@kmutt.ac.th",
  displayName: "Admin",
  studentId: null,
};
const host = { id: "h1", email: "host@kmutt.ac.th", displayName: "Host", studentId: null };

function setup(adminEmails = "Admin@kmutt.ac.th") {
  const hostSession = {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    deleteMany: jest.fn(),
  };
  const user = { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
  const prisma = { hostSession, user } as unknown as PrismaService;
  const cfg = loadAuthConfig({ ADMIN_EMAILS: adminEmails });
  return { service: new AuthService(prisma, cfg), hostSession, user };
}

const row = (impersonatedUser: typeof host | null) => ({
  id: "row1",
  userId: admin.id,
  expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  user: admin,
  impersonatedUserId: impersonatedUser?.id ?? null,
  impersonatedUser,
});

describe("parseAdminEmails", () => {
  it("lowercases, trims and drops empty entries", () => {
    expect([...parseAdminEmails(" A@kmutt.ac.th,, b@mail.kmutt.ac.th ,")]).toEqual([
      "a@kmutt.ac.th",
      "b@mail.kmutt.ac.th",
    ]);
    expect(parseAdminEmails(undefined).size).toBe(0);
  });
});

describe("AuthService impersonation", () => {
  it("acts as the impersonated user and keeps the admin as impersonator", async () => {
    const { service, hostSession } = setup();
    hostSession.findUnique.mockResolvedValue(row(host));
    await expect(service.authenticate("tok")).resolves.toEqual({
      user: host,
      impersonator: admin,
      renewedExpiresAt: undefined,
    });
    expect(hostSession.update).not.toHaveBeenCalled();
  });

  it("drops the impersonation once the admin is off the list", async () => {
    const { service, hostSession } = setup("");
    hostSession.findUnique.mockResolvedValue(row(host));
    await expect(service.authenticate("tok")).resolves.toEqual({
      user: admin,
      renewedExpiresAt: undefined,
    });
    expect(hostSession.update).toHaveBeenCalledWith({
      where: { id: "row1" },
      data: { impersonatedUserId: null },
    });
  });

  it("refuses to impersonate yourself or a user that does not exist", async () => {
    const { service, user } = setup();
    await expect(service.startImpersonation("tok", admin, admin.id)).rejects.toBeInstanceOf(
      ApiException,
    );
    user.findUnique.mockResolvedValue(null);
    await expect(service.startImpersonation("tok", admin, "missing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("only changes the caller's own login row", async () => {
    const { service, user, hostSession } = setup();
    user.findUnique.mockResolvedValue({ ...host, ssoSubject: "s" });
    await expect(service.startImpersonation("tok", admin, host.id)).resolves.toEqual(host);
    expect(hostSession.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), userId: admin.id },
      data: { impersonatedUserId: host.id },
    });
  });

  it("checks the admin list case-insensitively", () => {
    const { service } = setup();
    expect(service.isAdmin({ email: "ADMIN@kmutt.ac.th" })).toBe(true);
    expect(service.isAdmin({ email: "host@kmutt.ac.th" })).toBe(false);
  });
});
