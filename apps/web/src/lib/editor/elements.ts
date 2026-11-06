// Element logic for the slide canvas, kept free of React and the DOM so it can be tested. Boxes are
// percent of the 16:9 stage: x and w of its width, y and h of its height. Text, formula and
// code blocks grow with their content, so the editor measures their height and passes it in.

import {
  DEFAULT_CODE_LANGUAGE,
  type CodeElement,
  type ImageElement,
  type MathElement,
  type SlideElement,
  type SlideElementType,
  type TextAlign,
  type TextElement,
} from "@moddeck/shared";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type LayerMove = "front" | "forward" | "backward" | "back";

export const MIN_WIDTH = 4;
export const MIN_HEIGHT = 4;
export const SNAP_DISTANCE = 1.2;

const round = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

// Font sizes are shown in pt, as in PowerPoint. The stage is 13.333 in wide, which is 960 pt, so a
// pt size is `pt * 100 / 960` percent of the stage width. The renderer draws that percent as CSS
// `cqw`, so a 44 pt heading is the same size on the projector as in PowerPoint.
export const STAGE_WIDTH_PT = 960;
export const ptToSize = (pt: number) => Math.round(((pt * 100) / STAGE_WIDTH_PT) * 1000) / 1000;
export const sizeToPt = (size: number) => (size * STAGE_WIDTH_PT) / 100;

export const TEXT_PRESETS = {
  heading: { size: ptToSize(44), bold: true },
  subheading: { size: ptToSize(32), bold: true },
  body: { size: ptToSize(24), bold: false },
  small: { size: ptToSize(18), bold: false },
} as const;
export type TextPreset = keyof typeof TEXT_PRESETS;

export function presetOf(element: TextElement): TextPreset | null {
  const match = (Object.keys(TEXT_PRESETS) as TextPreset[]).find(
    (name) => TEXT_PRESETS[name].size === element.size && TEXT_PRESETS[name].bold === element.bold,
  );
  return match ?? null;
}

/** The stepper moves in whole pt, within 10 pt and 192 pt (the api's 1 to 20 percent). */
export const SIZE_STEP_PT = 2;
const MIN_SIZE = ptToSize(10);
const MAX_SIZE = 20;
export const clampSize = (size: number) =>
  Math.round(clamp(size, MIN_SIZE, MAX_SIZE) * 1000) / 1000;

/** The size `steps` stepper clicks away, counted in whole pt. */
export const stepSize = (size: number, steps: number) =>
  clampSize(ptToSize(Math.round(sizeToPt(size)) + steps * SIZE_STEP_PT));

/** What a new element of each kind looks like. `index` offsets it so new ones do not stack. */
export function createElement(
  type: SlideElementType | "heading",
  { index = 0, imageRef = null, imageAspect = 16 / 9 }: CreateOptions = {},
): SlideElement {
  const id = crypto.randomUUID();
  const shift = (index % 6) * 3;
  switch (type) {
    case "heading":
      return {
        id,
        type: "text",
        x: 10,
        y: 8 + shift,
        w: 80,
        text: "",
        ...TEXT_PRESETS.heading,
        align: "left",
      };
    case "text":
      return {
        id,
        type: "text",
        x: 10,
        y: 30 + shift,
        w: 80,
        text: "",
        ...TEXT_PRESETS.body,
        align: "left",
      };
    case "code":
      return {
        id,
        type: "code",
        x: 10,
        y: 30 + shift,
        w: 80,
        code: "",
        language: DEFAULT_CODE_LANGUAGE,
        size: ptToSize(18),
      };
    case "math":
      return {
        id,
        type: "math",
        x: 20,
        y: 50 + shift,
        w: 60,
        latex: "",
        size: ptToSize(36),
        align: "center",
      };
    case "image": {
      // Half the slide wide, as tall as the picture's own shape allows, centered.
      let w = 50;
      let h = (w * (16 / 9)) / imageAspect;
      if (h > 80) {
        h = 80;
        w = (h * imageAspect) / (16 / 9);
      }
      return {
        id,
        type: "image",
        x: round((100 - w) / 2),
        y: round((100 - h) / 2),
        w: round(w),
        h: round(h),
        imageRef,
      };
    }
  }
}

export interface CreateOptions {
  index?: number;
  imageRef?: string | null;
  /** Picture width divided by height. */
  imageAspect?: number;
}

