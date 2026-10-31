import {
  CODE_LANGUAGES,
  DECK_SLIDES_MAX,
  ELEMENT_TEXT_MAX,
  SLIDE_ELEMENTS_MAX,
  isActivityKind,
  isCodeLanguage,
  slideCreateBodySchema,
  slideElementSchema,
  slideOrderBodySchema,
  slidePatchBodySchema,
} from "./slides";

const id = "0192f3a4-0000-7000-8000-000000000001";
const ref = "0192f3a4-0000-7000-8000-000000000002.png";

const text = {
  id,
  type: "text" as const,
  x: 10,
  y: 10,
  w: 80,
  text: "# Hello",
  size: 3.4,
  bold: false,
  align: "left" as const,
};
const code = {
  id,
  type: "code" as const,
  x: 5,
  y: 30,
  w: 90,
  code: "print(1)",
  language: "python" as const,
  size: 2.2,
};
const math = {
  id,
  type: "math" as const,
  x: 10,
  y: 60,
  w: 80,
  latex: "x^2",
  size: 4.8,
  align: "center" as const,
};
const image = { id, type: "image" as const, x: 0, y: 0, w: 100, h: 100, imageRef: ref };

describe("slideElementSchema", () => {
  it("accepts a text, code, math and image element", () => {
    for (const element of [text, code, math, image]) {
      expect(slideElementSchema.safeParse(element).success).toBe(true);
    }
    expect(slideElementSchema.safeParse({ ...image, imageRef: null }).success).toBe(true);
  });

  it("does not check LaTeX syntax, so a typo is saved and shown as an inline error", () => {
    expect(slideElementSchema.safeParse({ ...math, latex: "\\frac{1" }).success).toBe(true);
  });

  it("rejects a position or size outside the stage", () => {
    expect(slideElementSchema.safeParse({ ...text, x: -1 }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...text, y: 101 }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...text, w: 1 }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...text, size: 0 }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...image, h: 0 }).success).toBe(false);
  });

  it("rejects text that is too long, an unknown language, an unknown type or a missing field", () => {
    expect(
      slideElementSchema.safeParse({ ...text, text: "x".repeat(ELEMENT_TEXT_MAX.text + 1) })
        .success,
    ).toBe(false);
    expect(slideElementSchema.safeParse({ ...code, language: "cobol" }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...text, type: "video" }).success).toBe(false);
    expect(slideElementSchema.safeParse({ ...text, align: undefined }).success).toBe(false);
  });

  it("only accepts an image file name the api wrote", () => {
    for (const imageRef of ["../x.png", "a.svg", "https://evil.test/a.png", id]) {
      expect(slideElementSchema.safeParse({ ...image, imageRef }).success).toBe(false);
    }
  });

  it("gives a code block an optional fixed height", () => {
    expect(slideElementSchema.safeParse({ ...code, h: 40 }).success).toBe(true);
    expect(slideElementSchema.safeParse({ ...code, h: 1 }).success).toBe(false);
  });

  it("accepts a 50+ line code block", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `    step_${i}(x)`).join("\n");
    expect(slideElementSchema.safeParse({ ...code, code: lines }).success).toBe(true);
  });
});

describe("slideCreateBodySchema", () => {
  it("accepts a kind with an optional position and elements", () => {
    expect(slideCreateBodySchema.safeParse({ kind: "content" }).success).toBe(true);
    expect(
      slideCreateBodySchema.safeParse({ kind: "content", position: 2, elements: [text, code] })
        .success,
    ).toBe(true);
    expect(slideCreateBodySchema.safeParse({ kind: "poll" }).success).toBe(true);
  });

  it("rejects an unknown or removed kind and a negative position", () => {
    expect(slideCreateBodySchema.safeParse({ kind: "video" }).success).toBe(false);
    expect(slideCreateBodySchema.safeParse({ kind: "code" }).success).toBe(false);
    expect(slideCreateBodySchema.safeParse({ kind: "content", position: -1 }).success).toBe(false);
  });
});

describe("slidePatchBodySchema", () => {
  it("takes the whole element list, empty included", () => {
    expect(slidePatchBodySchema.safeParse({ elements: [] }).success).toBe(true);
    expect(slidePatchBodySchema.safeParse({ elements: [text, image] }).success).toBe(true);
  });

  it("rejects a missing list, a bad element and too many elements", () => {
    expect(slidePatchBodySchema.safeParse({}).success).toBe(false);
    expect(slidePatchBodySchema.safeParse({ elements: [{ ...text, w: 500 }] }).success).toBe(false);
    expect(
      slidePatchBodySchema.safeParse({ elements: Array(SLIDE_ELEMENTS_MAX + 1).fill(text) })
        .success,
    ).toBe(false);
  });
});

describe("slideOrderBodySchema", () => {
  it("takes a list of ids", () => {
    expect(slideOrderBodySchema.safeParse({ slideIds: [id] }).success).toBe(true);
    expect(slideOrderBodySchema.safeParse({ slideIds: ["x"] }).success).toBe(false);
    expect(
      slideOrderBodySchema.safeParse({ slideIds: Array(DECK_SLIDES_MAX + 1).fill(id) }).success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("knows activity kinds and code languages", () => {
    expect(isActivityKind("poll")).toBe(true);
    expect(isActivityKind("word_cloud")).toBe(true);
    expect(isActivityKind("content")).toBe(false);
    expect(CODE_LANGUAGES.every(isCodeLanguage)).toBe(true);
    expect(isCodeLanguage("cobol")).toBe(false);
  });
});
