import { joinPayloadSchema } from "./events";

describe("joinPayloadSchema", () => {
  const sessionId = "0199f0c2-7a1b-7c3d-8e4f-123456789abc"; // UUIDv7, as Prisma makes

  it("accepts a session id with or without lastSeq", () => {
    expect(joinPayloadSchema.safeParse({ sessionId }).success).toBe(true);
    expect(joinPayloadSchema.safeParse({ sessionId, lastSeq: 42 }).success).toBe(true);
  });

  it("rejects a bad session id or a negative / fractional lastSeq", () => {
    expect(joinPayloadSchema.safeParse({ sessionId: "123456" }).success).toBe(false);
    expect(joinPayloadSchema.safeParse({ sessionId, lastSeq: -1 }).success).toBe(false);
    expect(joinPayloadSchema.safeParse({ sessionId, lastSeq: 1.5 }).success).toBe(false);
    expect(joinPayloadSchema.safeParse(undefined).success).toBe(false);
  });
});