/** A copy a little down and right of the original, so both can be seen. */
export function copyElement(element: SlideElement): SlideElement {
  return {
    ...element,
    id: crypto.randomUUID(),
    x: round(clamp(element.x + 3, 0, 100 - element.w)),
    y: round(clamp(element.y + 3, 0, 96)),
  };
}

export function elementBox(element: SlideElement, measuredHeight: number): Box {
  const fixed = element.type === "image" || (element.type === "code" && element.h !== undefined);
  return {
    x: element.x,
    y: element.y,
    w: element.w,
    h: fixed ? (element as ImageElement | CodeElement).h! : measuredHeight,
  };
}

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Lines an element snaps to: the slide's edges and middle, and the other elements' edges and middles. */
export function snapTargets(others: Box[]): SnapTargets {
  const xs = [0, 50, 100];
  const ys = [0, 50, 100];
  for (const box of others) {
    xs.push(box.x, box.x + box.w / 2, box.x + box.w);
    ys.push(box.y, box.y + box.h / 2, box.y + box.h);
  }
  return { xs, ys };
}

function snapAxis(start: number, size: number, targets: number[]) {
  // The three lines of the box: its start, middle and end.
  let best: { shift: number; line: number } | null = null;
  for (const offset of [0, size / 2, size]) {
    for (const target of targets) {
      const shift = target - (start + offset);
      if (Math.abs(shift) <= SNAP_DISTANCE && (!best || Math.abs(shift) < Math.abs(best.shift))) {
        best = { shift, line: target };
      }
    }
  }
  return best;
}

export interface Moved {
  x: number;
  y: number;
  /** Lines to draw while the element is snapped to them. */
  guides: { x: number[]; y: number[] };
}

/** Moves a box by the pointer's travel (percent), keeps it on the stage, snaps to nearby lines. */
export function moveBox(start: Box, dx: number, dy: number, targets?: SnapTargets): Moved {
  let x = clamp(start.x + dx, 0, Math.max(0, 100 - start.w));
  let y = clamp(start.y + dy, 0, Math.max(0, 100 - start.h));
  const guides: Moved["guides"] = { x: [], y: [] };
  if (targets) {
    const sx = snapAxis(x, start.w, targets.xs);
    if (sx) {
      x = clamp(x + sx.shift, 0, Math.max(0, 100 - start.w));
      guides.x.push(sx.line);
    }
    const sy = snapAxis(y, start.h, targets.ys);
    if (sy) {
      y = clamp(y + sy.shift, 0, Math.max(0, 100 - start.h));
      guides.y.push(sy.line);
    }
  }
  return { x: round(x), y: round(y), guides };
}

export interface ResizeOptions {
  /** Corner handles keep the picture's shape. */
  keepAspect?: boolean;
  /** Only the sides that change the width: text, formula and code grow with their content. */
  widthOnly?: boolean;
}

