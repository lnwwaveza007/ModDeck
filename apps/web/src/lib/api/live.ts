// Presenter control and audience screen REST calls (technical design §3.3, sessions).

import type {
  ActivityActionBody,
  ActivityRunDto,
  ActivityWordingBody,
  LiveActivity,
  LiveSessionView,
} from "@moddeck/shared";
import { HOST_API_BASE_URL, apiFetch } from "./client";

const host = { baseUrl: HOST_API_BASE_URL };

export const getLiveSession = (sessionId: string) =>
  apiFetch<LiveSessionView>(`/sessions/${sessionId}/live`, host);

export const moveToSlide = (sessionId: string, currentSlideId: string) =>
  apiFetch<{ currentSlideId: string; index: number }>(`/sessions/${sessionId}`, {
    ...host,
    method: "PATCH",
    body: { currentSlideId },
  });

export const actOnActivity = (sessionId: string, activityId: string, body: ActivityActionBody) =>
  apiFetch<ActivityRunDto>(`/sessions/${sessionId}/activities/${activityId}`, {
    ...host,
    method: "PATCH",
    body,
  });

export const editActivityWording = (deckId: string, slideId: string, body: ActivityWordingBody) =>
  apiFetch<LiveActivity>(`/decks/${deckId}/slides/${slideId}/activity`, {
    ...host,
    method: "PATCH",
    body,
  });
