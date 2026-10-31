import type { SlideElement } from "@moddeck/shared";
import { HISTORY_LIMIT, History, MERGE_WINDOW_MS } from "./history";

const el = (x: number): SlideElement => ({
  id: "0192f3a4-0000-7000-8000-000000000001",
  type: "text",
  x,
  y: 10,
  w: 40,
  text: "t",
  size: 3.2,
  bold: false,
  align: "left",
});
const list = (x: number) => [el(x)];

describe("History", () => {
  it("starts empty", () => {
    const history = new History();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.snapshot).toBe("00");
  });

  it("undoes and redoes a canvas change", async () => {
    const history = new History();
    const apply = jest.fn();
    history.record("a", list(10), list(20), 0);
    expect(history.snapshot).toBe("10");

    await history.undo(apply);
    expect(apply).toHaveBeenLastCalledWith("a", list(10));
    expect(history.snapshot).toBe("01");

    await history.redo(apply);
    expect(apply).toHaveBeenLastCalledWith("a", list(20));
    expect(history.snapshot).toBe("10");
  });

  it("merges a quick burst on one slide into one step, keeping the first before", async () => {
    const history = new History();
    const apply = jest.fn();
    history.record("a", list(10), list(11), 0);
    history.record("a", list(11), list(12), 100);
    history.record("a", list(12), list(13), 200);

    await history.undo(apply);
    expect(apply).toHaveBeenCalledWith("a", list(10));
    expect(history.canUndo).toBe(false);
    await history.redo(apply);
    expect(apply).toHaveBeenLastCalledWith("a", list(13));
  });

  it("starts a new step after a pause, for another slide, or after breakGroup", async () => {
    const history = new History();
    const apply = jest.fn();
    history.record("a", list(1), list(2), 0);
    history.record("a", list(2), list(3), MERGE_WINDOW_MS + 1);
    history.record("b", list(5), list(6), MERGE_WINDOW_MS + 2);
    history.breakGroup();
    history.record("b", list(6), list(7), MERGE_WINDOW_MS + 3);

    await history.undo(apply);
    expect(apply).toHaveBeenLastCalledWith("b", list(6));
    await history.undo(apply);
    expect(apply).toHaveBeenLastCalledWith("b", list(5));
    await history.undo(apply);
    expect(apply).toHaveBeenLastCalledWith("a", list(2));
    await history.undo(apply);
    expect(apply).toHaveBeenLastCalledWith("a", list(1));
    expect(history.canUndo).toBe(false);
  });

  it("leaves no step for a burst that ends where it began", () => {
    const history = new History();
    history.record("a", list(10), list(20), 0);
    history.record("a", list(20), list(10), 50);
    expect(history.canUndo).toBe(false);
  });

  it("clears what was undone when something new is done", async () => {
    const history = new History();
    const apply = jest.fn();
    history.record("a", list(1), list(2), 0);
    await history.undo(apply);
    expect(history.canRedo).toBe(true);

    history.record("a", list(1), list(9), 10_000);
    expect(history.canRedo).toBe(false);
  });

  it("runs slide commands in order, with canvas steps between them", async () => {
    const history = new History();
    const calls: string[] = [];
    const apply = jest.fn((slide: string) => void calls.push(`elements:${slide}`));
    history.record("a", list(1), list(2), 0);
    history.pushCommand({
      undo: async () => void calls.push("undo-delete"),
      redo: async () => void calls.push("redo-delete"),
    });
    history.record("b", list(1), list(2), 1);

    await history.undo(apply);
    await history.undo(apply);
    await history.undo(apply);
    expect(calls).toEqual(["elements:b", "undo-delete", "elements:a"]);

    await history.redo(apply);
    await history.redo(apply);
    expect(calls.slice(3)).toEqual(["elements:a", "redo-delete"]);
  });

  it("does not merge a canvas change into the step before a slide command", async () => {
    const history = new History();
    const apply = jest.fn();
    history.record("a", list(1), list(2), 0);
    history.pushCommand({ undo: async () => {}, redo: async () => {} });
    history.record("a", list(2), list(3), 10);
    await history.undo(apply);
    expect(apply).toHaveBeenCalledWith("a", list(2));
    expect(history.snapshot).toBe("11");
  });

  it("keeps a step where it was when its slide command fails", async () => {
    const history = new History();
    history.pushCommand({
      undo: () => Promise.reject(new Error("409")),
      redo: async () => {},
    });
    await expect(history.undo(jest.fn())).rejects.toThrow("409");
    expect(history.snapshot).toBe("10");
  });

  it("does nothing when there is nothing to undo or redo", async () => {
    const history = new History();
    const apply = jest.fn();
    await history.undo(apply);
    await history.redo(apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("forgets everything on clear and keeps only the newest steps", async () => {
    const history = new History();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      history.record(`s${i}`, list(0), list(1), i * 1000);
    }
    const apply = jest.fn();
    let undone = 0;
    while (history.canUndo) {
      await history.undo(apply);
      undone++;
    }
    expect(undone).toBe(HISTORY_LIMIT);

    history.record("a", list(1), list(2), 0);
    history.clear();
    expect(history.snapshot).toBe("00");
  });

  it("tells subscribers about each change", async () => {
    const history = new History();
    const listener = jest.fn();
    const stop = history.subscribe(listener);
    history.record("a", list(1), list(2), 0);
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    stop();
    await history.undo(jest.fn());
    expect(listener).not.toHaveBeenCalled();
  });
});
