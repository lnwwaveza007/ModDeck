// Shared ESLint rules for every app. Each app imports this from its own
// eslint.config.mjs and layers framework-specific config on top.
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
  },
  {
    rules: {
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
    },
  },
  // Keep last: turns off rules that conflict with Prettier.
  prettier,
];
