import { screen, waitFor, within } from "@testing-library/react";
import type { SlideDto } from "@moddeck/shared";
import { renderWithIntl } from "@/test/render";
import { RichText } from "./RichText";
import { SlideRenderer, type RenderableSlide } from "./SlideRenderer";

function slide(overrides: Partial<RenderableSlide>): RenderableSlide {
  return { kind: "text", content: null, language: null, imageRef: null, ...overrides };
}

const BAYES =
  "P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{\\sum_{i=1}^{n}P(B\\mid A_i)P(A_i)}+\\int_{-\\infty}^{\\infty}e^{-x^{2}}dx";

// 60 lines of Python, past the 50+ lines of the MD-3 test block.
const LONG_PYTHON = [
  "import math",
  "",
  ...Array.from({ length: 29 }, (_, i) => `def step_${i}(x):\n    return math.sqrt(x) + ${i}`),
].join("\n");

describe("SlideRenderer", () => {
  it("renders a complex LaTeX formula on a math slide", () => {
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide({ kind: "math", content: BAYES })} />,
      "en",
    );
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector("[data-math-error]")).not.toBeInTheDocument();
  });

  it("shows an inline error for invalid LaTeX instead of crashing", () => {
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide({ kind: "math", content: "\\frac{1" })} />,
      "en",
    );
    const error = container.querySelector("[data-math-error]") as HTMLElement;
    expect(error).toBeInTheDocument();
    expect(within(error).getByText("LaTeX error")).toBeInTheDocument();
    expect(error).toHaveTextContent("\\frac{1");
  });

  it("renders a 50+ line code block in full, then colors it", async () => {
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide({ kind: "code", content: LONG_PYTHON, language: "python" })} />,
      "en",
    );
    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre.textContent).toBe(LONG_PYTHON);
    expect(LONG_PYTHON.split("\n").length).toBeGreaterThan(50);

    // The first highlight loads Shiki and Python, which is slow under Jest.
    await waitFor(() => expect(pre).toHaveAttribute("data-highlighted", "true"), {
      timeout: 15000,
    });
    // The text is unchanged and keywords carry the github-light keyword color.
    expect(pre.textContent).toBe(LONG_PYTHON);
    const keyword = [...pre.querySelectorAll("span[style]")].find((s) => s.textContent === "def");
    expect(keyword).toHaveStyle({ color: "rgb(215, 58, 73)" });
  }, 20000);

  it("keeps the plain text when the language has no colors", () => {
    const { container } = renderWithIntl(
      <SlideRenderer
        slide={slide({ kind: "code", content: "a < b && c", language: "plaintext" })}
      />,
      "en",
    );
    expect(container.querySelector("pre")).toHaveTextContent("a < b && c");
  });

  it("renders text with a heading, inline code, inline math and a fenced block", async () => {
    const source = "# Big O\n\nUse `sort()` when $n\\log n$ is fine.\n\n```py\nprint(1)\n```";
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide({ content: source })} />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Big O" })).toBeInTheDocument();
    expect(screen.getByText("sort()").tagName).toBe("CODE");
    expect(container.querySelector(".katex")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector("pre")).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("serves an image slide from the api's slide-images path", () => {
    renderWithIntl(<SlideRenderer slide={slide({ kind: "image", imageRef: "abc.png" })} />, "en");
    expect(screen.getByRole("img", { name: "Slide image" })).toHaveAttribute(
      "src",
      "/api/slide-images/abc.png",
    );
  });

  it("names an activity slide and shows its question", () => {
    const activity: SlideDto["activity"] = { type: "poll", prompt: "Which layer is `TCP`?" };
    renderWithIntl(<SlideRenderer slide={slide({ kind: "poll", activity })} />, "th");
    expect(screen.getByText("โพลสด")).toBeInTheDocument();
    expect(screen.getByText("TCP").tagName).toBe("CODE");
  });

  it("hides a thumbnail from screen readers and shows empty hints only on the stage", () => {
    const { container } = renderWithIntl(
      <SlideRenderer slide={slide({ kind: "code" })} mode="thumbnail" />,
      "en",
    );
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("Empty code slide")).not.toBeInTheDocument();
  });

  it("tells the host when a stage slide is empty", () => {
    renderWithIntl(<SlideRenderer slide={slide({ kind: "code" })} />, "en");
    expect(screen.getByText("Empty code slide")).toBeInTheDocument();
  });
});

describe("RichText", () => {
  it("shows broken math as the raw text without an error box", () => {
    const { container } = renderWithIntl(<RichText source="Solve $x^ now" />, "en");
    expect(container).toHaveTextContent("Solve $x^ now");
    expect(container.querySelector("[data-math-error]")).not.toBeInTheDocument();
  });

  it("marks a broken inline formula between two good ones", () => {
    const { container } = renderWithIntl(<RichText source="$a$ then $\frac{1}$ then $b$" />, "en");
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });
});
