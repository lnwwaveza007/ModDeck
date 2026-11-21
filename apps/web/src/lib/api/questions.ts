import type { LiveQuestion } from "@moddeck/shared";
import { apiFetch } from "./client";

export type { LiveQuestion } from "@moddeck/shared";
export const getQuestions = (sessionId: string, sort: "top" | "newest" = "top") =>
  apiFetch<{ questions: LiveQuestion[] }>(`/sessions/${sessionId}/questions?sort=${sort}`);
export const askQuestion = (sessionId: string, text: string, anonymous: boolean) =>
  apiFetch<LiveQuestion>(`/sessions/${sessionId}/questions`, {
    method: "POST",
    body: { text, anonymous },
  });
export const toggleQuestionVote = (sessionId: string, questionId: string) =>
  apiFetch<{ voted: boolean; votes: number }>(
    `/sessions/${sessionId}/questions/${questionId}/vote`,
    { method: "PATCH" },
  );
