import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Every screen route in the MD-5 sitemap (§3), with the folder that serves it.
const sitemap: Record<string, string> = {
  "/": "(student)",
  "/j/:pin": "(student)/j/[pin]",
  "/s/:sessionId": "(student)/s/[sessionId]",
  "/login": "(host)/login",
  "/decks": "(host)/(nav)/decks",
  "/decks/:deckId": "(host)/decks/[deckId]",
  "/sessions": "(host)/(nav)/sessions",
  "/sessions/:sessionId": "(host)/(nav)/sessions/[sessionId]",
  "/host/:sessionId": "(host)/host/[sessionId]",
  "/host/:sessionId/qa": "(host)/host/[sessionId]/qa",
  "/screen/:sessionId": "(audience)/screen/[sessionId]",
};

const appDir = __dirname;

/** "(host)/decks/[deckId]" → "/decks/:deckId" */
function toRoute(dir: string) {
  const segments = dir
    .split(/[\\/]/)
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\[(.+)\]$/, ":$1"));
  return `/${segments.join("/")}`;
}

function pageDirs(dir = appDir, rel = ""): string[] {
  const found = existsSync(path.join(dir, "page.tsx")) ? [rel] : [];
  for (const name of readdirSync(dir)) {
    if (statSync(path.join(dir, name)).isDirectory()) {
      found.push(...pageDirs(path.join(dir, name), rel ? `${rel}/${name}` : name));
    }
  }
  return found;
}

describe("MD-5 sitemap routes", () => {
  it.each(Object.entries(sitemap))("%s has a page in app/%s", (route, dir) => {
    expect(existsSync(path.join(appDir, dir, "page.tsx"))).toBe(true);
    expect(toRoute(dir)).toBe(route);
  });

  it("has no screen routes outside the sitemap", () => {
    const extra = pageDirs()
      .map(toRoute)
      .filter((route) => !(route in sitemap) && route !== "/design-system");
    expect(extra).toEqual([]);
  });

  it("gives every side a loading and an error state", () => {
    for (const group of ["(host)", "(student)", "(audience)"]) {
      expect(existsSync(path.join(appDir, group, "loading.tsx"))).toBe(true);
      expect(existsSync(path.join(appDir, group, "error.tsx"))).toBe(true);
    }
  });
});
