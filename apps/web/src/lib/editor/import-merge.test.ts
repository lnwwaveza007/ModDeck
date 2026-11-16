import type { SlideDto } from "@moddeck/shared";
import { mergeImported } from "./import-merge";

const slide = (id: string, overrides: Partial<SlideDto> = {}): SlideDto => ({
  id,
  position: 0,
  kind: "content",
  elements: [],
  activity: null,
  importStatus: null,
  updatedAt: "2026-11-16T10:00:00.000Z",
  ...overrides,
});

const image = {
  id: "0192f3a4-0000-7000-8000-0000000000e1",
  type: "image" as const,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  imageRef: "0192f3a4-0000-7000-8000-0000000000f1.webp",
};

describe("mergeImported", () => {
  it("adds the slides that are new on the server at the end", () => {
    const merged = mergeImported(
      [slide("a")],
      [
        slide("a"),
        slide("p1", { importStatus: "pending" }),
        slide("p2", { importStatus: "pending" }),
      ],
    );
    expect(merged.map((s) => [s.id, s.position])).toEqual([
      ["a", 0],
      ["p1", 1],
      ["p2", 2],
    ]);
  });

  it("fills in a pending slide once the server has its page", () => {
    const merged = mergeImported(
      [slide("p1", { importStatus: "pending" })],
      [slide("p1", { elements: [image] })],
    );
    expect(merged[0].elements).toEqual([image]);
    expect(merged[0].importStatus).toBeNull();
  });

  it("keeps a pending slide that is still pending", () => {
    const local = slide("p1", { importStatus: "pending" });
    expect(mergeImported([local], [slide("p1", { importStatus: "pending" })])).toEqual([local]);
  });

  it("shows a page that failed, and a failed page that is tried again", () => {
    const failed = mergeImported(
      [slide("p1", { importStatus: "pending" })],
      [slide("p1", { importStatus: "failed" })],
    );
    expect(failed[0].importStatus).toBe("failed");
    const again = mergeImported(failed, [slide("p1", { importStatus: "pending" })]);
    expect(again[0].importStatus).toBe("pending");
  });

  it("keeps the host's edits and order on slides the import is not working on", () => {
    const edited = slide("a", { elements: [image], position: 1 });
    const merged = mergeImported([slide("b", { position: 0 }), edited], [slide("a"), slide("b")]);
    expect(merged.map((s) => s.id)).toEqual(["b", "a"]);
    expect(merged[1].elements).toEqual([image]);
  });

  it("leaves a slide that the server did not return as it is", () => {
    const merged = mergeImported(
      [slide("a"), slide("gone", { importStatus: "pending" })],
      [slide("a")],
    );
    expect(merged.map((s) => s.id)).toEqual(["a", "gone"]);
  });
});
