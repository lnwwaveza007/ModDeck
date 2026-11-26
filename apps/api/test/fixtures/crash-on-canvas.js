// Preload (NODE_OPTIONS --require) for the PDF import e2e: a process that loads @napi-rs/canvas
// dies at once, as it does with SIGILL on a CPU without AVX. Windows has no SIGILL, so SIGKILL.
/* global require, process */
// Plain CommonJS: node loads it before tsx, so it cannot be TypeScript.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");

const load = Module._load;
Module._load = function (request, ...rest) {
  if (typeof request === "string" && request.includes("@napi-rs/canvas")) {
    process.kill(process.pid, process.platform === "win32" ? "SIGKILL" : "SIGILL");
  }
  return load.call(this, request, ...rest);
};
