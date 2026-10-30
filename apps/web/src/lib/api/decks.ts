// My decks REST calls (technical design §3.3). Errors come out as ApiError from apiFetch.

import type { DeckSummary } from "@moddeck/shared";
import { HOST_API_BASE_URL, apiFetch } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

export function listDecks(): Promise<DeckSummary[]> {
  return apiFetch("/decks", host);
}

export function createDeck(title: string): Promise<DeckSummary> {
  return apiFetch("/decks", { ...host, method: "POST", body: { title } });
}

export function renameDeck(deckId: string, title: string): Promise<DeckSummary> {
  return apiFetch(`/decks/${deckId}`, { ...host, method: "PATCH", body: { title } });
}

export function duplicateDeck(deckId: string, title: string): Promise<DeckSummary> {
  return apiFetch(`/decks/${deckId}/copies`, { ...host, method: "POST", body: { title } });
}

export function deleteDeck(deckId: string): Promise<void> {
  return apiFetch(`/decks/${deckId}`, { ...host, method: "DELETE" });
}
