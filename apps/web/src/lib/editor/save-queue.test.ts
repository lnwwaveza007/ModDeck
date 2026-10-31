import type { SlidePatchBody } from "@moddeck/shared";
import { SaveQueue } from "./save-queue";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const ok = () => jest.fn().mockResolvedValue(undefined);

// A canvas with one text element, so each edit is told apart by its text.
const edit = (text: string): SlidePatchBody => ({
  elements: [
    {
      id: "0192f3a4-0000-7000-8000-000000000001",
      type: "text",
      x: 10,
      y: 10,
      w: 80,
      text,
      size: 3.4,
      bold: false,
      align: "left",
    },
  ],
});

describe("SaveQueue", () => {
  it("waits for a pause and sends one request per slide with the newest canvas", async () => {
    const queue = new SaveQueue(800);
    const send = ok();
    queue.patch("a", edit("h"), send);
    jest.advanceTimersByTime(500);
    queue.patch("a", edit("he"), send);
    queue.patch("a", edit("hey"), send);
    expect(queue.status).toBe("saving");
    expect(send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(799);
    expect(send).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(edit("hey"));
    expect(queue.status).toBe("saved");
  });

  it("keeps a separate request for each slide", async () => {
    const queue = new SaveQueue(800);
    const send = ok();
    queue.patch("a", edit("a"), send);
    queue.patch("b", edit("b"), send);
    await jest.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends waiting edits before a structural change, in order", async () => {
    const queue = new SaveQueue(800);
    const calls: string[] = [];
    queue.patch("a", edit("x"), async () => void calls.push("patch"));
    await queue.run(async () => void calls.push("delete"));
    expect(calls).toEqual(["patch", "delete"]);
    expect(queue.status).toBe("saved");
  });

  it("runs requests one at a time", async () => {
    const queue = new SaveQueue();
    let active = 0;
    let most = 0;
    const task = async () => {
      active++;
      most = Math.max(most, active);
      await Promise.resolve();
      active--;
    };
    await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
    expect(most).toBe(1);
  });

  it("reports an error, keeps the edit, and sends it again on retry", async () => {
    const queue = new SaveQueue(800);
    const send = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    queue.patch("a", edit("keep me"), send);
    await jest.advanceTimersByTimeAsync(800);
    expect(queue.status).toBe("error");

    await queue.retry();
    expect(send).toHaveBeenLastCalledWith(edit("keep me"));
    expect(queue.status).toBe("saved");
  });

  it("does not overwrite a newer edit with a failed older one", async () => {
    const queue = new SaveQueue(800);
    let fail = true;
    const send = jest.fn(async () => {
      if (fail) {
        // The host edits again while the request is in flight.
        queue.patch("a", edit("newer"), send);
        throw new Error("offline");
      }
    });
    queue.patch("a", edit("older"), send);
    await jest.advanceTimersByTimeAsync(800);
    fail = false;
    await queue.retry();
    expect(send).toHaveBeenLastCalledWith(edit("newer"));
  });

  it("passes a failing task to its caller without marking the edits as failed", async () => {
    const queue = new SaveQueue();
    await expect(queue.run(() => Promise.reject(new Error("409")))).rejects.toThrow("409");
    expect(queue.status).toBe("saved");
    await expect(queue.run(async () => "next")).resolves.toBe("next");
  });

  it("tells subscribers about each change and flushes on dispose", async () => {
    const queue = new SaveQueue(800);
    const listener = jest.fn();
    const stop = queue.subscribe(listener);
    const send = ok();
    queue.patch("a", edit("x"), send);
    expect(listener).toHaveBeenCalled();

    queue.dispose();
    await jest.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    stop();
  });
});
