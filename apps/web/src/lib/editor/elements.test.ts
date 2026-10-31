import { slideElementSchema, type SlideElement, type TextElement } from "@moddeck/shared";
import {
  alignBox,
  clampSize,
  copyElement,
  createElement,
  elementBox,
  moveBox,
  moveLayer,
  presetOf,
  resizeBox,
  snapTargets,
  updateElement,
  type Box,
} from "./elements";

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

describe("createElement", () => {
  it("makes elements the api accepts, for every kind", () => {
    for (const type of ["heading", "text", "code", "math", "image"] as const) {
      const element = createElement(type, { imageRef: null });
      expect(slideElementSchema.safeParse(element).success).toBe(true);
    }
  });

  it("makes a heading a big bold text and a text a body-size one", () => {
    const heading = createElement("heading") as TextElement;
    const body = createElement("text") as TextElement;
    expect(heading).toMatchObject({ type: "text", bold: true, size: 5.5 });
    expect(body).toMatchObject({ type: "text", bold: false, size: 3.2 });
    expect(presetOf(heading)).toBe("heading");
    expect(presetOf(body)).toBe("body");
    expect(presetOf({ ...body, size: 3.6 })).toBeNull();
  });

  it("offsets later elements so they do not stack exactly", () => {
    expect(createElement("text", { index: 1 }).y).toBeGreaterThan(createElement("text").y);
    expect(createElement("text", { index: 6 }).y).toBe(createElement("text", { index: 0 }).y);
  });

  it("sizes an image to its shape and centers it on the slide", () => {
    const wide = createElement("image", { imageAspect: 16 / 9 });
    const tall = createElement("image", { imageAspect: 0.5 });
    for (const el of [wide, tall]) {
      expect(el.x + el.w).toBeLessThanOrEqual(100);
      expect(el.y + (el as { h: number }).h).toBeLessThanOrEqual(100);
    }
    expect(wide).toMatchObject({ w: 50, h: 50, x: 25, y: 25 });
    expect((tall as { h: number }).h).toBe(80);
    // Width in pixels / height in pixels stays the picture's own shape (16:9 stage).
    expect(((tall.w / 100) * 16) / (((tall as { h: number }).h / 100) * 9)).toBeCloseTo(0.5, 1);
  });
});

describe("copyElement", () => {
  it("copies with a new id, a little down and right, and still on the slide", () => {
    const original = createElement("code", { index: 0 });
    const copy = copyElement(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.x).toBe(original.x + 3);
    expect(copy.y).toBe(original.y + 3);
    const edge = copyElement({ ...original, x: 95, w: 5 } as SlideElement);
    expect(edge.x + edge.w).toBeLessThanOrEqual(100);
  });
});

describe("moveBox", () => {
  it("moves by the pointer's travel", () => {
    expect(moveBox(box(10, 10, 20, 20), 5, 7)).toMatchObject({ x: 15, y: 17 });
  });

  it("keeps the box on the slide", () => {
    expect(moveBox(box(10, 10, 20, 20), -50, -50)).toMatchObject({ x: 0, y: 0 });
    expect(moveBox(box(10, 10, 20, 20), 90, 90)).toMatchObject({ x: 80, y: 80 });
  });

  it("snaps the middle of the box to the middle of the slide and shows the guide", () => {
    const targets = snapTargets([]);
    const moved = moveBox(box(10, 10, 20, 20), 29.4, 0, targets); // center at 49.4
    expect(moved.x).toBe(40); // center on 50
    expect(moved.guides.x).toEqual([50]);
  });

  it("snaps to the edge of another element", () => {
    const targets = snapTargets([box(60, 10, 20, 20)]);
    const moved = moveBox(box(0, 50, 30, 10), 29.5, 0, targets); // right edge at 59.5
    expect(moved.x).toBe(30); // right edge on 60
    expect(moved.guides.x).toContain(60);
  });

  it("does not snap when the box is far from any line", () => {
    const moved = moveBox(box(10, 10, 20, 20), 5.5, 5.5, snapTargets([]));
    expect(moved.guides).toEqual({ x: [], y: [] });
    expect(moved.x).toBe(15.5);
  });
});

