// UI language (F14, MD-5 §2.7). No locale in the URL: the choice lives in a cookie so QR
// links like /j/482914 stay short. First visit follows the phone language.

export const locales = ["th", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "th";

export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Cookie wins, then the first supported language in Accept-Language, then Thai. */
export function resolveLocale(cookieValue?: string | null, acceptLanguage?: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;

  const preferred = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { lang: tag.toLowerCase().split("-")[0], q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter(({ lang, q }) => lang && q > 0)
    .sort((a, b) => b.q - a.q);

  return preferred.map(({ lang }) => lang).find(isLocale) ?? defaultLocale;
}
