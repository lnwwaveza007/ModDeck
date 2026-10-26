import { isLocale, resolveLocale } from "./config";
import en from "./messages/en.json";
import th from "./messages/th.json";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("resolveLocale", () => {
  it("uses the saved choice first", () => {
    expect(resolveLocale("en", "th-TH,th;q=0.9")).toBe("en");
    expect(resolveLocale("th", "en-US")).toBe("th");
  });

  it("follows the phone language when nothing is saved", () => {
    expect(resolveLocale(undefined, "en-US,en;q=0.9")).toBe("en");
    expect(resolveLocale(undefined, "th-TH")).toBe("th");
  });

  it("respects q weights and skips languages we do not have", () => {
    expect(resolveLocale(undefined, "ja;q=1, en;q=0.5, th;q=0.8")).toBe("th");
    expect(resolveLocale(undefined, "fr-FR, en;q=0.3")).toBe("en");
  });

  it("falls back to Thai", () => {
    expect(resolveLocale("de", "ja,fr")).toBe("th");
    expect(resolveLocale(null, null)).toBe("th");
  });

  it("only accepts supported locales", () => {
    expect(isLocale("th")).toBe(true);
    expect(isLocale("EN")).toBe(false);
  });
});

describe("message files", () => {
  it("have the same keys in Thai and English", () => {
    expect(keys(en).sort()).toEqual(keys(th).sort());
  });

  it("have no empty strings", () => {
    for (const messages of [th, en]) {
      for (const key of keys(messages)) {
        const value = key
          .split(".")
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages);
        expect(value).not.toBe("");
      }
    }
  });
});
