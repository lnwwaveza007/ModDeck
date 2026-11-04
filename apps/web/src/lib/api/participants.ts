import type { JoinResult, ParticipantMe, PinInfo } from "@moddeck/shared";
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