describe("resizeBox", () => {
  const start = box(20, 20, 40, 30);

  it("changes the width from the east side and from the west side", () => {
    expect(resizeBox(start, "e", 10, 0)).toMatchObject({ x: 20, w: 50 });
    expect(resizeBox(start, "w", -10, 0)).toMatchObject({ x: 10, w: 50 });
    expect(resizeBox(start, "w", 10, 0)).toMatchObject({ x: 30, w: 30 });
  });

  it("never goes below the minimum or off the slide", () => {
    expect(resizeBox(start, "e", -100, 0).w).toBe(4);
    expect(resizeBox(start, "w", 100, 0)).toMatchObject({ x: 56, w: 4 });
    expect(resizeBox(start, "e", 100, 0).w).toBe(80);
    expect(resizeBox(start, "w", -100, 0)).toMatchObject({ x: 0, w: 60 });
  });

  it("changes the height from the south and north sides", () => {
    expect(resizeBox(start, "s", 0, 10)).toMatchObject({ y: 20, h: 40 });
    expect(resizeBox(start, "n", 0, -10)).toMatchObject({ y: 10, h: 40 });
  });

  it("changes only the width for auto-height elements", () => {
    expect(resizeBox(start, "se", 10, 10, { widthOnly: true })).toMatchObject({ w: 50, h: 30 });
  });

  it("keeps the shape of a picture from a corner and anchors the opposite corner", () => {
    const se = resizeBox(start, "se", 20, 0, { keepAspect: true });
    expect(se).toMatchObject({ x: 20, y: 20, w: 60 });
    expect(se.h).toBeCloseTo(45, 1);

    const nw = resizeBox(start, "nw", -20, 0, { keepAspect: true });
    expect(nw.x + nw.w).toBeCloseTo(60, 1); // right edge stays
    expect(nw.y + nw.h).toBeCloseTo(50, 1); // bottom edge stays
    expect(nw.h / nw.w).toBeCloseTo(0.75, 2);
  });

  it("keeps a picture on the slide when a corner would push it out", () => {
    const grown = resizeBox(box(10, 50, 40, 30), "se", 200, 0, { keepAspect: true });
    expect(grown.y + grown.h).toBeLessThanOrEqual(100.1);
    expect(grown.x + grown.w).toBeLessThanOrEqual(100.1);
    expect(grown.h / grown.w).toBeCloseTo(0.75, 1);
  });
});

describe("alignBox", () => {
  const b = box(30, 40, 20, 10);

  it("aligns to the left, middle and right of the slide", () => {
    expect(alignBox(b, "left")).toEqual({ x: 0, y: 40 });
    expect(alignBox(b, "hcenter")).toEqual({ x: 40, y: 40 });
    expect(alignBox(b, "right")).toEqual({ x: 80, y: 40 });
  });

  it("aligns to the top, middle and bottom of the slide", () => {
    expect(alignBox(b, "top")).toEqual({ x: 30, y: 0 });
    expect(alignBox(b, "vcenter")).toEqual({ x: 30, y: 45 });
    expect(alignBox(b, "bottom")).toEqual({ x: 30, y: 90 });
  });
});

describe("moveLayer", () => {
  const list = ["a", "b", "c", "d"].map((id) => ({ id }) as unknown as SlideElement);
  const ids = (els: SlideElement[]) => els.map((e) => e.id).join("");

  it("moves one step or all the way", () => {
    expect(ids(moveLayer(list, "b", "forward"))).toBe("acbd");
    expect(ids(moveLayer(list, "c", "backward"))).toBe("acbd");
    expect(ids(moveLayer(list, "a", "front"))).toBe("bcda");
    expect(ids(moveLayer(list, "d", "back"))).toBe("dabc");
  });

  it("returns the same list when nothing moves or the id is unknown", () => {
    expect(moveLayer(list, "d", "front")).toBe(list);
    expect(moveLayer(list, "a", "back")).toBe(list);
    expect(moveLayer(list, "z", "front")).toBe(list);
  });
});

describe("updateElement and elementBox", () => {
  it("changes one element and keeps the others", () => {
    const a = createElement("text");
    const b = createElement("math");
    const next = updateElement([a, b], a.id, { x: 50 });
    expect(next[0]).toMatchObject({ id: a.id, x: 50 });
    expect(next[1]).toBe(b);
  });

  it("uses the stored height for images and fixed code, and the measured one otherwise", () => {
    const img = createElement("image", { imageAspect: 16 / 9 }) as SlideElement & { h: number };
    expect(elementBox(img, 99).h).toBe(img.h);
    const code = createElement("code") as SlideElement & { h?: number };
    expect(elementBox(code, 12).h).toBe(12);
    expect(elementBox({ ...code, h: 40 } as SlideElement, 12).h).toBe(40);
    expect(elementBox(createElement("text"), 7).h).toBe(7);
  });
});

describe("clampSize", () => {
  it("keeps a size in the api's range", () => {
    expect(clampSize(0.2)).toBe(1);
    expect(clampSize(55)).toBe(20);
    expect(clampSize(3.44)).toBe(3.4);
  });
});
