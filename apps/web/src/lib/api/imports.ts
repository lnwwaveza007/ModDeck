// PDF import REST calls (technical design §3.3). Errors come out as ApiError.

import type { ImportDetail, ImportDto } from "@moddeck/shared";
import { ApiError, HOST_API_BASE_URL, NETWORK_ERROR, apiFetch, errorFromReply } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

/**
 * Answers once the PDF is read and the slides exist. The pages fill in while the job runs.
 * `onProgress` gets the bytes sent so far: fetch cannot report upload progress, so this uses
 * XMLHttpRequest.
 */
export function uploadPdf(
  deckId: string,
  file: File,
  onProgress?: (sent: number, total: number) => void,
): Promise<ImportDto> {
  const body = new FormData();
  body.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${HOST_API_BASE_URL}/decks/${deckId}/imports`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as ImportDto);
      else reject(errorFromReply(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, NETWORK_ERROR, "Network request failed"));
    xhr.send(body);
  });
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
