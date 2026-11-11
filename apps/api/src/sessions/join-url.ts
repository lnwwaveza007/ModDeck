/**
 * Where students open a session: `<web base>/j/<pin>`.
 *
 * The web base is APP_BASE_URL when set, because it carries the URL prefix the app is
 * mounted under (https://bscit.sit.kmutt.ac.th/capstone26/cp26ssa2). WEB_ORIGIN is an
 * origin only (CORS needs that), so it cannot hold the prefix.
 */
export function joinUrl(pin: string): string {
  const base = process.env.APP_BASE_URL?.trim() || process.env.WEB_ORIGIN || "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/j/${pin}`;
}
