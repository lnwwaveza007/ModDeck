import { renderMath } from "./math";
import { codeLanguageFromFence, parseInline, parseRichText } from "./rich-text";

describe("renderMath", () => {
  it("renders a complex formula: matrix, nested Bayes fraction, integral", () => {
    const formulas = [
      "\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}",
      "P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{\\sum_{i=1}^{n}P(B\\mid A_i)P(A_i)}",
      "\\int_{-\\infty}^{\\infty} e^{-x^{2}}\\,dx=\\sqrt{\\pi}",
    ];
    for (const latex of formulas) {
      const result = renderMath(latex);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.html).toContain("katex-display");
    }
  });

  it("returns inline markup without the display wrapper", () => {
    const result = renderMath("x^2", { display: false });
    expect(result.ok && result.html).not.toContain("katex-display");
  });

  it("returns an error value for invalid LaTeX instead of throwing", () => {
    for (const latex of ["\\frac{1", "x^", "\\notacommand{x}", "\\begin{pmatrix} a", "}"]) {
      const result = renderMath(latex);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.length).toBeGreaterThan(0);
        expect(result.error).not.toMatch(/^KaTeX parse error/);
      }
    }
  });

  it("treats empty source as valid and blocks links and runaway macros", () => {
    expect(renderMath("  ")).toEqual({ ok: true, html: "" });
    const link = renderMath("\\href{https://evil.test}{x}");
    expect(link.ok && link.html).not.toContain("href=");
    expect(renderMath("\\def\\a{\\a\\a}\\a").ok).toBe(false);
  });
});

describe("parseInline", () => {
  it("finds code and math", () => {
    expect(parseInline("Use `print` for $x^2$ ok")).toEqual([
      { type: "text", value: "Use " },
      { type: "code", value: "print" },
      { type: "text", value: " for " },
      { type: "math", value: "x^2" },
      { type: "text", value: " ok" },
    ]);
  });

  it("keeps broken or ambiguous markup as plain text", () => {
    expect(parseInline("$x^")).toEqual([{ type: "text", value: "$x^" }]);
    expect(parseInline("a ` b")).toEqual([{ type: "text", value: "a ` b" }]);
    expect(parseInline("it costs $5 and $10")).toEqual([
      { type: "text", value: "it costs $5 and $10" },
    ]);
    expect(parseInline("\\$5 \\`x\\`")).toEqual([{ type: "text", value: "$5 `x`" }]);
  });
});

describe("parseRichText", () => {
  it("splits headings, paragraphs, fenced code and display math", () => {
    const blocks = parseRichText(
      [
        "# Title",
        "",
        "first line",
        "second `x`",
        "",
        "```py",
        "a = 1",
        "",
        "b = 2",
        "```",
        "$$",
        "E=mc^2",
        "$$",
        "$$ y $$",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "code", "math", "math"]);
    expect(blocks[2]).toEqual({ type: "code", language: "python", value: "a = 1\n\nb = 2" });
    expect(blocks[3]).toEqual({ type: "math", value: "E=mc^2" });
    expect(blocks[4]).toEqual({ type: "math", value: "y" });
  });

  it("leaves an unfinished fence as text and accepts Windows line breaks", () => {
    expect(parseRichText("```py\nx = 1")).toEqual([
      {
        type: "paragraph",
        inlines: [{ type: "text", value: "```py\nx = 1" }],
      },
    ]);
    expect(parseRichText("a\r\n\r\nb")).toHaveLength(2);
  });

  it("returns no blocks for empty text", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("\n\n  \n")).toEqual([]);
  });
});

describe("codeLanguageFromFence", () => {
  it("maps names and aliases, and falls back to plain text", () => {
    expect(codeLanguageFromFence("sql")).toBe("sql");
    expect(codeLanguageFromFence(" JS ")).toBe("javascript");
    expect(codeLanguageFromFence("c++")).toBe("cpp");
    expect(codeLanguageFromFence("")).toBe("plaintext");
    expect(codeLanguageFromFence("cobol")).toBe("plaintext");
  });
});
