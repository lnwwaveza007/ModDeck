import { SaveQueue } from "./save-queue";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const ok = () => jest.fn().mockResolvedValue(undefined);

describe("SaveQueue", () => {
  it("waits for a pause and sends one request per slide with the newest fields", async () => {
    const queue = new SaveQueue(800);
    const send = ok();
    queue.patch("a", { content: "h" }, send);
    jest.advanceTimersByTime(500);
    queue.patch("a", { content: "he" }, send);
    queue.patch("a", { language: "sql" }, send);
    expect(queue.status).toBe("saving");
    expect(send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(799);
    expect(send).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ content: "he", language: "sql" });
    expect(queue.status).toBe("saved");
  });

  it("sends waiting edits before a structural change, in order", async () => {
    const queue = new SaveQueue(800);
    const calls: string[] = [];
    queue.patch("a", { content: "x" }, async () => void calls.push("patch"));
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
    queue.patch("a", { content: "keep me" }, send);
    await jest.advanceTimersByTimeAsync(800);
    expect(queue.status).toBe("error");

    await queue.retry();
    expect(send).toHaveBeenLastCalledWith({ content: "keep me" });
    expect(queue.status).toBe("saved");
  });

  it("does not overwrite a newer edit with a failed older one", async () => {
    const queue = new SaveQueue(800);
    let fail = true;
    const send = jest.fn(async () => {
      if (fail) {
        // The host types while the request is in flight.
        queue.patch("a", { content: "newer" }, send);
        throw new Error("offline");
      }
    });
    queue.patch("a", { content: "older" }, send);
    await jest.advanceTimersByTimeAsync(800);
    fail = false;
    await queue.retry();
    expect(send).toHaveBeenLastCalledWith({ content: "newer" });
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
    queue.patch("a", { content: "x" }, send);
    expect(listener).toHaveBeenCalled();

    queue.dispose();
    await jest.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    stop();
  });
});
