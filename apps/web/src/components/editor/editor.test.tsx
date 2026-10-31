import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DeckDetail, SlideDto } from "@moddeck/shared";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import {
  createSlide,
  deleteSlide,
  duplicateSlide,
  getDeck,
  patchSlide,
  reorderSlides,
  uploadSlideImage,
} from "@/lib/api/slides";
import { renderWithIntl } from "@/test/render";
import { DeckEditor } from "./DeckEditor";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api/slides", () => ({
  ...jest.requireActual("@/lib/api/slides"),
  getDeck: jest.fn(),
  createSlide: jest.fn(),
  patchSlide: jest.fn(),
  deleteSlide: jest.fn(),
  duplicateSlide: jest.fn(),
  reorderSlides: jest.fn(),
  uploadSlideImage: jest.fn(),
}));

const api = {
  get: jest.mocked(getDeck),
  create: jest.mocked(createSlide),
  patch: jest.mocked(patchSlide),
  remove: jest.mocked(deleteSlide),
  duplicate: jest.mocked(duplicateSlide),
  reorder: jest.mocked(reorderSlides),
  upload: jest.mocked(uploadSlideImage),
};

function slide(overrides: Partial<SlideDto> & Pick<SlideDto, "id" | "position">): SlideDto {
  return {
    kind: "text",
    content: null,
    language: null,
    imageRef: null,
    activity: null,
    updatedAt: "2026-10-31T03:00:00.000Z",
    ...overrides,
  };
}

const title = slide({ id: "s1", position: 0, content: "# Routing" });
const code = slide({ id: "s2", position: 1, kind: "code", content: "x = 1", language: "python" });
const math = slide({ id: "s3", position: 2, kind: "math", content: "x^2" });
const picture = slide({ id: "s4", position: 3, kind: "image" });

function deck(slides: SlideDto[]): DeckDetail {
  return {
    id: "d1",
    title: "INT365 W05",
    slideCount: slides.length,
    sessionCount: 0,
    liveSessions: [],
    createdAt: "2026-10-01T03:00:00.000Z",
    updatedAt: "2026-10-30T03:00:00.000Z",
    slides,
  };
}

async function renderEditor(slides = [title, code, math, picture]) {
  api.get.mockResolvedValue(deck(slides));
  const view = renderWithIntl(
    <ToastProvider closeLabel="Close">
      <DeckEditor deckId="d1" />
    </ToastProvider>,
    "en",
  );
  await screen.findByRole("heading", { name: "INT365 W05" });
  return view;
}

const slideButton = (n: number) => screen.getByRole("button", { name: new RegExp(`^Slide ${n},`) });

beforeEach(() => {
  jest.resetAllMocks();
  api.patch.mockResolvedValue(title);
});

