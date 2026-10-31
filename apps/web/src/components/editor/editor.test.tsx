import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DeckDetail, SlideDto, SlideElement } from "@moddeck/shared";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import {
  createSlide,
  deleteSlide,
  duplicateSlide,
  getDeck,
  reorderSlides,
  saveElements,
  uploadSlideImage,
} from "@/lib/api/slides";
import { readImageAspect } from "@/lib/editor/image";
import { renderWithIntl } from "@/test/render";
import { DeckEditor } from "./DeckEditor";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api/slides", () => ({
  ...jest.requireActual("@/lib/api/slides"),
  getDeck: jest.fn(),
  createSlide: jest.fn(),
  saveElements: jest.fn(),
  deleteSlide: jest.fn(),
  duplicateSlide: jest.fn(),
  reorderSlides: jest.fn(),
  uploadSlideImage: jest.fn(),
}));
// jsdom cannot decode a picture, so the file's shape is fixed here: twice as wide as it is tall.
jest.mock("@/lib/editor/image", () => ({ readImageAspect: jest.fn().mockResolvedValue(2) }));

const api = {
  get: jest.mocked(getDeck),
  create: jest.mocked(createSlide),
  save: jest.mocked(saveElements),
  remove: jest.mocked(deleteSlide),
  duplicate: jest.mocked(duplicateSlide),
  reorder: jest.mocked(reorderSlides),
  upload: jest.mocked(uploadSlideImage),
};

