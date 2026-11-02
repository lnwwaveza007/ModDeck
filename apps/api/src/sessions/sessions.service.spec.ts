import type Redis from "ioredis";
import { ApiException } from "../common/api-error";
import type { PrismaService } from "../prisma/prisma.service";
import type { RoomEventsService } from "../realtime/room-events.service";
import { SessionsService } from "./sessions.service";

const OWNER = "owner-1";
const SESSION = "session-1";
const PIN = "123456";

type Row = { id: string; ownerId: string; status: string; endedAt: Date | null; pin: string };

function setup(row: Partial<Row> | null, deadline: string | null = null) {
  const current: Row | null = row
    ? { id: SESSION, ownerId: OWNER, status: "live", endedAt: null, pin: PIN, ...row }
    : null;
  const session = {
    findFirst: jest.fn(async () => current),
    update: jest.fn(async () => ({})),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  const redis = {
    get: jest.fn(async () => deadline),
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

const future = () => String(Date.now() + 30_000);
const past = () => String(Date.now() - 1_000);

describe("SessionsService end flow", () => {
  it("requestEnd marks ended and starts the 60 s undo window", async () => {
    const { service, session, redis } = setup({});
    const result = await service.requestEnd(OWNER, SESSION);

    expect(session.update).toHaveBeenCalledWith({
      where: { id: SESSION },
      data: { status: "ended" },
    });
    expect(redis.set).toHaveBeenCalledWith(
      `session-ending:${SESSION}`,
      expect.any(String),
      "EX",
      86400,
    );
    expect(result).toMatchObject({ status: "ended", undoSeconds: 60 });
  });

  it("undoEnd inside the window sets status back to live", async () => {
    const { service, session, redis } = setup({ status: "ended" }, future());
    const result = await service.undoEnd(OWNER, SESSION);

    expect(session.updateMany).toHaveBeenCalledWith({
      where: { id: SESSION, ownerId: OWNER, status: "ended", endedAt: null },
      data: { status: "live" },
    });
    expect(redis.del).toHaveBeenCalledWith(`session-ending:${SESSION}`);
    expect(result).toEqual({ status: "live" });
  });

  it("undoEnd after the window throws 409 UNDO_EXPIRED", async () => {
    const { service, session } = setup({ status: "ended" }, past());
    await expectApiError(service.undoEnd(OWNER, SESSION), 409, "UNDO_EXPIRED");
    expect(session.updateMany).not.toHaveBeenCalled();
  });

  it("undoEnd loses the race when finish already set endedAt", async () => {
    const { service, session } = setup({ status: "ended" }, future());
    session.updateMany.mockResolvedValueOnce({ count: 0 });
    await expectApiError(service.undoEnd(OWNER, SESSION), 409, "UNDO_EXPIRED");
  });

  it("finishEnd while the window is still open throws and writes nothing", async () => {
    const { service, session, events } = setup({ status: "ended" }, future());
    await expectApiError(service.finishEnd(OWNER, SESSION), 409, "UNDO_EXPIRED");
    expect(session.updateMany).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("finishEnd after the window sets endedAt and publishes session_ended", async () => {
    const { service, session, events } = setup({ status: "ended" }, past());
    await service.finishEnd(OWNER, SESSION);

    expect(session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ endReason: "host" }) }),
    );
    expect(events.publish).toHaveBeenCalledWith(SESSION, "session_ended", { reason: "host" });
  });

  it("finishEnd with a lost Redis deadline finishes instead of getting stuck", async () => {
    const { service, session } = setup({ status: "ended" }, null);
    await service.finishEnd(OWNER, SESSION);
    expect(session.updateMany).toHaveBeenCalled();
  });

  it("requestEnd on an ended session with a lost deadline finishes it", async () => {
    const { service, session } = setup({ status: "ended" }, null);
    const result = await service.requestEnd(OWNER, SESSION);

    expect(session.updateMany).toHaveBeenCalled();
    expect(result).toEqual({ status: "ended", endingAt: null, undoSeconds: 0 });
  });
});

describe("SessionsService.byPin", () => {
  it("returns status only, never the session id", async () => {
    const { service } = setup({ status: "live" }, null);
    await expect(service.byPin(PIN)).resolves.toEqual({ status: "live" });
  });

  it("answers 410 for an ended session and finishes it when its window has lapsed", async () => {
    const { service, session } = setup({ status: "ended" }, null);
    await expectApiError(service.byPin(PIN), 410, "SESSION_ENDED");
    expect(session.updateMany).toHaveBeenCalled();
  });

  it("answers 404 for an unknown PIN", async () => {
    const { service } = setup(null, null);
    await expectApiError(service.byPin(PIN), 404, "NOT_FOUND");
  });
});
