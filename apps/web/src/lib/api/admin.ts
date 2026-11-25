// Admin impersonation. Host routes: they need the KMUTT login cookie.

import type { ImpersonateBody, MeView, UserSummary } from "@moddeck/shared";
import { HOST_API_BASE_URL, apiFetch } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

/** Who the app acts as, and the admin behind it while impersonating. 401 when not signed in. */
export const getMe = () => apiFetch<MeView>("/auth/me", host);

/** Admin only: users whose email or name contains `q`. */
export const searchUsers = (q: string, signal?: AbortSignal) =>
  apiFetch<UserSummary[]>("/admin/users", { ...host, query: { q }, signal });

/** Admin only: this login acts as `userId` until stopImpersonating. */
export const startImpersonating = (userId: string) =>
  apiFetch<MeView>("/auth/impersonation", {
    ...host,
    method: "POST",
    body: { userId } satisfies ImpersonateBody,
  });

export const stopImpersonating = () =>
  apiFetch<void>("/auth/impersonation", { ...host, method: "DELETE" });
