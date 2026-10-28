import type { CookieOptions } from "express";
import { API_PREFIX, type AuthConfig } from "./auth.config";

export const SESSION_COOKIE = "host_session";
export const TX_COOKIE = "host_oidc_tx";
export const TX_MAX_AGE_MS = 10 * 60 * 1000;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    let value = part.slice(i + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** HttpOnly + Secure + SameSite=Lax. Pass expiresAt when setting, omit when clearing. */
export function sessionCookieOptions(
  cfg: Pick<AuthConfig, "cookieSecure">,
  expiresAt?: Date,
): CookieOptions {
  return {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: "lax",
    path: "/",
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

/** Short-lived cookie that carries state, nonce and PKCE verifier across the redirect. */
export function txCookieOptions(
  cfg: Pick<AuthConfig, "cookieSecure">,
  withMaxAge = true,
): CookieOptions {
  return {
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: "lax", // must be Lax so it returns on the top-level redirect from Microsoft
    path: `/${API_PREFIX}/auth`,
    ...(withMaxAge ? { maxAge: TX_MAX_AGE_MS } : {}),
  };
}