// jsdom has no PointerEvent, so one with coordinates stands in for it.
if (typeof window.PointerEvent === "undefined") {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

// No layout in jsdom: the stage is 1000 x 562.5 px (so 10 px = 1% across) and an element 100 px tall.
const STAGE = { width: 1000, height: 562.5 };
const FRAME_HEIGHT = 100;

const T1 = "0192f3a4-0000-7000-8000-0000000000a1";
const C1 = "0192f3a4-0000-7000-8000-0000000000a2";
const M1 = "0192f3a4-0000-7000-8000-0000000000a3";
const IMG = "0192f3a4-0000-7000-8000-0000000000a4";
const REF = "0192f3a4-0000-7000-8000-0000000000b1.png";

const heading: SlideElement = {
  id: T1,
  type: "text",
  x: 10,
  y: 10,
  w: 40,
  text: "# Routing",
  size: 3.2,
  bold: false,
  align: "left",
};
const snippet: SlideElement = {
  id: C1,
  type: "code",
  x: 10,
  y: 40,
  w: 80,
  code: "x = 1",
  language: "python",
  size: 2.2,
};
const formula: SlideElement = {
  id: M1,
  type: "math",
  x: 20,
  y: 70,
  w: 60,
  latex: "x^2",
  size: 4.8,
  align: "center",
};
const picture: SlideElement = {
  id: IMG,
  type: "image",
  x: 10,
  y: 10,
  w: 40,
  h: 50,
  imageRef: null,
};

const slide = (
  id: string,
  position: number,
  elements: SlideElement[],
  extra: Partial<SlideDto> = {},
): SlideDto => ({
  id,
  position,
  kind: "content",
  elements,
  activity: null,
  updatedAt: "2026-10-31T03:00:00.000Z",
  ...extra,
});

const first = slide("s1", 0, [heading, snippet, formula]);
const empty = slide("s2", 1, []);
const poll = slide("s3", 2, [], { kind: "poll", activity: { type: "poll", prompt: "Q" } });

function deck(slides: SlideDto[]): DeckDetail {
  return {
    id: "d1",
    title: "INT365 W05",
    slideCount: slides.length,
    sessionCount: 0,
    liveSessions: [],
    createdAt: "2026-10-01T03:00:00.000Z",
    updatedAt: "2026-10-30T03:00:00.000Z",
    slides,
  };
}

async function renderEditor(slides = [first, empty, poll], locale: "en" | "th" = "en") {
  api.get.mockResolvedValue(deck(slides));
  const view = renderWithIntl(
    <ToastProvider closeLabel="Close">
      <DeckEditor deckId="d1" />
    </ToastProvider>,
    locale,
  );
  await screen.findByRole("heading", { name: "INT365 W05" });
  return view;
}

const canvas = () => document.querySelector<HTMLElement>("[data-canvas]")!;
const stage = () => canvas().querySelector<HTMLElement>(".\\@container")!;
const frame = (id: string) => canvas().querySelector<HTMLElement>(`[data-element-id="${id}"]`)!;
const slideButton = (n: number) => screen.getByRole("button", { name: new RegExp(`^Slide ${n},`) });
const panel = () => screen.getByRole("complementary");
const undoButton = () =>
  screen.getAllByRole("button", { name: "Undo" }).find((button) => button.hasAttribute("title"))!;
const redoButton = () => screen.getByRole("button", { name: "Redo" });
/** The Undo button in a toast has text; the one in the toolbar is only an icon. */
const toastUndo = () =>
  screen.getAllByRole("button", { name: "Undo" }).find((button) => button.textContent === "Undo")!;

/** What the last autosave sent for the slide. */
const lastSaved = (slideId = "s1") => {
  const calls = api.save.mock.calls.filter(([, id]) => id === slideId);
  return calls[calls.length - 1]?.[2];
};
const find = (elements: SlideElement[] | undefined, id: string) =>
  elements?.find((el) => el.id === id);

/** Waits out the autosave pause. */
const flush = () => act(() => jest.advanceTimersByTimeAsync(900));

function drag(target: Element, dxPx: number, dyPx: number, from = { x: 500, y: 300 }) {
  fireEvent.pointerDown(target, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1 });
  fireEvent.pointerMove(stage(), { clientX: from.x + dxPx, clientY: from.y + dyPx, pointerId: 1 });
  fireEvent.pointerUp(stage(), { clientX: from.x + dxPx, clientY: from.y + dyPx, pointerId: 1 });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  jest.mocked(readImageAspect).mockResolvedValue(2);
  api.save.mockResolvedValue(first);
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const isStage = this.className.includes("@container");
    const width = isStage ? STAGE.width : 400;
    const height = isStage ? STAGE.height : FRAME_HEIGHT;
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON() {},
    };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("DeckEditor: the canvas", () => {
  it("shows the deck, its slides and the first slide's elements", async () => {
    await renderEditor();
    expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(3);
    expect(slideButton(1)).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Slide 1 of 3")).toBeInTheDocument();
    expect(within(canvas()).getByRole("heading", { name: "Routing" })).toBeInTheDocument();
    expect(canvas().querySelector("pre")).toHaveTextContent("x = 1");
    expect(frame(T1)).toHaveStyle({ left: "10%", top: "10%", width: "40%" });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows the layers when nothing is selected, front first, and selects from them", async () => {
    await renderEditor();
    expect(
      within(panel()).getByText(
        "Click an element on the slide to edit it, or add one from the bar above the slide.",
      ),
    ).toBeInTheDocument();
    const layers = within(panel()).getAllByRole("button", { name: /^(Text|Code|Formula)/ });
    expect(layers.map((b) => b.textContent)).toEqual([
      expect.stringContaining("Formula"),
      expect.stringContaining("Code"),
      expect.stringContaining("Text"),
    ]);

    fireEvent.click(layers[1]);
    expect(within(panel()).getByRole("heading", { name: "Code block" })).toBeInTheDocument();
  });

  it("selects an element on click and lets go on a click on the empty stage", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    expect(within(panel()).getByRole("heading", { name: "Text" })).toBeInTheDocument();
    expect(frame(T1).querySelectorAll("[data-handle]")).toHaveLength(2); // width handles only

    fireEvent.pointerDown(stage(), { button: 0 });
    expect(within(panel()).getByRole("heading", { name: "Slide" })).toBeInTheDocument();
    expect(frame(T1).querySelectorAll("[data-handle]")).toHaveLength(0);
  });

  it("moves an element by dragging and saves it once", async () => {
    await renderEditor();
    drag(frame(T1), 100, 56.25); // 10% across, 10% down
    expect(frame(T1)).toHaveStyle({ left: "20%", top: "20%" });

    await flush();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(find(lastSaved(), T1)).toMatchObject({ x: 20, y: 20, text: "# Routing" });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("does not move on a plain click, and keeps the element on the slide", async () => {
    await renderEditor();
    drag(frame(T1), 1, 1);
    expect(frame(T1)).toHaveStyle({ left: "10%", top: "10%" });

    drag(frame(T1), -5000, -5000);
    expect(frame(T1)).toHaveStyle({ left: "0%", top: "0%" });
  });

  it("snaps to the middle of the slide and shows a guide while dragging", async () => {
    await renderEditor();
    fireEvent.pointerDown(frame(T1), { clientX: 500, clientY: 300, button: 0, pointerId: 1 });
    // Box is 40 wide at x 10: moving 20.4% puts its middle at 50.4%, within snapping range.
    fireEvent.pointerMove(stage(), { clientX: 704, clientY: 300, pointerId: 1 });
    expect(stage().querySelector("[data-guide='x']")).toHaveStyle({ left: "50%" });
    expect(frame(T1)).toHaveStyle({ left: "30%" });

    fireEvent.pointerUp(stage(), { pointerId: 1 });
    expect(stage().querySelector("[data-guide]")).not.toBeInTheDocument();
  });

  it("resizes the width from a side handle", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    const east = frame(T1).querySelector("[data-handle='e']")!;
    drag(east, 100, 0);
    expect(frame(T1)).toHaveStyle({ width: "50%" });
    await flush();
    expect(find(lastSaved(), T1)).toMatchObject({ w: 50, x: 10 });

    drag(frame(T1).querySelector("[data-handle='w']")!, 50, 0);
    expect(frame(T1)).toHaveStyle({ left: "15%", width: "45%" });
  });

  it("gives a code block a fixed height from a bottom handle", async () => {
    await renderEditor();
    drag(frame(C1), 0, 0);
    expect(frame(C1).querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(frame(C1).style.height).toBe("");

    drag(frame(C1).querySelector("[data-handle='s']")!, 0, 112.5); // 20% of the height
    expect(frame(C1).style.height).not.toBe("");
    await flush();
    expect(find(lastSaved(), C1)).toMatchObject({ h: 37.8 }); // 100 px is 17.8% of the stage, plus the 20% dragged
  });

  it("nudges with the arrow keys, further with Shift", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    expect(frame(T1)).toHaveStyle({ left: "10.5%" });
    fireEvent.keyDown(canvas(), { key: "ArrowDown", shiftKey: true });
    expect(frame(T1)).toHaveStyle({ top: "12%" });
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    expect(frame(T1)).toHaveStyle({ left: "10%" });
  });

  it("deletes with the Delete key and duplicates with Ctrl+D", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    fireEvent.keyDown(canvas(), { key: "d", ctrlKey: true });
    expect(canvas().querySelectorAll("[data-element-id]")).toHaveLength(4);
    const copy = canvas().querySelectorAll("[data-element-id]")[1].getAttribute("data-element-id");
    expect(copy).not.toBe(T1);
    expect(frame(copy!)).toHaveStyle({ left: "13%", top: "13%" });

    fireEvent.keyDown(canvas(), { key: "Delete" });
    expect(canvas().querySelectorAll("[data-element-id]")).toHaveLength(3);
    await flush();
    expect(lastSaved()?.map((e) => e.id)).toEqual([T1, C1, M1]);
  });

  it("lets go with Escape and ignores keys when nothing is selected", async () => {
    await renderEditor();
    fireEvent.keyDown(canvas(), { key: "Delete" });
    expect(canvas().querySelectorAll("[data-element-id]")).toHaveLength(3);

    drag(frame(T1), 0, 0);
    fireEvent.keyDown(canvas(), { key: "Escape" });
    expect(within(panel()).getByRole("heading", { name: "Slide" })).toBeInTheDocument();
  });
});

