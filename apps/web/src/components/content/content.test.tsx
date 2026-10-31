import { screen, waitFor } from "@testing-library/react";
import type { SlideElement } from "@moddeck/shared";
import { renderWithIntl } from "@/test/render";
import { RichText } from "./RichText";
import { SlideRenderer, type RenderableSlide } from "./SlideRenderer";

let counter = 0;
const id = () => `0192f3a4-0000-7000-8000-${String(++counter).padStart(12, "0")}`;

const text = (source: string, extra: Partial<SlideElement> = {}): SlideElement =>
  ({
    id: id(),
    type: "text",
    x: 10,
    y: 10,
    w: 80,
    text: source,
    size: 3.4,
    bold: false,
    align: "left",
    ...extra,
  }) as SlideElement;

const code = (source: string, extra: Partial<SlideElement> = {}): SlideElement =>
  ({
    id: id(),
    type: "code",
    x: 5,
    y: 30,
    w: 90,
    code: source,
    language: "python",
    size: 2.2,
    ...extra,
  }) as SlideElement;

const math = (latex: string, extra: Partial<SlideElement> = {}): SlideElement =>
  ({
    id: id(),
    type: "math",
    x: 10,
    y: 60,
    w: 80,
    latex,
    size: 4.8,
    align: "center",
    ...extra,
  }) as SlideElement;

const image = (imageRef: string | null): SlideElement => ({
  id: id(),
  type: "image",
  x: 20,
  y: 20,
  w: 40,
  h: 50,
  imageRef,
});

const slide = (...elements: SlideElement[]): RenderableSlide => ({ kind: "content", elements });

const BAYES =
  "P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{\\sum_{i=1}^{n}P(B\\mid A_i)P(A_i)}+\\int_{-\\infty}^{\\infty}e^{-x^{2}}dx";

// 60 lines of Python, past the 50+ lines of the MD-3 test block.
const LONG_PYTHON = [
  "import math",
  "",
  ...Array.from({ length: 29 }, (_, i) => `def step_${i}(x):\n    return math.sqrt(x) + ${i}`),
].join("\n");

const frame = (container: HTMLElement, element: SlideElement) =>
  container.querySelector<HTMLElement>(`[data-element-id="${element.id}"]`)!;

