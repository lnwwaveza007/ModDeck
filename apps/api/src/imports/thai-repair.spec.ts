import {
  applyFixes,
  checkThai,
  repairThai,
  saraAmFixesFromGlyphRuns,
  tidyText,
} from "./thai-repair";

describe("repairThai", () => {
  it("restores SARA AM that PowerPoint split into a space and SARA AA", () => {
    expect(repairThai("น ้ามัน")).toBe("น้ำมัน");
    expect(repairThai("น าเสนอ")).toBe("นำเสนอ");
  });

  it("joins a decomposed SARA AM (NIKHAHIT + SARA AA)", () => {
    expect(repairThai("ทํา")).toBe("ทำ");
  });

  it("maps legacy private-use tone marks back to real code points", () => {
    expect(repairThai("ไดรับ")).toBe("ได้รับ");
  });

  it("leaves correct Thai, English and numbers alone", () => {
    const text = "ตัวอย่างที่นำเสนอ 2026 Hello, world";
    expect(repairThai(text)).toBe(text);
  });
});

describe("saraAmFixesFromGlyphRuns", () => {
  it("finds the broken spot in a glyph run and fixes it in the text content", () => {
    const fixes = saraAmFixesFromGlyphRuns(["น าเสนอ"]);
    expect(applyFixes("ขอนาเสนอผลงาน", fixes)).toBe("ขอนำเสนอผลงาน");
  });

  it("skips a spot with too little context", () => {
    expect(saraAmFixesFromGlyphRuns(["น า"])).toEqual([]);
  });
});

describe("checkThai", () => {
  it("counts the problems that repairThai removes", () => {
    const broken = checkThai("น ้ามัน ไดรับ");
    expect(broken.spaceBeforeSaraAa).toBe(1);
    expect(broken.puaChars).toBe(1);
    const fixed = checkThai(repairThai("น ้ามัน ไดรับ"));
    expect(fixed.spaceBeforeSaraAa).toBe(0);
    expect(fixed.puaChars).toBe(0);
    expect(fixed.saraAm).toBe(1);
  });
});

describe("tidyText", () => {
  it("collapses spaces and drops empty lines", () => {
    expect(tidyText("  a   b \n\n c ")).toBe("a b\nc");
  });
});
