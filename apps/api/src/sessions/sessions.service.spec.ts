import type Redis from "ioredis";
import { ApiException } from "../common/api-error";
import type { PrismaService } from "../prisma/prisma.service";
import type { RoomEventsService } from "../realtime/room-events.service";
import { SessionsService } from "./sessions.service";

const OWNER = "owner-1";
const SESSION = "session-1";
const PIN = "123456";

type Row = { id: string; ownerId: string; status: string; endedAt: Date | null; pin: string };

function setup(row: Partial<Row> | null) {
  const current: Row | null = row
    ? { id: SESSION, ownerId: OWNER, status: "live", endedAt: null, pin: PIN, ...row }
    : null;
  const session = {
    findFirst: jest.fn(async () => current),
    update: jest.fn(async () => ({})),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const redis = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => "OK"),
    del: jest.fn(async () => 1),
  };
  const events = { publish: jest.fn(async () => undefined) };
  const service = new SessionsService(
    { session } as unknown as PrismaService,
    redis as unknown as Redis,
    events as unknown as RoomEventsService,
  );
  return { service, session, redis, events };
}

/** Asserts the promise rejects with an ApiException of this HTTP status and error code. */
async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => new Error("expected rejection, got success"),
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiException);
  expect((error as ApiException).getStatus()).toBe(status);
  expect((error as ApiException).getResponse()).toMatchObject({ error: { code } });
}

describe("SessionsService.end", () => {
  it("ends the session at once, frees the PIN and tells the room", async () => {
    const { service, session, redis, events } = setup({});
    await expect(service.end(OWNER, SESSION)).resolves.toEqual({ status: "ended" });

    expect(session.updateMany).toHaveBeenCalledWith({
      where: { id: SESSION, endedAt: null },
      data: expect.objectContaining({ status: "ended", endReason: "host" }),
    });
    expect(redis.del).toHaveBeenCalledWith(`session-pin:${PIN}`);
    expect(events.publish).toHaveBeenCalledWith(SESSION, "session_ended", { reason: "host" });
  });

  it("does nothing more when the session has already ended", async () => {
    const { service, session, events } = setup({ status: "ended", endedAt: new Date() });
    session.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.end(OWNER, SESSION)).resolves.toEqual({ status: "ended" });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("answers 404 for a session of another host", async () => {
    const { service } = setup(null);
    await expectApiError(service.end(OWNER, SESSION), 404, "NOT_FOUND");
  });
});

describe("SessionsService.openByPin", () => {
  it("returns the open session", async () => {
    const { service } = setup({ status: "live" });
    await expect(service.openByPin(PIN)).resolves.toEqual({ id: SESSION, status: "live" });
  });

  it("answers 410 for an ended session and finishes one left half-ended", async () => {
    const { service, session } = setup({ status: "ended" });
    await expectApiError(service.openByPin(PIN), 410, "SESSION_ENDED");
    expect(session.updateMany).toHaveBeenCalled();
  });

  it("answers 404 for an unknown PIN", async () => {
    const { service } = setup(null);
    await expectApiError(service.openByPin(PIN), 404, "NOT_FOUND");
  });
});
