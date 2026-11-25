// Admin impersonation: an account on the ADMIN_EMAILS list can act as another user to see and
// fix what that user sees. The admin's own login stays underneath and comes back on stop.

import { z } from "zod";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

/** GET /auth/me. `user` is who the app acts as; `impersonator` is the admin behind it, if any. */
export interface MeView extends UserSummary {
  studentId: string | null;
  /** The signed-in account (the impersonator while impersonating) may impersonate. */
  isAdmin: boolean;
  impersonator: UserSummary | null;
}

/** GET /admin/users?q=: email or name contains `q`. */
export const userSearchQuerySchema = z.object({
  q: z.string().trim().max(254).default(""),
});

/** POST /auth/impersonation. */
export const impersonateBodySchema = z.object({ userId: z.uuid() }).strict();
export type ImpersonateBody = z.infer<typeof impersonateBodySchema>;

/** Most rows GET /admin/users returns. */
export const USER_SEARCH_LIMIT = 20;
