import type { JoinResult, ParticipantMe, ParticipantRow, PinInfo } from "@moddeck/shared";
import { apiFetch, HOST_API_BASE_URL } from "./client";

// Student join (technical design §3.3). Like host calls, these go through the
// same-origin /api path: the participant cookie must sit on the web origin,
// next to the KMUTT login a student gets from SSO.

export const getPinInfo = (pin: string) =>
  apiFetch<PinInfo>(`/pins/${pin}`, { baseUrl: HOST_API_BASE_URL });

/** With a nickname: guest. Without: the KMUTT login (401 when there is none). */
export const joinSession = (pin: string, nickname?: string) =>
  apiFetch<JoinResult>(`/pins/${pin}/participants`, {
    baseUrl: HOST_API_BASE_URL,
    method: "POST",
    body: nickname === undefined ? {} : { nickname },
  });

export const getParticipantMe = () =>
  apiFetch<ParticipantMe>("/participants/me", { baseUrl: HOST_API_BASE_URL });

/** Starts KMUTT SSO; it comes back to /j/:pin and joins from there. */
export const kmuttLoginUrl = (pin: string) =>
  `${HOST_API_BASE_URL}/auth/login?returnTo=${encodeURIComponent(`/j/${pin}?sso=1`)}`;

// ---- Host: the participant list in presenter control (F13) ------------------

const host = { baseUrl: HOST_API_BASE_URL };

export const listParticipants = (sessionId: string) =>
  apiFetch<ParticipantRow[]>(`/sessions/${sessionId}/participants`, host);

/** Guests only. The api checks the same nickname rules as the join. */
export const renameParticipant = (sessionId: string, participantId: string, nickname: string) =>
  apiFetch<ParticipantRow>(`/sessions/${sessionId}/participants/${participantId}`, {
    ...host,
    method: "PATCH",
    body: { nickname },
  });

/** Disconnects them and keeps their token out of this session. Their answers leave the results. */
export const removeParticipant = (sessionId: string, participantId: string) =>
  apiFetch<void>(`/sessions/${sessionId}/participants/${participantId}`, {
    ...host,
    method: "DELETE",
  });
