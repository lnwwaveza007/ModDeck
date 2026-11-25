import type { NextFunction, Request, Response } from "express";

/**
 * Every api reply depends on the cookies (who is asking, which session they joined), but the
 * URL does not: GET /participants/me is the same address for every session. Without this
 * header a browser may keep a reply and show it again later, e.g. a 410 SESSION_ENDED from a
 * past session after the student has joined a new one. Routes that are safe to cache (slide
 * images) set their own Cache-Control in the handler, which runs after this and replaces it.
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}
