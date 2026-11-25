/**
 * Where students open a session: `<web base>/j/<pin>`. An ended session holds no PIN, so it has
 * no join URL either.
 *
 * The web base is APP_BASE_URL when set, because it carries the URL prefix the app is
 * mounted under (https://bscit.sit.kmutt.ac.th/capstone26/cp26ssa2). WEB_ORIGIN is an
 * origin only (CORS needs that), so it cannot hold the prefix.
 */
export function joinUrl(pin: string): string;
export function joinUrl(pin: string | null): string | null;
export function joinUrl(pin: string | null): string | null {
  if (pin === null) return null;
  return appUrl(`/j/${pin}`);
}

/** A page of the web app, under the same base as the join URL. `path` starts with "/". */
export function appUrl(path: string): string {
  const base =
    process.env.APP_BASE_URL?.trim() || process.env.WEB_ORIGIN || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}${path}`;
}