describe("DeckEditor", () => {
  it("shows the deck title, numbered slides and the first slide on the canvas", async () => {
    await renderEditor();
    expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(4);
    expect(slideButton(1)).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Slide 1 of 4")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Routing" }).length).toBeGreaterThan(0);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows the fields of each slide type", async () => {
    await renderEditor();
    expect(screen.getByLabelText("Text")).toHaveValue("# Routing");

    fireEvent.click(slideButton(2));
    expect(screen.getByLabelText("Language")).toHaveValue("python");
    expect(screen.getByLabelText("Code")).toHaveValue("x = 1");

    fireEvent.click(slideButton(3));
    expect(screen.getByLabelText("LaTeX formula")).toHaveValue("x^2");

    fireEvent.click(slideButton(4));
    expect(screen.getByLabelText("Image")).toBeInTheDocument();
    expect(screen.getByText("Upload image", { selector: "label" })).toBeInTheDocument();
  });

  describe("autosave", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("shows an edit at once, saves after a pause, then says Saved", async () => {
      await renderEditor([title]);
      fireEvent.change(screen.getByLabelText("Text"), { target: { value: "# Routing 2" } });

      expect(screen.getAllByRole("heading", { name: "Routing 2" }).length).toBeGreaterThan(0);
      expect(screen.getByText("Saving…")).toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();

      await act(() => jest.advanceTimersByTimeAsync(800));
      expect(api.patch).toHaveBeenCalledTimes(1);
      expect(api.patch).toHaveBeenCalledWith("d1", "s1", { content: "# Routing 2" });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });

    it("sends one request for a burst of typing", async () => {
      await renderEditor([title]);
      const field = screen.getByLabelText("Text");
      for (const value of ["a", "ab", "abc"]) {
        fireEvent.change(field, { target: { value } });
        await act(() => jest.advanceTimersByTimeAsync(300));
      }
      await act(() => jest.advanceTimersByTimeAsync(800));
      expect(api.patch).toHaveBeenCalledTimes(1);
      expect(api.patch).toHaveBeenCalledWith("d1", "s1", { content: "abc" });
    });

    it("saves the language of a code slide", async () => {
      await renderEditor([title, code]);
      fireEvent.click(slideButton(2));
      fireEvent.change(screen.getByLabelText("Language"), { target: { value: "sql" } });
      await act(() => jest.advanceTimersByTimeAsync(800));
      expect(api.patch).toHaveBeenCalledWith("d1", "s2", { language: "sql" });
    });

    it("offers to try again when saving fails, and keeps the text", async () => {
      await renderEditor([title]);
      api.patch.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
      fireEvent.change(screen.getByLabelText("Text"), { target: { value: "keep me" } });
      await act(() => jest.advanceTimersByTimeAsync(800));

      expect(screen.getByText("Could not save")).toBeInTheDocument();
      expect(screen.getByLabelText("Text")).toHaveValue("keep me");

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await act(() => jest.advanceTimersByTimeAsync(0));
      expect(api.patch).toHaveBeenLastCalledWith("d1", "s1", { content: "keep me" });
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("shows an inline error for invalid LaTeX and keeps the editor working", async () => {
    await renderEditor();
    fireEvent.click(slideButton(3));
    fireEvent.change(screen.getByLabelText("LaTeX formula"), { target: { value: "\\frac{1" } });

    expect(screen.getByText(/^LaTeX error: /)).toBeInTheDocument();
    expect(screen.getByLabelText("LaTeX formula")).toHaveAttribute("aria-invalid", "true");
    // The canvas shows the same error where the formula would be.
    expect(document.querySelector("[data-math-error]")).toBeInTheDocument();
    // The rest of the editor is still there.
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    fireEvent.click(slideButton(1));
    expect(screen.getByLabelText("Text")).toBeInTheDocument();
  });

  it("adds a slide after the selected one and selects it", async () => {
    await renderEditor();
    fireEvent.click(slideButton(2));
    api.create.mockResolvedValue(slide({ id: "n1", position: 2, kind: "math", content: "" }));

    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const dialog = screen.getByRole("dialog", { name: "Add a slide" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Math/ }));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(5),
    );
    expect(api.create).toHaveBeenCalledWith("d1", { kind: "math", position: 2 });
    expect(slideButton(3)).toHaveAttribute("aria-current", "true");
    expect(slideButton(3)).toHaveAccessibleName("Slide 3, Math");
  });

  it("offers Live Poll and Word Cloud as activity slots, and Q&A as coming soon", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^Live Poll/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /^Word Cloud/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /^Q&A/ })).toBeDisabled();

    api.create.mockResolvedValue(
      slide({ id: "p1", position: 1, kind: "poll", activity: { type: "poll", prompt: "" } }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /^Live Poll/ }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith("d1", { kind: "poll", position: 1 }),
    );
    expect(
      await screen.findByText("The question and options editor is coming soon."),
    ).toBeInTheDocument();
  });

  it("duplicates the selected slide right after it", async () => {
    await renderEditor();
    fireEvent.click(slideButton(2));
    api.duplicate.mockResolvedValue({ ...code, id: "c2", position: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(5),
    );
    expect(api.duplicate).toHaveBeenCalledWith("d1", "s2");
    expect(slideButton(3)).toHaveAccessibleName("Slide 3, Code");
    expect(slideButton(3)).toHaveAttribute("aria-current", "true");
  });

  it("deletes a slide after confirming, and selects its neighbour", async () => {
    await renderEditor();
    fireEvent.click(slideButton(2));
    api.remove.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete slide" }),
    );

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(3),
    );
    expect(api.remove).toHaveBeenCalledWith("d1", "s2");
    expect(slideButton(2)).toHaveAccessibleName("Slide 2, Math");
    expect(slideButton(2)).toHaveAttribute("aria-current", "true");
  });

  it("keeps a live activity slide and says why", async () => {
    const poll = slide({
      id: "p1",
      position: 1,
      kind: "poll",
      activity: { type: "poll", prompt: "Q" },
    });
    await renderEditor([title, poll]);
    fireEvent.click(slideButton(2));
    api.remove.mockRejectedValue(new ApiError(409, "ACTIVITY_LOCKED", "live"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete slide" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This activity is live in a session",
    );
    expect(screen.getAllByRole("button", { name: /^Slide \d,/ })).toHaveLength(2);
  });

  it("reorders with Move down and sends the full list of ids", async () => {
    await renderEditor();
    api.reorder.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(api.reorder).toHaveBeenCalledWith("d1", ["s2", "s1", "s3", "s4"]));
    expect(slideButton(1)).toHaveAccessibleName("Slide 1, Code");
    expect(slideButton(2)).toHaveAccessibleName("Slide 2, Text");
    expect(screen.getByRole("button", { name: "Move up" })).toBeEnabled();
  });

  it("disables Move up on the first slide and Move down on the last", async () => {
    await renderEditor();
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    fireEvent.click(slideButton(4));
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("reloads the deck when a reorder is refused", async () => {
    await renderEditor();
    api.reorder.mockRejectedValue(new ApiError(422, "INVALID_PAYLOAD", "mismatch"));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Could not complete that/)).toBeInTheDocument();
    expect(slideButton(1)).toHaveAccessibleName("Slide 1, Text");
  });

  it("uploads an image and shows it on the canvas", async () => {
    await renderEditor();
    fireEvent.click(slideButton(4));
    api.upload.mockResolvedValue({ ...picture, imageRef: "abc.png" });

    const file = new File([new Uint8Array(10)], "diagram.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Image", { selector: "input" }), {
      target: { files: [file] },
    });

    await waitFor(() => expect(api.upload).toHaveBeenCalledWith("d1", "s4", file));
    await waitFor(() =>
      expect(screen.getAllByRole("img", { name: "Slide image" })[0]).toHaveAttribute(
        "src",
        "/api/slide-images/abc.png",
      ),
    );
    expect(screen.getByText("Replace image", { selector: "label" })).toBeInTheDocument();
  });

  it("refuses a file that is not an image, or too large, before sending it", async () => {
    await renderEditor();
    fireEvent.click(slideButton(4));
    const input = screen.getByLabelText("Image", { selector: "input" });

    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.svg", { type: "image/svg+xml" })] },
    });
    expect(await screen.findByText("Choose a PNG, JPEG, WebP or GIF file.")).toBeInTheDocument();

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText("This image is larger than 5 MB.")).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("shows an empty deck with a way to add the first slide", async () => {
    await renderEditor([]);
    expect(screen.getByText("This deck has no slides")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add slide" }).length).toBeGreaterThan(0);
  });

  it("answers a missing deck with the not-found state, and sends a logged-out host to login", async () => {
    api.get.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Deck not found"));
    const { unmount } = renderWithIntl(
      <ToastProvider closeLabel="Close">
        <DeckEditor deckId="gone" />
      </ToastProvider>,
      "en",
    );
    expect(await screen.findByText("This deck no longer exists.")).toBeInTheDocument();
    unmount();

    api.get.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "login"));
    renderWithIntl(
      <ToastProvider closeLabel="Close">
        <DeckEditor deckId="d1" />
      </ToastProvider>,
      "en",
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/login"));
  });

  it("works in Thai", async () => {
    api.get.mockResolvedValue(deck([title]));
    renderWithIntl(
      <ToastProvider closeLabel="ปิด">
        <DeckEditor deckId="d1" />
      </ToastProvider>,
      "th",
    );
    expect(await screen.findByRole("heading", { name: "INT365 W05" })).toBeInTheDocument();
    expect(screen.getByText("บันทึกแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มสไลด์" })).toBeInTheDocument();
  });
});
