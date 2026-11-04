import { MAX_PARTICIPANTS, SEAT_HOLD_MS } from "@moddeck/shared";
import type { PrismaService } from "../prisma/prisma.service";
import { PresenceService } from "./presence.service";

const NOW = new Date("2026-11-04T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function setup(othersSeated = 0) {
  const count = jest.fn().mockResolvedValue(othersSeated);
  const update = jest.fn().mockResolvedValue({});
  const prisma = { participant: { count, update } } as unknown as PrismaService;
  return { presence: new PresenceService(prisma), count, update };
}

describe("PresenceService", () => {
  it("holds a seat for exactly 15 minutes after the last time the student was seen", () => {
    const { presence } = setup();
    expect(presence.holdsSeat({ lastSeenAt: ago(0) }, NOW)).toBe(true);
    expect(presence.holdsSeat({ lastSeenAt: ago(SEAT_HOLD_MS - 1) }, NOW)).toBe(true);
    expect(presence.holdsSeat({ lastSeenAt: ago(SEAT_HOLD_MS) }, NOW)).toBe(false);
    expect(presence.holdsSeat({ lastSeenAt: ago(SEAT_HOLD_MS + 60_000) }, NOW)).toBe(false);
  });

  it("counts only active participants seen inside the hold window", () => {
    const { presence } = setup();
    expect(presence.seatedWhere("s1", NOW)).toEqual({
      sessionId: "s1",
      status: "active",
      lastSeenAt: { gt: ago(SEAT_HOLD_MS) },
    });
  });

  it("always seats a student inside the hold, without counting the room", async () => {
    const { presence, count } = setup(MAX_PARTICIPANTS);
    const student = { id: "p1", sessionId: "s1", lastSeenAt: ago(60_000) };

    await expect(presence.canSeat(student, undefined, NOW)).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  it("seats a student back after the hold only if the room has space", async () => {
    const stale = { id: "p1", sessionId: "s1", lastSeenAt: ago(SEAT_HOLD_MS + 1) };

    const open = setup(MAX_PARTICIPANTS - 1);
    await expect(open.presence.canSeat(stale, undefined, NOW)).resolves.toBe(true);
    // The student's own row is not counted against them.
    expect(open.count).toHaveBeenCalledWith({
      where: { ...open.presence.seatedWhere("s1", NOW), id: { not: "p1" } },
    });

    const full = setup(MAX_PARTICIPANTS);
    await expect(full.presence.canSeat(stale, undefined, NOW)).resolves.toBe(false);
  });

  it("touch writes the time of the last sighting", async () => {
    const { presence, update } = setup();
    await presence.touch("p1");
    expect(update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { lastSeenAt: expect.any(Date) },
    });
  });
});
