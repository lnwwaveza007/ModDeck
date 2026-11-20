import { apiFetch } from "./client";

export interface LiveQuestion {
  id: string;
  text: string;
  anonymous: boolean;
  status: string;
  createdAt: string;
  votes: number;
  author: string | null;
  voted?: boolean;
}
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
