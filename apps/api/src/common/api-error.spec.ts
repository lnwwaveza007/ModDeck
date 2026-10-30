import { deckTitleBodySchema } from "@moddeck/shared";
import { ApiException, ZodBody } from "./api-error";

describe("ZodBody", () => {
  const pipe = new ZodBody(deckTitleBodySchema);

  it("returns the parsed body", () => {
    expect(pipe.transform({ title: " W05 " })).toEqual({ title: "W05" });
  });

  it("throws 422 INVALID_PAYLOAD in the §3.5 shape", () => {
    try {
      pipe.transform({ title: "" });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      const ex = err as ApiException;
      expect(ex.getStatus()).toBe(422);
      expect(ex.getResponse()).toEqual({
        error: {
          code: "INVALID_PAYLOAD",
          message: "Invalid request body",
          details: { issues: [{ path: "title", code: "too_small" }] },
        },
      });
    }
  });
});
