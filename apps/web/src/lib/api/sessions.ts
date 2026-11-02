import { apiFetch, HOST_API_BASE_URL } from "./client";

export interface SessionInfo {
  id: string;
  pin: string;
  status: "live" | "host_away" | "ended";
  participantCount: number;
  deck: { title: string };
  joinUrl: string;
  endingAt?: number | null;
  /** Server clock in ms when the response was built. */
  serverNow?: number;
}

export const startSession = (deckId: string) =>
  apiFetch<SessionInfo>(`/decks/${deckId}/sessions`, {
    baseUrl: HOST_API_BASE_URL,
    method: "POST",
  });
export const getSession = (id: string) =>
  apiFetch<SessionInfo>(`/sessions/${id}`, { baseUrl: HOST_API_BASE_URL });
export const requestSessionEnd = (id: string) =>
  apiFetch<{ status: "ended"; endingAt: number | null }>(`/sessions/${id}`, {
    baseUrl: HOST_API_BASE_URL,
    method: "PATCH",
    body: { status: "ended" },
  });
export const undoSessionEnd = (id: string) =>
  apiFetch<{ status: "live" }>(`/sessions/${id}`, {
    baseUrl: HOST_API_BASE_URL,
    method: "PATCH",
    body: { status: "live" },
  });
export const finishSessionEnd = (id: string) =>
  apiFetch<{ status: "ended" }>(`/sessions/${id}`, {
    baseUrl: HOST_API_BASE_URL,
    method: "PATCH",
    body: { status: "ended" },
  });
