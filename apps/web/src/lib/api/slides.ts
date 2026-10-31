// Deck editor REST calls (technical design §3.3). Errors come out as ApiError from apiFetch.

import type {
  DeckDetail,
  SlideCreateBody,
  SlideDto,
  SlideElement,
  SlideImageDto,
} from "@moddeck/shared";
import { HOST_API_BASE_URL, apiFetch } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

export function getDeck(deckId: string): Promise<DeckDetail> {
  return apiFetch(`/decks/${deckId}`, host);
}

export function createSlide(deckId: string, body: SlideCreateBody): Promise<SlideDto> {
  return apiFetch(`/decks/${deckId}/slides`, { ...host, method: "POST", body });
}

/** Saves the whole canvas. `keepalive` lets an autosave still go out while the tab is closing. */
export function saveElements(
  deckId: string,
  slideId: string,
  elements: SlideElement[],
): Promise<SlideDto> {
  return apiFetch(`/decks/${deckId}/slides/${slideId}`, {
    ...host,
    method: "PATCH",
    body: { elements },
    keepalive: true,
  });
}

export function deleteSlide(deckId: string, slideId: string): Promise<void> {
  return apiFetch(`/decks/${deckId}/slides/${slideId}`, { ...host, method: "DELETE" });
}

export function duplicateSlide(deckId: string, slideId: string): Promise<SlideDto> {
  return apiFetch(`/decks/${deckId}/slides/${slideId}/copies`, { ...host, method: "POST" });
}

export function reorderSlides(deckId: string, slideIds: string[]): Promise<SlideDto[]> {
  return apiFetch(`/decks/${deckId}/slide-order`, { ...host, method: "PUT", body: { slideIds } });
}

/** Stores the file. An image element then points at the returned name. */
export function uploadSlideImage(deckId: string, file: File): Promise<SlideImageDto> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(`/decks/${deckId}/slide-images`, { ...host, method: "POST", body });
}

/**
 * Where a slide image is served. Same origin as the page on every screen (the host editor, the
 * projector and the student phone), so it needs no login and no CORS.
 */
export function slideImageUrl(imageRef: string): string {
  return `${HOST_API_BASE_URL}/slide-images/${imageRef}`;
}
