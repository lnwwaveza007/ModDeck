import {
  CODE_LANGUAGES,
  DECK_SLIDES_MAX,
  SLIDE_CONTENT_MAX,
  isActivityKind,
  isCodeLanguage,
  slideContentError,
  slideCreateBodySchema,
  slideOrderBodySchema,
  slidePatchBodySchema,
} from "./slides";

const id = "0192f3a4-0000-7000-8000-000000000001";

describe("slideCreateBodySchema", () => {
  it("accepts a kind with optional position, content and language", () => {
    expect(slideCreateBodySchema.parse({ kind: "code", position: 2, language: "sql" })).toEqual({
      kind: "code",
      position: 2,
      language: "sql",
    });
    expect(slideCreateBodySchema.safeParse({ kind: "poll" }).success).toBe(true);
  });

  it("rejects an unknown kind, language or negative position", () => {
    expect(slideCreateBodySchema.safeParse({ kind: "video" }).success).toBe(false);
    expect(slideCreateBodySchema.safeParse({ kind: "code", language: "cobol" }).success).toBe(
      false,
    );
    expect(slideCreateBodySchema.safeParse({ kind: "text", position: -1 }).success).toBe(false);
  });
});

describe("slidePatchBodySchema", () => {
  it("needs content or language", () => {
    expect(slidePatchBodySchema.safeParse({}).success).toBe(false);
    expect(slidePatchBodySchema.safeParse({ content: "" }).success).toBe(true);
    expect(slidePatchBodySchema.safeParse({ language: "java" }).success).toBe(true);
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

describe("slideContentError", () => {
  it("limits text, code and math by length", () => {
    expect(slideContentError("code", "x".repeat(SLIDE_CONTENT_MAX.code))).toBeNull();
    expect(slideContentError("code", "x".repeat(SLIDE_CONTENT_MAX.code + 1))).toBe("too_long");
    expect(slideContentError("math", "x".repeat(SLIDE_CONTENT_MAX.math + 1))).toBe("too_long");
  });

  it("does not check LaTeX syntax", () => {
    expect(slideContentError("math", "\frac{1")).toBeNull();
  });

  it("allows no content on image and activity slides", () => {
    expect(slideContentError("image", "")).toBeNull();
    expect(slideContentError("poll", "hello")).toBe("not_allowed");
  });
});

describe("helpers", () => {
  it("knows activity kinds and code languages", () => {
    expect(isActivityKind("poll")).toBe(true);
    expect(isActivityKind("word_cloud")).toBe(true);
    expect(isActivityKind("text")).toBe(false);
    expect(CODE_LANGUAGES.every(isCodeLanguage)).toBe(true);
    expect(isCodeLanguage("cobol")).toBe(false);
  });
});
