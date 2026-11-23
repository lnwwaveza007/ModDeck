import type Redis from "ioredis";
import { ApiException } from "../common/api-error";
import type { PrismaService } from "../prisma/prisma.service";
import type { RoomEventsService } from "../realtime/room-events.service";
import { SessionAccessService } from "./session-access.service";
import { SessionsService } from "./sessions.service";
import type { PollFlusherService } from "../realtime/poll-flusher.service";
import type { PollStoreService } from "../realtime/poll-store.service";
import type { ReactionService } from "../realtime/reaction.service";

const OWNER = "owner-1";
const COHOST = "cohost-1";
const SESSION = "0190d8a1-5a2b-7c3d-8e4f-0123456789ab";
const PIN = "123456";

type Row = {
  id: string;
  ownerId: string;
  controllerId: string | null;
  status: string;
  endedAt: Date | null;
  pin: string;
};

function setup(row: Partial<Row> | null) {
  const current: Row | null = row
    ? {
        id: SESSION,
        ownerId: OWNER,
        controllerId: null,
        status: "live",
        endedAt: null,
        pin: PIN,
        ...row,
      }
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
  const polls = { syncRun: jest.fn(async () => true) };
  const flusher = { finalFlush: jest.fn(async () => undefined) };
  const reactions = { setEnabled: jest.fn(async () => undefined) };
  const prisma = {
    session,
    activityRun: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  const service = new SessionsService(
    prisma,
    redis as unknown as Redis,
    events as unknown as RoomEventsService,
    polls as unknown as PollStoreService,
    flusher as unknown as PollFlusherService,
    reactions as unknown as ReactionService,
    new SessionAccessService(prisma),
  );
  return { service, session, redis, events, reactions };
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
  it("ends the session at once, gives the PIN back and tells the room", async () => {
    const { service, session, redis, events } = setup({});
    await expect(service.end(OWNER, SESSION)).resolves.toEqual({ status: "ended" });

    // The PIN is cleared in the same guarded write, so the number can be issued again.
    expect(session.updateMany).toHaveBeenCalledWith({
      where: { id: SESSION, endedAt: null },
      data: expect.objectContaining({ status: "ended", endReason: "host", pin: null }),
    });
    expect(redis.del).toHaveBeenCalledWith(`session-pin:${PIN}`);
    expect(events.publish).toHaveBeenCalledWith(SESSION, "session_ended", { reason: "host" });
  });

  it("turns reactions off, and still ends the session when that fails", async () => {
    const { service, events, reactions } = setup({});
    reactions.setEnabled.mockRejectedValueOnce(new Error("Redis down"));
    await expect(service.end(OWNER, SESSION)).resolves.toEqual({ status: "ended" });
    expect(reactions.setEnabled).toHaveBeenCalledWith(SESSION, false);
    expect(events.publish).toHaveBeenCalledWith(SESSION, "session_ended", { reason: "host" });
  });

  it("does nothing more when the session has already ended", async () => {
    const { service, session, events } = setup({ status: "ended", endedAt: new Date() });
    session.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.end(OWNER, SESSION)).resolves.toEqual({ status: "ended" });
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("lets a co-host end the session only after a take-over (F12)", async () => {
    const before = setup({});
    await expectApiError(before.service.end(COHOST, SESSION), 403, "NOT_CONTROLLER");
    expect(before.session.updateMany).not.toHaveBeenCalled();

    const after = setup({ controllerId: COHOST });
    await expect(after.service.end(COHOST, SESSION)).resolves.toEqual({ status: "ended" });
    // The owner lost control to the co-host: they take it back before they end the session.
    await expectApiError(after.service.end(OWNER, SESSION), 403, "NOT_CONTROLLER");
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

  it("looks only at open sessions, so the PIN of an ended one is unknown", async () => {
    const { service, session } = setup({ status: "live" });
    await service.openByPin(PIN);
    expect(session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pin: PIN, status: { not: "ended" } } }),
    );
  });

  it("answers 404 for an unknown PIN", async () => {
    const { service } = setup(null);
    await expectApiError(service.openByPin(PIN), 404, "NOT_FOUND");
  });
});