describe("DeckEditor: adding elements", () => {
  it("adds a heading, ready to type in, and saves what is typed", async () => {
    await renderEditor([empty]);
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));

    const field = await within(canvas()).findByRole("textbox", { name: "Type something" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Week 5" } });
    expect(field).toHaveValue("Week 5");
    fireEvent.blur(field);
    expect(within(canvas()).getByText("Week 5")).toBeInTheDocument();

    await flush();
    expect(lastSaved("s2")).toMatchObject([
      { type: "text", text: "Week 5", size: 5.5, bold: true, align: "left" },
    ]);
  });

  it("adds text, code and a formula, each with its own defaults", async () => {
    await renderEditor([empty]);
    for (const name of ["Text", "Code", "Formula"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.blur(within(canvas()).getByRole("textbox"));
    }
    await flush();
    const saved = lastSaved("s2")!;
    expect(saved.map((e) => e.type)).toEqual(["text", "code", "math"]);
    expect(saved[0]).toMatchObject({ size: 3.2, bold: false });
    expect(saved[1]).toMatchObject({ language: "python", w: 80 });
    expect(saved[2]).toMatchObject({ align: "center" });
    // New elements are placed apart, so they do not hide each other.
    expect(new Set(saved.map((e) => e.y)).size).toBe(3);
  });

  it("types code and a formula straight on the slide", async () => {
    await renderEditor([empty]);
    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    fireEvent.change(within(canvas()).getByRole("textbox"), { target: { value: "SELECT 1;" } });
    // Escape leaves the field, like clicking away.
    fireEvent.keyDown(within(canvas()).getByRole("textbox"), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Formula" }));
    fireEvent.change(within(canvas()).getByRole("textbox"), { target: { value: "\\frac{1" } });
    fireEvent.blur(within(canvas()).getByRole("textbox"));
    // Invalid LaTeX is kept and shown as an inline error, not a crash.
    expect(canvas().querySelector("[data-math-error]")).toBeInTheDocument();

    await flush();
    expect(lastSaved("s2")).toMatchObject([{ code: "SELECT 1;" }, { latex: "\\frac{1" }]);
  });

  it("edits text in place on double-click and with Enter", async () => {
    await renderEditor();
    // A double-click is two presses, so the element is selected first.
    drag(frame(T1), 0, 0);
    fireEvent.doubleClick(frame(T1));
    const field = within(canvas()).getByRole("textbox", { name: "Type something" });
    expect(field).toHaveValue("# Routing");
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.blur(field);
    expect(within(canvas()).queryByRole("textbox")).not.toBeInTheDocument();

    // The element is still selected, so Enter starts editing again.
    fireEvent.keyDown(canvas(), { key: "Enter" });
    expect(within(canvas()).getByRole("textbox")).toBeInTheDocument();
  });

  it("adds an image sized to its own shape and centered", async () => {
    await renderEditor([empty]);
    api.upload.mockResolvedValue({ imageRef: REF });
    const file = new File([new Uint8Array(8)], "diagram.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Image", { selector: "input" }), {
      target: { files: [file] },
    });

    await waitFor(() => expect(api.upload).toHaveBeenCalledWith("d1", file));
    await waitFor(() => expect(canvas().querySelector("img")).toBeInTheDocument());
    expect(canvas().querySelector("img")).toHaveAttribute("src", `/api/slide-images/${REF}`);
    await flush();
    // 2:1 picture on a 16:9 stage: 50% wide, 50 * 16/9 / 2 = 44.4% tall.
    expect(lastSaved("s2")).toMatchObject([
      { type: "image", imageRef: REF, x: 25, w: 50, h: 44.4 },
    ]);
  });

  it("refuses a file that is not an image, or too large, before sending it", async () => {
    await renderEditor([empty]);
    const input = screen.getByLabelText("Image", { selector: "input" });
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });
    expect(await screen.findByText("Choose a PNG, JPEG, WebP or GIF file.")).toBeInTheDocument();

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText("This image is larger than 5 MB.")).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("replaces the picture of a selected image element", async () => {
    await renderEditor([slide("s1", 0, [{ ...picture, imageRef: REF }])]);
    drag(frame(IMG), 0, 0);
    expect(frame(IMG).querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(within(panel()).getByText("Replace image", { selector: "label" })).toBeInTheDocument();

    const next = "0192f3a4-0000-7000-8000-0000000000b2.jpg";
    api.upload.mockResolvedValue({ imageRef: next });
    const file = new File([new Uint8Array(8)], "b.jpg", { type: "image/jpeg" });
    fireEvent.change(within(panel()).getByLabelText("Image", { selector: "input" }), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(canvas().querySelector("img")).toHaveAttribute("src", `/api/slide-images/${next}`),
    );
    await flush();
    expect(find(lastSaved(), IMG)).toMatchObject({ imageRef: next, x: 10, w: 40, h: 50 });
  });

  it("keeps a picture's shape when a corner is dragged", async () => {
    await renderEditor([slide("s1", 0, [{ ...picture, imageRef: REF }])]);
    drag(frame(IMG), 0, 0);
    drag(frame(IMG).querySelector("[data-handle='se']")!, 100, 0); // 10% wider
    await flush();
    const saved = find(lastSaved(), IMG) as { w: number; h: number };
    expect(saved.w).toBe(50);
    expect(saved.h / saved.w).toBeCloseTo(50 / 40, 2);
  });
});

describe("DeckEditor: the side panel", () => {
  it("sets a text style, size, bold and alignment", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    const p = within(panel());

    fireEvent.click(p.getByRole("button", { name: "Heading" }));
    await flush();
    expect(find(lastSaved(), T1)).toMatchObject({ size: 5.5, bold: true });
    expect(p.getByRole("button", { name: "Heading" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(p.getByRole("button", { name: "Larger" }));
    fireEvent.click(p.getByRole("button", { name: "Bold" }));
    fireEvent.click(p.getByRole("button", { name: "Center" }));
    await flush();
    expect(find(lastSaved(), T1)).toMatchObject({ size: 5.9, bold: false, align: "center" });
    expect(frame(T1).firstElementChild).toHaveStyle({ textAlign: "center" });
    // 5.9 matches no preset any more.
    expect(p.getByRole("button", { name: "Heading" })).toHaveAttribute("aria-pressed", "false");
  });

  it("edits the text from the panel as well", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Text" }), {
      target: { value: "New words" },
    });
    expect(within(canvas()).getByText("New words")).toBeInTheDocument();
    await flush();
    expect(find(lastSaved(), T1)).toMatchObject({ text: "New words" });
  });

  it("changes the language and fixed height of a code block", async () => {
    await renderEditor();
    drag(frame(C1), 0, 0);
    const p = within(panel());
    expect(p.getByLabelText("Language")).toHaveValue("python");

    fireEvent.change(p.getByLabelText("Language"), { target: { value: "sql" } });
    fireEvent.click(p.getByRole("checkbox", { name: "Fixed height, scroll long code" }));
    await flush();
    expect(find(lastSaved(), C1)).toMatchObject({ language: "sql", h: 40 });
    expect(frame(C1)).toHaveStyle({ height: "40%" });

    fireEvent.click(p.getByRole("checkbox", { name: "Fixed height, scroll long code" }));
    await flush();
    expect((find(lastSaved(), C1) as { h?: number }).h).toBeUndefined();
    expect(frame(C1).style.height).toBe("");
  });

  it("shows invalid LaTeX as an error under the field and on the slide, and keeps working", async () => {
    await renderEditor();
    drag(frame(M1), 0, 0);
    fireEvent.change(within(panel()).getByLabelText("LaTeX formula"), {
      target: { value: "\\frac{1" },
    });

    expect(within(panel()).getByText(/^LaTeX error: /)).toBeInTheDocument();
    expect(within(panel()).getByLabelText("LaTeX formula")).toHaveAttribute("aria-invalid", "true");
    expect(canvas().querySelector("[data-math-error]")).toBeInTheDocument();
    // The other elements and the toolbar are still there.
    expect(within(canvas()).getByRole("heading", { name: "Routing" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Add to slide" })).toBeInTheDocument();

    fireEvent.change(within(panel()).getByLabelText("LaTeX formula"), { target: { value: "x^2" } });
    expect(canvas().querySelector("[data-math-error]")).not.toBeInTheDocument();
  });

  it("aligns an element to the slide", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0); // x 10, w 40; 100 px tall is 17.8% of the stage
    const p = within(panel());

    fireEvent.click(p.getByRole("button", { name: "Center horizontally" }));
    expect(frame(T1)).toHaveStyle({ left: "30%" });
    fireEvent.click(p.getByRole("button", { name: "Align right" }));
    expect(frame(T1)).toHaveStyle({ left: "60%" });
    fireEvent.click(p.getByRole("button", { name: "Align left" }));
    expect(frame(T1)).toHaveStyle({ left: "0%" });

    fireEvent.click(p.getByRole("button", { name: "Align top" }));
    expect(frame(T1)).toHaveStyle({ top: "0%" });
    fireEvent.click(p.getByRole("button", { name: "Center vertically" }));
    expect(frame(T1)).toHaveStyle({ top: "41.1%" });
    fireEvent.click(p.getByRole("button", { name: "Align bottom" }));
    expect(frame(T1)).toHaveStyle({ top: "82.2%" });
  });

  it("moves an element in the layer order", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    const p = within(panel());
    expect(p.getByRole("button", { name: "Send backward" })).toBeDisabled();
    expect(p.getByRole("button", { name: "Send to back" })).toBeDisabled();

    fireEvent.click(p.getByRole("button", { name: "Bring to front" }));
    await flush();
    expect(lastSaved()?.map((e) => e.id)).toEqual([C1, M1, T1]);
    expect(p.getByRole("button", { name: "Bring forward" })).toBeDisabled();

    fireEvent.click(p.getByRole("button", { name: "Send backward" }));
    await flush();
    expect(lastSaved()?.map((e) => e.id)).toEqual([C1, T1, M1]);
  });

  it("duplicates and deletes an element from the panel", async () => {
    await renderEditor();
    drag(frame(M1), 0, 0);
    fireEvent.click(within(panel()).getByRole("button", { name: "Duplicate" }));
    await flush();
    expect(lastSaved()?.map((e) => e.type)).toEqual(["text", "code", "math", "math"]);

    fireEvent.click(within(panel()).getByRole("button", { name: "Delete" }));
    await flush();
    expect(lastSaved()?.map((e) => e.id)).toEqual([T1, C1, M1]);
    expect(within(panel()).getByRole("heading", { name: "Slide" })).toBeInTheDocument();
  });

  it("explains that activity slides have no canvas yet", async () => {
    await renderEditor();
    fireEvent.click(slideButton(3));
    expect(
      within(panel()).getByText("The question and options editor is coming soon."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Add to slide" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Slide canvas" })).not.toBeInTheDocument();
  });
});

