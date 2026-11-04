import {
  graphemeLength,
  joinBodySchema,
  nicknameKey,
  nicknameProblem,
  normalizeNickname,
} from "./participants";

describe("nickname rules", () => {
  it("counts a Thai consonant with its vowel and tone mark as one character", () => {
    expect(graphemeLength("ที่")).toBe(1);
    expect("ที่".length).toBe(3);
    expect(graphemeLength("พลอย")).toBe(4);
    expect(graphemeLength("Ploy")).toBe(4);
  });

  it("trims and collapses spaces", () => {
    expect(normalizeNickname("  Ploy   P ")).toBe("Ploy P");
    expect(nicknameKey("PLOY  p")).toBe("ploy p");
  });

  it("allows Thai, English, digits and spaces of 2 to 20 characters", () => {
    for (const name of ["ปลา", "Ploy", "Ploy 64", "พลอย P", "ab", "a".repeat(20)]) {
      expect(nicknameProblem(name)).toBeNull();
    }
  });

  it("explains a refused nickname", () => {
    expect(nicknameProblem("a")).toBe("TOO_SHORT");
    expect(nicknameProblem("a".repeat(21))).toBe("TOO_LONG");
    expect(nicknameProblem("Ploy!")).toBe("INVALID_CHARS");
    expect(nicknameProblem("😀😀")).toBe("INVALID_CHARS");
    expect(nicknameProblem("Teacher")).toBe("RESERVED");
    expect(nicknameProblem("อาจารย์")).toBe("RESERVED");
    expect(nicknameProblem("somchai j", ["Somchai J"])).toBe("RESERVED");
  });
});

describe("joinBodySchema", () => {
  it("allows no body, an empty body or a nickname", () => {
    expect(joinBodySchema.safeParse(undefined).success).toBe(true);
    expect(joinBodySchema.safeParse({}).success).toBe(true);
    expect(joinBodySchema.parse({ nickname: "Ploy" })).toEqual({ nickname: "Ploy" });
  });

  it("rejects a nickname that is not text", () => {
    expect(joinBodySchema.safeParse({ nickname: 42 }).success).toBe(false);
  });
});
