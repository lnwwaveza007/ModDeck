import { COOKIE_NAME, DEFAULT_TOKEN_TTL_MS } from "./store.mjs";

export { COOKIE_NAME };

export function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function readSessionCookie(header) {
  const raw = parseCookieHeader(header)[COOKIE_NAME];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeSessionCookie(
  tokenPayload,
  { maxAge = Math.floor(DEFAULT_TOKEN_TTL_MS / 1000), clear = false } = {},
) {
  if (clear || !tokenPayload) {
    return `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  const value = encodeURIComponent(JSON.stringify(tokenPayload));
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function shouldClearCookie(tokenPayload) {
  return tokenPayload?.loginType === "guest";
}