describe("DeckEditor: autosave", () => {
  it("sends one request for a whole drag and says Saving… then Saved", async () => {
    await renderEditor();
    fireEvent.pointerDown(frame(T1), { clientX: 500, clientY: 300, button: 0, pointerId: 1 });
    for (let step = 1; step <= 10; step++) {
      fireEvent.pointerMove(stage(), { clientX: 500 + step * 10, clientY: 300, pointerId: 1 });
    }
    fireEvent.pointerUp(stage(), { pointerId: 1 });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();

    await flush();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("offers to try again when saving fails, and keeps the change", async () => {
    await renderEditor();
    api.save.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    drag(frame(T1), 100, 0);
    await flush();
    expect(screen.getByText("Could not save")).toBeInTheDocument();
    expect(frame(T1)).toHaveStyle({ left: "20%" });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(find(lastSaved(), T1)).toMatchObject({ x: 20 });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});

describe("DeckEditor: slides", () => {
  it("adds a blank slide after the selected one and selects it", async () => {
    await renderEditor();
    api.create.mockResolvedValue(slide("n1", 1, []));
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const dialog = screen.getByRole("dialog", { name: "Add a slide" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Blank slide/ }));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(4),
    );
    expect(api.create).toHaveBeenCalledWith("d1", { kind: "content", position: 1 });
    expect(slideButton(2)).toHaveAttribute("aria-current", "true");
    expect(
      within(canvas()).getByText(/Add a heading, text, code, formula or image/),
    ).toBeInTheDocument();
  });

  it("offers Live Poll and Word Cloud, and Q&A as coming soon", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^Q&A/ })).toBeDisabled();

    api.create.mockResolvedValue(
      slide("p2", 1, [], { kind: "poll", activity: { type: "poll", prompt: "" } }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^Live Poll/ }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("d1", { kind: "poll", position: 1 }),
    );
    expect(
      await screen.findByText("The question and options editor is coming soon."),
    ).toBeInTheDocument();
  });

  it("duplicates the selected slide right after it", async () => {
    await renderEditor();
    api.duplicate.mockResolvedValue({ ...first, id: "s1b", position: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate slide" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(4),
    );
    expect(api.duplicate).toHaveBeenCalledWith("d1", "s1");
    expect(slideButton(2)).toHaveAttribute("aria-current", "true");
  });

  it("deletes a slide at once, with no confirmation, and selects its neighbour", async () => {
    await renderEditor();
    fireEvent.click(slideButton(2));
    api.remove.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(2),
    );
    expect(api.remove).toHaveBeenCalledWith("d1", "s2");
    expect(slideButton(2)).toHaveAccessibleName("Slide 2, Live Poll");
    expect(slideButton(2)).toHaveAttribute("aria-current", "true");
    expect(await screen.findByText("Slide deleted")).toBeInTheDocument();
    expect(toastUndo()).toBeInTheDocument();
  });

  it("keeps a live activity slide and says why", async () => {
    await renderEditor();
    fireEvent.click(slideButton(3));
    api.remove.mockRejectedValue(new ApiError(409, "ACTIVITY_LOCKED", "live"));
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));

    expect(await screen.findByText(/This activity is live in a session/)).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(3);
  });

  it("reorders with Move down and sends the full list of ids", async () => {
    await renderEditor();
    api.reorder.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(api.reorder).toHaveBeenCalledWith("d1", ["s2", "s1", "s3"]));
    expect(slideButton(1)).toHaveAccessibleName("Slide 1, Content");
    expect(slideButton(2)).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Move up" })).toBeEnabled();
  });

  it("disables Move up on the first slide and Move down on the last", async () => {
    await renderEditor();
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    fireEvent.click(slideButton(3));
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("reloads the deck when a reorder is refused", async () => {
    await renderEditor();
    api.reorder.mockRejectedValue(new ApiError(422, "INVALID_PAYLOAD", "mismatch"));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Could not complete that/)).toBeInTheDocument();
    expect(slideButton(2)).toHaveAccessibleName("Slide 2, Content");
  });

  it("sends waiting edits before a slide change, in order", async () => {
    await renderEditor();
    const calls: string[] = [];
    api.save.mockImplementation(async () => (calls.push("save"), first));
    api.reorder.mockImplementation(async () => (calls.push("reorder"), []));
    drag(frame(T1), 100, 0);
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(calls).toEqual(["save", "reorder"]);
  });

  it("shows an empty deck with a way to add the first slide", async () => {
    await renderEditor([]);
    expect(screen.getByText("This deck has no slides")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add slide" }).length).toBeGreaterThan(0);
  });

  it("answers a missing deck with the not-found state, and a logged-out host with the login page", async () => {
    api.get.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Deck not found"));
    const { unmount } = renderWithIntl(
      <ToastProvider closeLabel="Close">
        <DeckEditor deckId="gone" />
      </ToastProvider>,
      "en",
    );
    expect(await screen.findByText("This deck no longer exists.")).toBeInTheDocument();
    unmount();

    api.get.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "login"));
    renderWithIntl(
      <ToastProvider closeLabel="Close">
        <DeckEditor deckId="d1" />
      </ToastProvider>,
      "en",
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
  });

  it("works in Thai", async () => {
    await renderEditor([first], "th");
    expect(screen.getByText("บันทึกแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มสไลด์" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "เพิ่มลงในสไลด์" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "หัวข้อ" })).toBeInTheDocument();
    drag(frame(T1), 0, 0);
    expect(screen.getByRole("button", { name: "กึ่งกลางแนวนอน" })).toBeInTheDocument();
  });
});