/** Resizes a box by dragging one handle by the pointer's travel (percent). */
export function resizeBox(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  { keepAspect = false, widthOnly = false }: ResizeOptions = {},
): Box {
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;

  if (handle.includes("e")) w = clamp(start.w + dx, MIN_WIDTH, 100 - start.x);
  if (handle.includes("w")) {
    x = clamp(start.x + dx, 0, right - MIN_WIDTH);
    w = right - x;
  }
  if (!widthOnly) {
    if (handle.includes("s")) h = clamp(start.h + dy, MIN_HEIGHT, 100 - start.y);
    if (handle.includes("n")) {
      y = clamp(start.y + dy, 0, bottom - MIN_HEIGHT);
      h = bottom - y;
    }
  }

  if (keepAspect && handle.length === 2) {
    // The width follows the pointer; the height keeps the shape and the opposite corner stays put.
    const ratio = start.h / start.w;
    h = w * ratio;
    if (handle.includes("n")) y = bottom - h;
    if (y < 0) {
      y = 0;
      h = bottom;
      w = h / ratio;
      if (handle.includes("w")) x = right - w;
    }
    if (y + h > 100) {
      h = 100 - y;
      w = h / ratio;
      if (handle.includes("w")) x = right - w;
    }
  }
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** Moves a box flush to an edge of the slide, or to its middle. */
export function alignBox(box: Box, edge: AlignEdge): { x: number; y: number } {
  switch (edge) {
    case "left":
      return { x: 0, y: box.y };
    case "hcenter":
      return { x: round((100 - box.w) / 2), y: box.y };
    case "right":
      return { x: round(100 - box.w), y: box.y };
    case "top":
      return { x: box.x, y: 0 };
    case "vcenter":
      return { x: box.x, y: round((100 - box.h) / 2) };
    case "bottom":
      return { x: box.x, y: round(Math.max(0, 100 - box.h)) };
  }
}

/** Moves one element in the back-to-front order. */
export function moveLayer(elements: SlideElement[], id: string, move: LayerMove): SlideElement[] {
  const from = elements.findIndex((element) => element.id === id);
  if (from === -1) return elements;
  const to = {
    front: elements.length - 1,
    forward: Math.min(from + 1, elements.length - 1),
    backward: Math.max(from - 1, 0),
    back: 0,
  }[move];
  if (to === from) return elements;
  const next = [...elements];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Applies a change to one element, leaving the rest and their order as they are. */
export function updateElement<T extends SlideElement>(
  elements: SlideElement[],
  id: string,
  change: Partial<T>,
): SlideElement[] {
  return elements.map((element) =>
    element.id === id ? ({ ...element, ...change } as SlideElement) : element,
  );
}

/** The smallest box that holds every box given. */
export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Puts the elements in `starts` where they began plus (dx, dy), and leaves the rest alone. A group
 * move calls this with the same starts on every pointer move, so the group never drifts.
 */
export function placeElements(
  elements: SlideElement[],
  starts: ReadonlyMap<string, { x: number; y: number }>,
  dx: number,
  dy: number,
): SlideElement[] {
  return elements.map((element) => {
    const start = starts.get(element.id);
    if (!start) return element;
    return {
      ...element,
      x: round(clamp(start.x + dx, 0, Math.max(0, 100 - element.w))),
      y: round(clamp(start.y + dy, 0, 100)),
    };
  });
}

/** The ids of the boxes a rectangle touches. For the drag-to-select rectangle. */
export function idsInRect(rect: Box, boxes: { id: string; box: Box }[]): string[] {
  return boxes
    .filter(
      ({ box }) =>
        box.x <= rect.x + rect.w &&
        box.x + box.w >= rect.x &&
        box.y <= rect.y + rect.h &&
        box.y + box.h >= rect.y,
    )
    .map(({ id }) => id);
}

/**
 * Moves a group in the back-to-front order, as a block: the elements keep their order among
 * themselves, and each one steps past the nearest element that is not in the group.
 */
export function moveLayers(
  elements: SlideElement[],
  ids: readonly string[],
  move: LayerMove,
): SlideElement[] {
  const picked = new Set(ids);
  if (!elements.some((element) => picked.has(element.id))) return elements;
  let next = [...elements];
  if (move === "front") {
    next = [
      ...elements.filter((el) => !picked.has(el.id)),
      ...elements.filter((el) => picked.has(el.id)),
    ];
  } else if (move === "back") {
    next = [
      ...elements.filter((el) => picked.has(el.id)),
      ...elements.filter((el) => !picked.has(el.id)),
    ];
  } else if (move === "forward") {
    for (let i = next.length - 2; i >= 0; i--) {
      if (picked.has(next[i].id) && !picked.has(next[i + 1].id)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (picked.has(next[i].id) && !picked.has(next[i - 1].id)) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
  }
  return next.every((element, index) => element === elements[index]) ? elements : next;
}

/** Copies each picked element and puts the copies just above the highest one picked. */
export function copyElements(
  elements: SlideElement[],
  ids: readonly string[],
): { elements: SlideElement[]; copyIds: string[] } {
  const picked = new Set(ids);
  const originals = elements.filter((element) => picked.has(element.id));
  if (originals.length === 0) return { elements, copyIds: [] };
  const copies = originals.map(copyElement);
  const top = elements.reduce((last, element, i) => (picked.has(element.id) ? i : last), -1);
  return {
    elements: [...elements.slice(0, top + 1), ...copies, ...elements.slice(top + 1)],
    copyIds: copies.map((copy) => copy.id),
  };
}

export function isTextual(element: SlideElement): element is TextElement | MathElement {
  return element.type === "text" || element.type === "math";
}

export type { TextAlign };
