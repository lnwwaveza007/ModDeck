import { fireEvent, screen } from "@testing-library/react";
import type { LiveQuestion } from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { askQuestion, getQuestions, toggleQuestionVote } from "@/lib/api/questions";
import { renderWithIntl } from "@/test/render";
import { QuestionsActivity } from "./QuestionsActivity";

jest.mock("@/lib/api/questions");

const question = (id: string, overrides: Partial<LiveQuestion> = {}): LiveQuestion => ({
  id,
  text: `Question ${id}`,
  anonymous: true,
  status: "visible",
  createdAt: "2026-11-21T10:00:00.000Z",
  votes: 2,
  voted: false,
  ...overrides,
});

const renderQa = (open: boolean) =>
  renderWithIntl(<QuestionsActivity sessionId="s1" nickname="Mint" open={open} />, "en");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getQuestions).mockResolvedValue({
    questions: [
      question("a", { status: "highlighted" }),
      question("b", { status: "answered" }),
      question("c"),
    ],
  });
});

describe("QuestionsActivity", () => {
  it("tags the pinned and the answered questions", async () => {
    renderQa(true);
    expect(await screen.findByText("On screen")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
  });

  it("keeps the list readable when the host closes Q&A, but stops asking and voting", async () => {
    renderQa(false);
    await screen.findByText("Question c");
    expect(screen.getByRole("status")).toHaveTextContent("The host has closed Q&A.");
    expect(screen.queryByRole("button", { name: "Post a question" })).not.toBeInTheDocument();
    for (const vote of screen.getAllByRole("button", { name: /Upvote/ }))
      expect(vote).toBeDisabled();
  });

  it("says Q&A is closed when the host closed it while the student was typing", async () => {
    jest
      .mocked(askQuestion)
      .mockRejectedValue(new ApiError(403, "QA_CLOSED", "The host has closed Q&A"));
    renderQa(true);
    fireEvent.click(await screen.findByRole("button", { name: "Post question" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Question" }), {
      target: { value: "Too late?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The host has closed Q&A.");
    expect(toggleQuestionVote).not.toHaveBeenCalled();
  });
});
