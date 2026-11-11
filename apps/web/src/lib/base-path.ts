// URL prefix the app is served under, e.g. "/capstone26/cp26ssa2" behind the school proxy.
// Empty at the site root. Inlined at build time, and must match `basePath` in next.config.ts.
// Next's <Link> and router add it themselves; use this for plain <a href> and API paths.
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
