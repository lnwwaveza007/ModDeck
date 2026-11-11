import { joinPayloadSchema, type JoinAck } from "@moddeck/shared";
import { createSessionSocket, socketOrigin, socketPath } from "./socket";

describe("socketOrigin", () => {
  it("keeps only the origin of the api URL", () => {
    expect(socketOrigin("http://localhost:4000", "http://localhost:3000/s/1")).toBe(
      "http://localhost:4000",
    );
    expect(socketOrigin("/api", "https://moddeck.example/s/1")).toBe("https://moddeck.example");
  });
});

describe("socketPath", () => {
  it("puts socket.io beside the api root", () => {
    expect(socketPath("http://localhost:4000", "http://localhost:3000/")).toBe("/socket.io");
    expect(socketPath("/api", "https://moddeck.example/")).toBe("/socket.io");
    expect(socketPath("/capstone26/cp26ssa2/api", "https://bscit.example/")).toBe(
      "/capstone26/cp26ssa2/socket.io",
    );
  });
});

describe("createSessionSocket", () => {
  it("does not connect until asked", () => {
    const socket = createSessionSocket("http://localhost:4000");
    expect(socket.connected).toBe(false);
    socket.close();
  });

  it("asks for the host role only when told to", () => {
    const student = createSessionSocket("http://localhost:4000");
    const host = createSessionSocket("http://localhost:4000", "host");
    expect(student.auth).toBeFalsy();
    expect(host.auth).toEqual({ role: "host" });
    student.close();
    host.close();
  });

  it("uses the shared event schema", () => {
    // The same schema the api validates `join` with.
    expect(
      joinPayloadSchema.safeParse({ sessionId: "0199f0c2-7a1b-7c3d-8e4f-123456789abc" }).success,
    ).toBe(true);

    const ack: JoinAck = { ok: false, error: { code: "ROOM_FORBIDDEN", message: "no" } };
    expect(ack.ok).toBe(false);
  });
});
