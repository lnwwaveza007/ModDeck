import js from "@eslint/js";
import tseslint from "typescript-eslint";
import base from "../../eslint.base.mjs";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, ...base, {
  // Server logs go to stdout.
  rules: {
    "no-console": "off",
  },
});
