import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

// next-intl and its helpers ship ESM only, so Jest has to compile them like our own code.
// Written for pnpm paths too: node_modules/.pnpm/next-intl@x/node_modules/next-intl/...
const esmPackages = [
  "next-intl",
  "use-intl",
  "@formatjs",
  "intl-messageformat",
  "icu-minify",
  // Shiki and the hast / regex helpers it pulls in.
  "shiki",
  "@shikijs",
  "hast-util-to-html",
  "hast-util-whitespace",
  "html-void-elements",
  "property-information",
  "space-separated-tokens",
  "comma-separated-tokens",
  "stringify-entities",
  "character-entities-legacy",
  "character-entities-html4",
  "ccount",
  "zwitch",
  "oniguruma-to-es",
  "regex",
  "regex-recursion",
  "regex-utilities",
];

const jestConfig = createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
});

export default async function config() {
  const base = await jestConfig();
  return {
    ...base,
    transformIgnorePatterns: [
      `/node_modules/(?!(\\.pnpm|${esmPackages.join("|")})[/@])`,
      "^.+\\.module\\.(css|sass|scss)$",
    ],
  };
}
