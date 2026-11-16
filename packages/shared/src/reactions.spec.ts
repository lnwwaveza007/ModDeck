import { REACTION_EMOJIS, reactionPayloadSchema, reactionsToggleBodySchema } from "./reactions";

describe("reactionPayloadSchema", () => {
  it("accepts each of the five emojis", () => {
    expect(REACTION_EMOJIS).toHaveLength(5);
    for (const emoji of REACTION_EMOJIS) {
      expect(reactionPayloadSchema.safeParse({ emoji }).success).toBe(true);
    }
  });

  it("rejects any other emoji or text", () => {
    for (const emoji of ["👍", "❤", "hello", "", "👏👏"]) {
      expect(reactionPayloadSchema.safeParse({ emoji }).success).toBe(false);
    }
    expect(reactionPayloadSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("reactionsToggleBodySchema", () => {
  it("takes a boolean only", () => {
    expect(reactionsToggleBodySchema.safeParse({ reactionsEnabled: false }).success).toBe(true);
    expect(reactionsToggleBodySchema.safeParse({ reactionsEnabled: "off" }).success).toBe(false);
  });
});