describe("SlideRenderer", () => {
  it("puts each element at its place and size on the stage", () => {
    const heading = text("# Title", { x: 12.5, y: 8, w: 70 });
    const { container } = renderWithIntl(<SlideRenderer slide={slide(heading)} />, "en");
    expect(frame(container, heading)).toHaveStyle({ left: "12.5%", top: "8%", width: "70%" });
  });

  it("draws elements back to front, so the last one is on top", () => {
    const [a, b, c] = [text("a"), code("b"), math("c")];
    const { container } = renderWithIntl(<SlideRenderer slide={slide(b, c, a)} />, "en");
    const order = [...container.querySelectorAll("[data-element-id]")].map((n) =>
      n.getAttribute("data-element-id"),
    );
    expect(order).toEqual([b.id, c.id, a.id]);
  });

  it("applies the text weight and alignment", () => {
    const heading = text("Hello", { size: 5.5, bold: true, align: "center" });
    const { container } = renderWithIntl(<SlideRenderer slide={slide(heading)} />, "en");
    const box = frame(container, heading).firstElementChild as HTMLElement;
    // jsdom does not know the cqw unit and drops it, so the size is checked in the browser.
    expect(box.style.fontWeight).toBe("700");
    expect(box.style.textAlign).toBe("center");
  });

  it("renders a complex LaTeX formula", () => {
    const { container } = renderWithIntl(<SlideRenderer slide={slide(math(BAYES))} />, "en");
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector("[data-math-error]")).not.toBeInTheDocument();
  });

  it("shows an inline error for invalid LaTeX and still draws the other elements", () => {
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide(text("Still here"), math("\\frac{1"))} />,
      "en",
    );
    const error = container.querySelector("[data-math-error]") as HTMLElement;
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent("LaTeX error");
    expect(error).toHaveTextContent("\\frac{1");
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });

  it("renders a 50+ line code block in full, then colors it", async () => {
    const { container } = renderWithIntl(<SlideRenderer slide={slide(code(LONG_PYTHON))} />, "en");
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre.textContent).toBe(LONG_PYTHON);
    expect(LONG_PYTHON.split("\n").length).toBeGreaterThan(50);

    // The first highlight loads Shiki and Python, which is slow under Jest.
    await waitFor(() => expect(pre).toHaveAttribute("data-highlighted", "true"), {
      timeout: 15000,
    });
    expect(pre.textContent).toBe(LONG_PYTHON);
    const keyword = [...pre.querySelectorAll("span[style]")].find((s) => s.textContent === "def");
    expect(keyword).toHaveStyle({ color: "rgb(215, 58, 73)" });
  }, 20000);

  it("gives a code block a fixed height only when it has one", () => {
    const grow = code("a = 1");
    const fixed = code("b = 2", { h: 40 });
    const { container } = renderWithIntl(<SlideRenderer slide={slide(grow, fixed)} />, "en");
    expect(frame(container, grow).style.height).toBe("");
    expect(frame(container, fixed)).toHaveStyle({ height: "40%" });
  });

  it("puts text, code and a formula on one slide", async () => {
    const { container } = renderWithIntl(
      <SlideRenderer
        slide={slide(text("# Big O"), code("print(1)"), math("n\\log n"), text("with `sort()`"))}
      />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Big O" })).toBeInTheDocument();
    expect(container.querySelector("pre")).toHaveTextContent("print(1)");
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(screen.getByText("sort()").tagName).toBe("CODE");
    await waitFor(() =>
      expect(container.querySelector("pre")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("renders text with inline code, inline math and a fenced block", async () => {
    const source = "Use `sort()` when $n\\log n$ is fine.\n\n```sql\nSELECT 1;\n```";
    const { container } = renderWithIntl(<SlideRenderer slide={slide(text(source))} />, "en");
    expect(screen.getByText("sort()").tagName).toBe("CODE");
    expect(container.querySelector(".katex")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector("pre")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("serves an image from the api's slide-images path", () => {
    renderWithIntl(
      <SlideRenderer slide={slide(image("0192f3a4-0000-7000-8000-000000000002.png"))} />,
      "en",
    );
    expect(screen.getByRole("img", { name: "Slide image" })).toHaveAttribute(
      "src",
      "/api/slide-images/0192f3a4-0000-7000-8000-000000000002.png",
    );
  });

  it("shows hints in empty elements only when asked to, for the editor", () => {
    const empties = slide(text(""), code(""), math(""), image(null));
    const view = renderWithIntl(<SlideRenderer slide={empties} />, "en");
    expect(screen.queryByText("Type something")).not.toBeInTheDocument();
    view.unmount();

    renderWithIntl(<SlideRenderer slide={empties} placeholders />, "en");
    expect(screen.getByText("Type something")).toBeInTheDocument();
    expect(screen.getByText("Type or paste code")).toBeInTheDocument();
    expect(screen.getByText("Type a LaTeX formula")).toBeInTheDocument();
    expect(screen.getByText("No image yet")).toBeInTheDocument();
  });

  it("lets the editor decorate a frame and replace its content", () => {
    const a = text("one");
    const b = text("two");
    const { container } = renderWithIntl(
      <SlideRenderer
        slide={slide(a, b)}
        decorate={(el) =>
          el.id === a.id
            ? {
                props: { "data-selected": "true" } as never,
                content: <i>editing</i>,
                handles: <u>h</u>,
              }
            : {}
        }
      />,
      "en",
    );
    expect(frame(container, a)).toHaveAttribute("data-selected", "true");
    expect(frame(container, a)).toHaveTextContent("editing");
    expect(frame(container, a)).not.toHaveTextContent("one");
    expect(frame(container, a).querySelector("u")).toBeInTheDocument();
    expect(frame(container, b)).toHaveTextContent("two");
  });

  it("names an activity slide and shows its question", () => {
    renderWithIntl(
      <SlideRenderer
        slide={{
          kind: "poll",
          elements: [],
          activity: { type: "poll", prompt: "Which layer is `TCP`?" },
        }}
      />,
      "th",
    );
    expect(screen.getByText("โพลสด")).toBeInTheDocument();
    expect(screen.getByText("TCP").tagName).toBe("CODE");
  });

  it("draws a formula in a thumbnail without clipping its inner boxes", () => {
    // KaTeX builds a fraction from zero-size boxes that hang out of their parents, so an
    // `overflow: hidden` on every descendant cuts a formula down to its first symbols.
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide(math(BAYES))} mode="thumbnail" />,
      "en",
    );
    expect(container.firstElementChild?.className).not.toContain("**:overflow");
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
  });

  it("lets a formula wider than its box spill instead of scrolling, aligned as set", () => {
    const left = math("x", { align: "left" });
    const right = math("y", { align: "right" });
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide(math(BAYES, { w: 10 }), left, right)} />,
      "en",
    );
    const boxes = [...container.querySelectorAll<HTMLElement>("[data-align]")];
    expect(boxes.map((b) => b.dataset.align)).toEqual(["center", "left", "right"]);
    expect(boxes[0].className).toContain("justify-center");
    expect(boxes[2].className).toContain("justify-end");
    // The formula itself carries no scroll box.
    expect(container.querySelector(".overflow-x-auto")).not.toBeInTheDocument();
  });

  it("hides a thumbnail from screen readers and shows no hints in it", () => {
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide(text(""))} mode="thumbnail" placeholders />,
      "en",
    );
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("Type something")).not.toBeInTheDocument();
  });
});

describe("RichText", () => {
  it("shows broken math as the raw text without an error box", () => {
    const { container } = renderWithIntl(<RichText source="Solve $x^ now" />, "en");
    expect(container).toHaveTextContent("Solve $x^ now");
    expect(container.querySelector("[data-math-error]")).not.toBeInTheDocument();
  });

  it("renders good formulas around a broken one", () => {
    const { container } = renderWithIntl(<RichText source="$a$ then $\\frac{1}$ then $b$" />, "en");
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });
});
