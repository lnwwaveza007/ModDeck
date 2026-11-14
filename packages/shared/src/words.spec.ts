import { wordPayloadSchema } from "./events";
import {
  WORD_MAX_LENGTH,
  normalizeWordText,
  sortWords,
  wordKey,
  wordLength,
  wordProblem,
  wordVisibilityBodySchema,
} from "./words";

describe("normalizeWordText", () => {
  it("trims and collapses spaces and line breaks", () => {
    expect(normalizeWordText("  hello \n  world\t")).toBe("hello world");
  });

  it("keeps Thai vowels and tone marks whole", () => {
    // Sara am must stay one character: NFKC would turn it into nikhahit + sara aa.
    expect(normalizeWordText("น้ำ")).toBe("น้ำ");
    expect(normalizeWordText("  ที่นี่ ")).toBe("ที่นี่");
    expect(normalizeWordText("ก็")).toBe("ก็");
  });

  it("puts marks typed in another order into one order", () => {
    // Tone mark then lower vowel vs lower vowel then tone mark: same word on screen.
    expect(normalizeWordText("ผู้")).toBe(normalizeWordText("ผู้"));
  });

  it("removes zero width spaces, which Thai typists use as a word break", () => {
    expect(normalizeWordText("สวัสดี​ครับ")).toBe("สวัสดีครับ");
  });
});

describe("wordKey", () => {
  it("ignores case and spaces", () => {
    expect(wordKey("Cloud")).toBe("cloud");
    expect(wordKey(" CLOUD ")).toBe("cloud");
    expect(wordKey("Machine  Learning")).toBe(wordKey("machinelearning"));
  });

  it("leaves Thai as typed", () => {
    expect(wordKey(" น้ำ ")).toBe("น้ำ");
    expect(wordKey("สวัสดี ครับ")).toBe("สวัสดีครับ");
  });

  it("does not make two different words one", () => {
    expect(wordKey("น้ำ")).not.toBe(wordKey("นำ"));
    expect(wordKey("ปา")).not.toBe(wordKey("ป่า"));
  });
});

describe("wordProblem", () => {
  it("refuses an empty word", () => {
    expect(wordProblem("")).toBe("EMPTY");
    expect(wordProblem(" \n​ ")).toBe("EMPTY");
  });

  it("counts visible characters, so a Thai word with marks is not too long", () => {
    // 25 consonants, each with a tone mark: 50 code points, 25 visible characters.
    const thai = "ก่".repeat(WORD_MAX_LENGTH);
    expect(thai.length).toBe(WORD_MAX_LENGTH * 2);
    expect(wordLength(thai)).toBe(WORD_MAX_LENGTH);
    expect(wordProblem(thai)).toBeNull();
    expect(wordProblem(thai + "ก")).toBe("TOO_LONG");
  });

  it("allows exactly the limit in English", () => {
    expect(wordProblem("a".repeat(WORD_MAX_LENGTH))).toBeNull();
    expect(wordProblem("a".repeat(WORD_MAX_LENGTH + 1))).toBe("TOO_LONG");
  });
});

describe("sortWords", () => {
  it("puts the most sent first and keeps ties in a fixed order", () => {
    const sorted = sortWords([
      { text: "b", count: 1 },
      { text: "c", count: 3 },
      { text: "a", count: 1 },
    ]);
    expect(sorted.map((word) => word.text)).toEqual(["c", "a", "b"]);
  });
});

describe("payload schemas", () => {
  const id = "0199f0c2-7a1b-7c3d-8e4f-123456789abc";

  it("accepts a word payload and caps the raw text", () => {
    expect(
      wordPayloadSchema.safeParse({ activityRunId: id, text: "hi", answerId: id }).success,
    ).toBe(true);
    expect(
      wordPayloadSchema.safeParse({ activityRunId: id, text: "x".repeat(201), answerId: id })
        .success,
    ).toBe(false);
    expect(wordPayloadSchema.safeParse({ activityRunId: id, text: "hi" }).success).toBe(false);
  });

  it("takes only a hidden flag to hide a word", () => {
    expect(wordVisibilityBodySchema.safeParse({ hidden: true }).success).toBe(true);
    expect(wordVisibilityBodySchema.safeParse({ hidden: "yes" }).success).toBe(false);
    expect(wordVisibilityBodySchema.safeParse({ hidden: true, key: "x" }).success).toBe(false);
  });
});
