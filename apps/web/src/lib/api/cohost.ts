// Co-host and presenter control (F12). Host routes: they need the KMUTT login cookie.

import type {
  CohostAccepted,
  CohostAcceptBody,
  CohostInviteCreated,
  PendingCohostInvite,
  SessionControlView,
} from "@moddeck/shared";
import { HOST_API_BASE_URL, apiFetch } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

export const getSessionControl = (sessionId: string) =>
  apiFetch<SessionControlView>(`/sessions/${sessionId}/control`, host);

/** Owner. With an email only that KMUTT account can accept; without one, the link is enough. */
export const inviteCohost = (sessionId: string, email?: string) =>
  apiFetch<CohostInviteCreated>(`/sessions/${sessionId}/cohost-invites`, {
    ...host,
    method: "POST",
    body: email ? { email } : {},
  });

export const cancelCohostInvite = (sessionId: string) =>
  apiFetch<void>(`/sessions/${sessionId}/cohost-invites`, { ...host, method: "DELETE" });

export const removeCohost = (sessionId: string) =>
  apiFetch<void>(`/sessions/${sessionId}/cohost`, { ...host, method: "DELETE" });

/** The caller takes presenter control: the co-host takes over, the owner takes back. */
export const takeSessionControl = (sessionId: string) =>
  apiFetch<SessionControlView>(`/sessions/${sessionId}/takeovers`, { ...host, method: "POST" });

export const getPendingCohostInvites = () =>
  apiFetch<PendingCohostInvite[]>("/cohost-invites", host);

export const acceptCohostInvite = (body: CohostAcceptBody) =>
  apiFetch<CohostAccepted>("/cohost-invites/accept", { ...host, method: "POST", body });

/** KMUTT SSO, then back to the invite link. */
export const cohostLoginUrl = (token: string) =>
  `${HOST_API_BASE_URL}/auth/login?returnTo=${encodeURIComponent(`/cohost/${token}`)}`;
