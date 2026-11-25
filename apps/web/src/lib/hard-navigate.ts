import { BASE_PATH } from "./base-path";

/**
 * Full page load at `path` (base path added). Use when the signed-in identity changes: a
 * client-side push would keep the router cache of the other account's pages.
 */
export function hardNavigate(path: string) {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`${BASE_PATH}${path}`);
}