describe("DeckEditor: undo and redo", () => {
  it("starts with both buttons off, and turns undo on after a change", async () => {
    await renderEditor();
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();

    drag(frame(T1), 100, 0);
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();
  });

  it("undoes a whole drag in one step, saves it, and redoes it", async () => {
    await renderEditor();
    fireEvent.pointerDown(frame(T1), { clientX: 500, clientY: 300, button: 0, pointerId: 1 });
    for (let step = 1; step <= 10; step++) {
      fireEvent.pointerMove(stage(), { clientX: 500 + step * 10, clientY: 300, pointerId: 1 });
    }
    fireEvent.pointerUp(stage(), { pointerId: 1 });
    expect(frame(T1)).toHaveStyle({ left: "20%" });

    fireEvent.click(undoButton());
    expect(frame(T1)).toHaveStyle({ left: "10%" });
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();
    await flush();
    expect(find(lastSaved(), T1)).toMatchObject({ x: 10 });

    fireEvent.click(redoButton());
    expect(frame(T1)).toHaveStyle({ left: "20%" });
    await flush();
    expect(find(lastSaved(), T1)).toMatchObject({ x: 20 });
  });

  it("makes a second drag a second step", async () => {
    await renderEditor();
    drag(frame(T1), 100, 0);
    drag(frame(T1), 100, 0);
    expect(frame(T1)).toHaveStyle({ left: "30%" });

    fireEvent.click(undoButton());
    expect(frame(T1)).toHaveStyle({ left: "20%" });
    fireEvent.click(undoButton());
    expect(frame(T1)).toHaveStyle({ left: "10%" });
  });

  it("works from the keyboard: Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y", async () => {
    await renderEditor();
    drag(frame(T1), 100, 0);

    fireEvent.keyDown(canvas(), { key: "z", ctrlKey: true });
    expect(frame(T1)).toHaveStyle({ left: "10%" });
    fireEvent.keyDown(canvas(), { key: "z", ctrlKey: true, shiftKey: true });
    expect(frame(T1)).toHaveStyle({ left: "20%" });
    fireEvent.keyDown(canvas(), { key: "z", metaKey: true });
    expect(frame(T1)).toHaveStyle({ left: "10%" });
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(frame(T1)).toHaveStyle({ left: "20%" });
  });

  it("leaves Ctrl+Z to a text box, which has its own undo", async () => {
    await renderEditor();
    drag(frame(T1), 100, 0);
    const field = within(panel()).getByRole("textbox", { name: "Text" });
    fireEvent.keyDown(field, { key: "z", ctrlKey: true });
    expect(frame(T1)).toHaveStyle({ left: "20%" });
  });

  it("brings back an element that was deleted, in its layer", async () => {
    await renderEditor();
    drag(frame(C1), 0, 0);
    fireEvent.keyDown(canvas(), { key: "Delete" });
    expect(canvas().querySelectorAll("[data-element-id]")).toHaveLength(2);

    fireEvent.click(undoButton());
    expect(
      [...canvas().querySelectorAll("[data-element-id]")].map((n) =>
        n.getAttribute("data-element-id"),
      ),
    ).toEqual([T1, C1, M1]);
    await flush();
    expect(lastSaved()?.map((e) => e.id)).toEqual([T1, C1, M1]);
  });

  it("undoes a typed edit made in the side panel", async () => {
    await renderEditor();
    drag(frame(T1), 0, 0);
    fireEvent.change(within(panel()).getByRole("textbox", { name: "Text" }), {
      target: { value: "Changed" },
    });
    expect(within(canvas()).getByText("Changed")).toBeInTheDocument();

    fireEvent.click(undoButton());
    expect(within(canvas()).queryByText("Changed")).not.toBeInTheDocument();
    expect(within(canvas()).getByRole("heading", { name: "Routing" })).toBeInTheDocument();
  });

  it("clears redo when something new is done", async () => {
    await renderEditor();
    drag(frame(T1), 100, 0);
    fireEvent.click(undoButton());
    expect(redoButton()).toBeEnabled();

    drag(frame(T1), 50, 0);
    expect(redoButton()).toBeDisabled();
  });

  it("goes back to the slide where a change was made", async () => {
    await renderEditor();
    drag(frame(T1), 100, 0);
    fireEvent.click(slideButton(2));
    expect(slideButton(2)).toHaveAttribute("aria-current", "true");

    fireEvent.click(undoButton());
    expect(slideButton(1)).toHaveAttribute("aria-current", "true");
    expect(frame(T1)).toHaveStyle({ left: "10%" });
  });

  it("brings a deleted slide back with its content, from the toast or the toolbar", async () => {
    await renderEditor();
    api.remove.mockResolvedValue(undefined);
    api.create.mockResolvedValue(slide("s1-new", 0, first.elements));
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    await screen.findByText("Slide deleted");
    expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(2);

    fireEvent.click(toastUndo());
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(3),
    );
    expect(api.create).toHaveBeenCalledWith("d1", {
      kind: "content",
      position: 0,
      elements: first.elements,
    });
    expect(slideButton(1)).toHaveAttribute("aria-current", "true");
    expect(within(canvas()).getByRole("heading", { name: "Routing" })).toBeInTheDocument();

    // Redo deletes the new slide again.
    api.remove.mockClear();
    fireEvent.click(redoButton());
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("d1", "s1-new"));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(2),
    );
  });

  it("keeps older steps working after a deleted slide comes back under a new id", async () => {
    await renderEditor();
    drag(frame(T1), 100, 0);
    api.remove.mockResolvedValue(undefined);
    api.create.mockResolvedValue(slide("s1-new", 0, first.elements));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Delete slide" }));
    await screen.findByText("Slide deleted");

    fireEvent.click(undoButton()); // the slide is back as s1-new
    await waitFor(() => expect(slideButton(1)).toBeInTheDocument());
    await waitFor(() => expect(api.create).toHaveBeenCalled());

    fireEvent.click(undoButton()); // the drag, now on the new slide
    await flush();
    expect(find(lastSaved("s1-new"), T1)).toMatchObject({ x: 10 });
  });

  it("takes back an added slide, and adds it again on redo", async () => {
    await renderEditor();
    api.create.mockResolvedValue(slide("n1", 1, []));
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Blank slide/ }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(4),
    );

    api.remove.mockResolvedValue(undefined);
    fireEvent.click(undoButton());
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("d1", "n1"));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(3),
    );

    api.create.mockResolvedValue(slide("n2", 1, []));
    fireEvent.click(redoButton());
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(4),
    );
    expect(api.create).toHaveBeenLastCalledWith("d1", {
      kind: "content",
      position: 1,
      elements: [],
    });
  });

  it("undoes and redoes a reorder", async () => {
    await renderEditor();
    api.reorder.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(api.reorder).toHaveBeenLastCalledWith("d1", ["s2", "s1", "s3"]));

    fireEvent.click(undoButton());
    await waitFor(() => expect(api.reorder).toHaveBeenLastCalledWith("d1", ["s1", "s2", "s3"]));
    expect(slideButton(1)).toHaveAccessibleName("Slide 1, Content");

    fireEvent.click(redoButton());
    await waitFor(() => expect(api.reorder).toHaveBeenLastCalledWith("d1", ["s2", "s1", "s3"]));
  });

  it("says so and reloads when a slide step cannot be undone", async () => {
    await renderEditor();
    api.reorder
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiError(422, "INVALID_PAYLOAD", "x"));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(api.reorder).toHaveBeenCalledTimes(1));

    fireEvent.click(undoButton());
    expect(await screen.findByText(/Could not complete that/)).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    // What the server has replaces the steps, so there is nothing left to undo.
    expect(undoButton()).toBeDisabled();
  });
});
