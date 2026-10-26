/** @jest-environment node */

import type { JoinAck, JoinPayload, RoomEvent } from "@moddeck/shared";
import { LiveConnection, type ConnectionStatus } from "./live-connection";
import type { SessionSocket } from "./socket";

type Listener = (...args: unknown[]) => void;

/** Just enough of a Socket.IO client socket. `answerJoin` plays the server. */
class FakeSocket {
  private listeners = new Map<string, Listener[]>();
  joins: JoinPayload[] = [];
  connected = false;
  connectCalls = 0;
  answerJoin: (payload: JoinPayload) => JoinAck | undefined = () => ({
    ok: true,
    sessionId: SESSION,
    seq: 0,
    mode: "snapshot",
    snapshot: { status: "live", currentSlideId: null },
  });

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  timeout() {
    return {
      emit: (
        event: string,
        payload: JoinPayload,
        ack: (err: Error | null, reply?: JoinAck) => void,
      ) => {
        if (event !== "join") return;
        this.joins.push(payload);
        const reply = this.answerJoin(payload);
        queueMicrotask(() => (reply ? ack(null, reply) : ack(new Error("timeout"))));
      },
    };
  }

  connect() {
    this.connectCalls += 1;
    this.connected = true;
    queueMicrotask(() => this.fire("connect"));
    return this;
  }

  disconnect() {
    this.connected = false;
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  /** Server → client. */
  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  drop(reason = "transport close") {
    this.connected = false;
    this.fire("disconnect", reason);
  }
}

const SESSION = "0199f0c2-7a1b-7c3d-8e4f-123456789abc";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function slide(seq: number, index = seq): RoomEvent {
  return {
    type: "slide_changed",
    seq,
    sessionId: SESSION,
    at: 0,
    data: { slideId: `s${index}`, index },
  };
}

function setup(lastSeq?: number) {
  const socket = new FakeSocket();
  const events: RoomEvent[] = [];
  const statuses: ConnectionStatus[] = [];
  const errors: string[] = [];
  const live = new LiveConnection({
    sessionId: SESSION,
    lastSeq,
    retryMs: 1,
    socket: socket as unknown as SessionSocket,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onError: (e) => errors.push(e.code),
  });
  return { socket, live, events, statuses, errors };
}

describe("LiveConnection", () => {
  it("joins after connecting and goes online", async () => {
    const { socket, live, statuses } = setup();
    live.connect();
    await flush();

    expect(socket.joins).toEqual([{ sessionId: SESSION }]);
    expect(statuses).toEqual(["online"]);
    live.close();
  });

  it("sends lastSeq on rejoin and applies the replayed events", async () => {
    const { socket, live, events, statuses } = setup(4);
    socket.answerJoin = () => ({
      ok: true,
      sessionId: SESSION,
      seq: 6,
      mode: "replay",
      events: [slide(4), slide(5), slide(6)],
    });
    live.connect();
    await flush();

    expect(socket.joins[0]).toEqual({ sessionId: SESSION, lastSeq: 4 });
    expect(events.map((e) => e.seq)).toEqual([5, 6]);
    expect(live.lastSeq).toBe(6);

    socket.drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    socket.connect(); // Socket.IO's own reconnect
    await flush();
    expect(socket.joins[1]).toEqual({ sessionId: SESSION, lastSeq: 6 });
    expect(statuses.at(-1)).toBe("online");
    live.close();
  });

  it("drops duplicates and joins again on a gap", async () => {
    const { socket, live, events } = setup();
    live.connect();
    await flush();

    socket.fire("slide_changed", slide(1));
    socket.fire("slide_changed", slide(1));
    expect(events.map((e) => e.seq)).toEqual([1]);

    socket.answerJoin = () => ({
      ok: true,
      sessionId: SESSION,
      seq: 3,
      mode: "replay",
      events: [slide(2), slide(3)],
    });
    socket.fire("slide_changed", slide(3));
    await flush();

    expect(socket.joins.at(-1)).toEqual({ sessionId: SESSION, lastSeq: 1 });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    live.close();
  });

  it("reconnects by hand after a server-side disconnect", async () => {
    const { socket, live } = setup();
    live.connect();
    await flush();

    socket.drop("io server disconnect");
    expect(socket.connectCalls).toBe(2);
    live.close();
  });

  it("retries the join when it times out", async () => {
    const { socket, live, statuses } = setup();
    let first = true;
    const answer = socket.answerJoin;
    socket.answerJoin = (payload) => (first ? ((first = false), undefined) : answer(payload));
    live.connect();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(socket.joins).toHaveLength(2);
    expect(statuses).toEqual(["online"]);
    live.close();
  });

  it("ends when the session ends", async () => {
    const { socket, live, statuses } = setup();
    live.connect();
    await flush();

    socket.fire("session_ended", {
      type: "session_ended",
      seq: 1,
      sessionId: SESSION,
      at: 0,
      data: { reason: "host" },
    });
    expect(statuses.at(-1)).toBe("ended");
    expect(socket.connected).toBe(false);
  });

  it("ends when the server refuses the join", async () => {
    const { socket, live, statuses, errors } = setup();
    socket.answerJoin = () => ({ ok: false, error: { code: "ROOM_FORBIDDEN", message: "no" } });
    live.connect();
    await flush();

    expect(errors).toEqual(["ROOM_FORBIDDEN"]);
    expect(statuses).toEqual(["ended"]);
  });

  it("passes on socket errors and stops on final ones", async () => {
    const { socket, live, statuses, errors } = setup();
    live.connect();
    await flush();

    socket.fire("error", { code: "INVALID_PAYLOAD", message: "bad", seq: 0 });
    expect(statuses.at(-1)).toBe("online");
    socket.fire("error", { code: "PARTICIPANT_REMOVED", message: "bye", seq: 0 });
    expect(errors).toEqual(["INVALID_PAYLOAD", "PARTICIPANT_REMOVED"]);
    expect(statuses.at(-1)).toBe("ended");
  });
});
