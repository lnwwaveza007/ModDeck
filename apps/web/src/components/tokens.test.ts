import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Acceptance rule: core components use design tokens only. globals.css already removes
// Tailwind's default palette, so a colour can only sneak in as a raw value.
const dirs = ["ui", "states", "shell"].map((d) => path.join(__dirname, d));

const rawColour = [
  { name: "hex colour", pattern: /#[0-9a-f]{3,8}\b/i },
  { name: "rgb()/hsl()/oklch() colour", pattern: /\b(rgba?|hsla?|oklch|oklab)\(/i },
  { name: "arbitrary Tailwind colour", pattern: /\b[a-z-]+-\[(#|rgb|hsl|oklch|color:|var\()/i },
  { name: "inline style colour", pattern: /style=\{\{[^}]*(color|background)/i },
];

const files = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => path.join(dir, f)),
);

describe("core components use design tokens only", () => {
  it("finds the component files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => [path.relative(__dirname, f), f]))("%s", (_, file) => {
    const source = readFileSync(file, "utf8");
    for (const { name, pattern } of rawColour) {
      expect({ file: path.basename(file), name, match: source.match(pattern)?.[0] }).toEqual({
        file: path.basename(file),
        name,
        match: undefined,
      });
    }
  });
});
