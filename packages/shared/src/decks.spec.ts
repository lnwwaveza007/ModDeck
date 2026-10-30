import { DECK_TITLE_MAX, deckCopyBodySchema, deckTitleBodySchema } from "./decks";

describe("deckTitleBodySchema", () => {
  it("trims the title", () => {
    expect(deckTitleBodySchema.parse({ title: "  INT365 W05  " })).toEqual({ title: "INT365 W05" });
  });

  it("rejects a blank, missing or too long title", () => {
    expect(deckTitleBodySchema.safeParse({ title: "   " }).success).toBe(false);
    expect(deckTitleBodySchema.safeParse({}).success).toBe(false);
    expect(deckTitleBodySchema.safeParse({ title: "x".repeat(DECK_TITLE_MAX + 1) }).success).toBe(
      false,
    );
  });
});

describe("deckCopyBodySchema", () => {
  it("allows no body, an empty body or a title", () => {
    expect(deckCopyBodySchema.safeParse(undefined).success).toBe(true);
    expect(deckCopyBodySchema.safeParse({}).success).toBe(true);
    expect(deckCopyBodySchema.parse({ title: "Copy of W05" })).toEqual({ title: "Copy of W05" });
  });

  it("rejects a blank title", () => {
    expect(deckCopyBodySchema.safeParse({ title: "" }).success).toBe(false);
  });
});
