import { apiFetch, HOST_API_BASE_URL } from "./client";

export interface SessionInfo {
  id: string;
  /** null once the session has ended: the PIN goes back to the pool. */
  pin: string | null;
  status: "live" | "host_away" | "ended";
  participantCount: number;
  deck: { title: string };
  joinUrl: string | null;
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
/** Ends the session at once. Repeating it is harmless. */
export const endSession = (id: string) =>
  apiFetch<{ status: "ended" }>(`/sessions/${id}`, {
    baseUrl: HOST_API_BASE_URL,
    method: "PATCH",
    body: { status: "ended" },
  });
