import { act, renderHook } from "@testing-library/react";
import { readDraft, useDraft, writeDraft } from "./drafts";

beforeEach(() => window.localStorage.clear());

describe("drafts", () => {
  it("keeps typed text across a remount (a dropped connection or a reload)", () => {
    const first = renderHook(() => useDraft("word:run1"));
    act(() => first.result.current[1]("photosynthesis"));
    first.unmount();

    const second = renderHook(() => useDraft("word:run1"));
    expect(second.result.current[0]).toBe("photosynthesis");
  });

  it("clears the draft once the server confirmed the answer", () => {
    const hook = renderHook(() => useDraft("word:run1"));
    act(() => hook.result.current[1]("cell"));
    act(() => hook.result.current[2]());

    expect(hook.result.current[0]).toBe("");
    expect(readDraft("word:run1")).toBe("");
  });

  it("still works when storage is blocked", () => {
    const blocked = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeDraft("q", "hello")).not.toThrow();
    const hook = renderHook(() => useDraft("q"));
    act(() => hook.result.current[1]("hello"));
    expect(hook.result.current[0]).toBe("hello");
    blocked.mockRestore();
  });
});
