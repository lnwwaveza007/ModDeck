// Co-host (F12, MD-5 §2.5, role review Q17): the owner invites one TA per session. The co-host
// moderates Q&A and sees the participant list on their own device, never edits slides, and can
// take over presenter control when the owner's laptop fails. The owner can take it back.

import { z } from "zod";

/** KMUTT accounts: staff on kmutt.ac.th, students on mail.kmutt.ac.th. */
export const KMUTT_EMAIL = /^[^\s@]+@(mail\.)?kmutt\.ac\.th$/i;

/** POST /sessions/{id}/cohost-invites. With an email only that KMUTT account may accept. */
export const cohostInviteBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).regex(KMUTT_EMAIL).optional(),
  })
  .strict();
export type CohostInviteBody = z.infer<typeof cohostInviteBodySchema>;

/** POST /cohost-invites/accept: the token of an invite link, or the id of an invite by email. */
export const cohostAcceptBodySchema = z.union([
  z.object({ token: z.string().min(16).max(128) }).strict(),
  z.object({ inviteId: z.uuid() }).strict(),
]);
export type CohostAcceptBody = z.infer<typeof cohostAcceptBodySchema>;

export type SessionRole = "owner" | "cohost";

export interface SessionPerson {
  userId: string;
  displayName: string;
}

/**
 * Who runs the session now. Sent to the host room (owner and co-host screens) as
 * `control_update`, and by GET /sessions/{id}/control.
 */
export interface SessionControlState {
  owner: SessionPerson;
  cohost: (SessionPerson & { email: string }) | null;
  /** The invite that waits to be accepted. `email: null`: a link anyone with KMUTT SSO may use. */
  invite: { id: string; email: string | null; expiresAt: string } | null;
  /** The user whose presenter control moves slides and runs activities. */
  controllerId: string;
}

/** What changed, so a screen can tell its user (a take-over notice, for example). */
export type ControlChange =
  "invited" | "invite_cancelled" | "accepted" | "removed" | "takeover" | "takeback";

export type ControlUpdate = SessionControlState & { change: ControlChange };

/** GET /sessions/{id}/control: the state, plus who is asking. */
export interface SessionControlView extends SessionControlState {
  viewerId: string;
  role: SessionRole;
}

/** POST /sessions/{id}/cohost-invites. The link holds a token that is shown only this once. */
export interface CohostInviteCreated {
  invite: NonNullable<SessionControlState["invite"]>;
  url: string;
}

/** GET /cohost-invites: invites by email to the logged-in user, for sessions still open. */
export interface PendingCohostInvite {
  id: string;
  sessionId: string;
  deckTitle: string;
  ownerName: string;
  expiresAt: string;
}

/** POST /cohost-invites/accept. */
export interface CohostAccepted {
  sessionId: string;
}
