// Typed fetch wrapper for the REST API (tech design §2.5, §3.1, §3.5).
// Every error, including network failures, comes out as an ApiError with a stable `code`
// that screens map to Thai / English text.

export const API_BASE_URL = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/v1`;

/** Error body shared by REST and socket errors (tech design §3.5). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** status 0: the request never reached the server. */
export const NETWORK_ERROR = "NETWORK_ERROR";
/** The server answered with an error but not in the §3.5 shape. */
export const UNKNOWN_ERROR = "UNKNOWN_ERROR";

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** Sent as JSON. FormData (PDF upload) is sent as is. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Defaults to API_BASE_URL. */
  baseUrl?: string;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  const error = (value as ApiErrorBody | null)?.error;
  return typeof error?.code === "string" && typeof error.message === "string";
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const qs = search.toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * `const decks = await apiFetch<Deck[]>("/decks")`
 * Sends cookies (host session, participant token). Returns undefined for 204.
 */
export async function apiFetch<T>(
  path: string,
  { body, query, baseUrl = API_BASE_URL, headers, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  if (body !== undefined && !isForm) requestHeaders.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(buildUrl(baseUrl, path, query), {
      credentials: "include",
      ...init,
      headers: requestHeaders,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, NETWORK_ERROR, "Network request failed");
  }

  const data = await readJson(response);

  if (!response.ok) {
    if (isErrorBody(data)) {
      const { code, message, details, requestId } = data.error;
      throw new ApiError(response.status, code, message, details, requestId);
    }
    throw new ApiError(response.status, UNKNOWN_ERROR, `HTTP ${response.status}`);
  }

  return data as T;
}
