/** @jest-environment node */

import type { Socket } from "socket.io-client";
import type { Ack, ServerEvent, SyncResult } from "./events";
import { newClientId, SessionSocket, type ConnectionStatus } from "./session-socket";

type Handler = (...args: unknown[]) => void;

/** Just enough of a Socket.IO client socket. `server` answers emits that expect an ack. */
class FakeSocket {
  private handlers = new Map<string, Handler[]>();
  emitted: Array<{ event: string; payload: unknown }> = [];
  closed = false;

  constructor(private server: FakeServer) {}

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }

  once(event: string, handler: Handler) {
    const wrapped: Handler = (...args) => {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((h) => h !== wrapped),
      );
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event: string, payload: unknown, ack?: (response: unknown) => void) {
    this.emitted.push({ event, payload });
    const response = this.server.answer(event, payload);
    if (ack && response !== undefined) queueMicrotask(() => ack(response));
    return this;
  }

  /** Server → client. */
  fire(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }

  removeAllListeners() {
    this.handlers.clear();
    return this;
  }

  close() {
    this.closed = true;
    return this;
  }
}

class FakeServer {
  sockets: FakeSocket[] = [];
  sync: SyncResult = { ok: true, mode: "replay", lastSeq: 0, events: [] };
  /** Return undefined to never ack (simulates a lost message). */
  answer: (event: string, payload: unknown) => unknown = (event) =>
    event === "hello" ? this.sync : ({ ok: true } satisfies Ack);

  createSocket = () => {
    const socket = new FakeSocket(this);
    this.sockets.push(socket);
    queueMicrotask(() => socket.fire("connect"));
    return socket as unknown as Socket;
  };

  get current() {
    return this.sockets[this.sockets.length - 1];
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(lastSeq = 0) {
  const server = new FakeServer();
  const events: ServerEvent[] = [];
  const statuses: ConnectionStatus[] = [];
  const client = new SessionSocket({
    lastSeq,
    backoffMs: [1],
    ackTimeoutMs: 50,
    createSocket: server.createSocket,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
  });
  return { server, client, events, statuses };
}

describe("SessionSocket", () => {
  it("says hello with lastSeq after connecting, then goes online", async () => {
    const { server, client, statuses } = setup(7);
    server.sync = { ok: true, mode: "replay", lastSeq: 7, events: [] };
    client.connect();
    await flush();

    expect(server.current.emitted[0]).toEqual({ event: "hello", payload: { lastSeq: 7 } });
    expect(statuses).toEqual(["online"]);
    client.close();
  });

  it("applies replayed events from sync and moves lastSeq forward", async () => {
    const { server, client, events } = setup(1);
    server.sync = {
      ok: true,
      mode: "replay",
      lastSeq: 3,
      events: [
        { name: "slide_changed", seq: 2, payload: { slideId: "s2", index: 1 } },
        { name: "participant_count", seq: 3, payload: { online: 40, total: 41 } },
      ],
    };
    client.connect();
    await flush();

    expect(events.map((e) => e.seq)).toEqual([2, 3]);
    expect(client.lastSeq).toBe(3);
    client.close();
  });

  it("drops duplicates and resyncs on a gap", async () => {
    const { server, client, events } = setup();
    client.connect();
    await flush();

    server.current.fire("slide_changed", { seq: 1, slideId: "s1", index: 0 });
    server.current.fire("slide_changed", { seq: 1, slideId: "s1", index: 0 });
    expect(events).toEqual([
      { name: "slide_changed", seq: 1, payload: { slideId: "s1", index: 0 } },
    ]);

    server.sync = {
      ok: true,
      mode: "replay",
      lastSeq: 3,
      events: [
        { name: "activity_state", seq: 2, payload: { activityId: "a1", state: "live" } },
        { name: "activity_state", seq: 3, payload: { activityId: "a1", state: "closed" } },
      ],
    };
    server.current.fire("activity_state", { seq: 3, activityId: "a1", state: "closed" });
    await flush();

    expect(server.current.emitted.filter((e) => e.event === "hello")).toHaveLength(2);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    client.close();
  });

  it("queues a vote while disconnected and resends it with the same answerId", async () => {
    const { server, client, statuses } = setup();
    client.connect();
    await flush();

    server.current.fire("disconnect");
    const answerId = newClientId();
    const ack = client.send("vote", { activityRunId: "r1", optionIds: ["o2"], answerId });
    await flush();
    await flush();

    expect(statuses).toEqual(["online", "reconnecting", "online"]);
    await expect(ack).resolves.toEqual({ ok: true });
    const votes = server.sockets.flatMap((s) => s.emitted).filter((e) => e.event === "vote");
    expect(votes).toEqual([
      { event: "vote", payload: { activityRunId: "r1", optionIds: ["o2"], answerId } },
    ]);
    client.close();
  });

  it("keeps an unacked action queued and sends it again after reconnect", async () => {
    const { server, client } = setup();
    client.connect();
    await flush();

    let drop = true;
    server.answer = (event) => {
      if (event === "hello") return server.sync;
      if (drop) return undefined;
      return { ok: true, duplicate: true };
    };
    const ack = client.send("word", { activityRunId: "r1", text: "react", answerId: "a_1" });
    await new Promise((resolve) => setTimeout(resolve, 80)); // past ackTimeoutMs

    drop = false;
    server.current.fire("disconnect");
    await expect(ack).resolves.toEqual({ ok: true, duplicate: true });
    const words = server.sockets.flatMap((s) => s.emitted).filter((e) => e.event === "word");
    expect(words.map((w) => (w.payload as { answerId: string }).answerId)).toEqual(["a_1", "a_1"]);
    client.close();
  });

  it("ends when the server says the session is over", async () => {
    const { server, client, statuses } = setup();
    client.connect();
    await flush();

    server.current.fire("session_ended", { seq: 1, reason: "host" });
    expect(statuses.at(-1)).toBe("ended");
    expect(server.current.closed).toBe(true);
    await expect(client.send("upvote", { questionId: "q1", on: true })).rejects.toThrow("ended");
  });

  it("ends when hello is rejected (token no longer valid)", async () => {
    const { server, client, statuses } = setup();
    server.sync = { ok: false, code: "SESSION_ENDED" };
    client.connect();
    await flush();
    expect(statuses).toEqual(["ended"]);
  });

  it("only sends reactions while online", async () => {
    const { server, client } = setup();
    client.sendVolatile("reaction", { emoji: "👏" });
    client.connect();
    await flush();
    client.sendVolatile("reaction", { emoji: "🔥" });

    const reactions = server.current.emitted.filter((e) => e.event === "reaction");
    expect(reactions).toEqual([{ event: "reaction", payload: { emoji: "🔥" } }]);
    client.close();
  });
});
