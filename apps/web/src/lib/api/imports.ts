// PDF import REST calls (technical design §3.3). Errors come out as ApiError from apiFetch.

import type { ImportDetail, ImportDto } from "@moddeck/shared";
import { HOST_API_BASE_URL, apiFetch } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

/** Answers once the PDF is read and the slides exist. The pages fill in while the job runs. */
export function uploadPdf(deckId: string, file: File): Promise<ImportDto> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch(`/decks/${deckId}/imports`, { ...host, method: "POST", body });
}

/** The newest imports of a deck, newest first. */
export function listImports(deckId: string): Promise<ImportDto[]> {
  return apiFetch(`/decks/${deckId}/imports`, host);
}

export function getImport(importId: string): Promise<ImportDetail> {
  return apiFetch(`/imports/${importId}`, host);
}

/** The pages that failed go through the queue again. */
export function retryImport(importId: string): Promise<ImportDto> {
  return apiFetch(`/imports/${importId}/retries`, { ...host, method: "POST" });
}
