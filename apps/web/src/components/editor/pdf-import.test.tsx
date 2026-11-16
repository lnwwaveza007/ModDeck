import { act, fireEvent, screen, within } from "@testing-library/react";
import type { DeckDetail, ImportDetail, ImportDto, SlideDto } from "@moddeck/shared";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";
import { getImport, listImports, retryImport, uploadPdf } from "@/lib/api/imports";
import { getDeck } from "@/lib/api/slides";
import { renderWithIntl } from "@/test/render";
import { DeckEditor } from "./DeckEditor";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api/slides", () => ({
  ...jest.requireActual("@/lib/api/slides"),
  getDeck: jest.fn(),
  saveElements: jest.fn(),
}));
jest.mock("@/lib/api/imports", () => ({
  uploadPdf: jest.fn(),
  listImports: jest.fn(),
  getImport: jest.fn(),
  retryImport: jest.fn(),
}));

const api = {
  deck: jest.mocked(getDeck),
  upload: jest.mocked(uploadPdf),
  list: jest.mocked(listImports),
  get: jest.mocked(getImport),
  retry: jest.mocked(retryImport),
};

const IMAGE = {
  id: "0192f3a4-0000-7000-8000-0000000000e1",
  type: "image" as const,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  imageRef: "0192f3a4-0000-7000-8000-0000000000f1.webp",
};

const slide = (id: string, position: number, extra: Partial<SlideDto> = {}): SlideDto => ({
  id,
  position,
  kind: "content",
  elements: [],
  activity: null,
  importStatus: null,
  updatedAt: "2026-11-16T03:00:00.000Z",
  ...extra,
});

const deck = (slides: SlideDto[]): DeckDetail => ({
  id: "d1",
  title: "INT365 W05",
  slideCount: slides.length,
  sessionCount: 0,
  liveSessions: [],
  createdAt: "2026-10-01T03:00:00.000Z",
  updatedAt: "2026-10-30T03:00:00.000Z",
  slides,
});

const job = (extra: Partial<ImportDto> = {}): ImportDto => ({
  id: "i1",
  deckId: "d1",
  fileName: "lecture.pdf",
  status: "running",
  pageCount: 2,
  donePages: 0,
  failedPages: 0,
  errorCode: null,
  createdAt: "2026-11-16T03:00:00.000Z",
  ...extra,
});

const detail = (extra: Partial<ImportDto> = {}): ImportDetail => ({ ...job(extra), pages: [] });

async function renderEditor() {
  api.deck.mockResolvedValue(deck([slide("s1", 0)]));
  api.list.mockResolvedValue([]);
  const view = renderWithIntl(
    <ToastProvider closeLabel="Close">
      <DeckEditor deckId="d1" />
    </ToastProvider>,
    "en",
  );
  await screen.findByRole("heading", { name: "INT365 W05" });
  return view;
}

const slideButtons = () => screen.getAllByRole("button", { name: /^Slide \d+,/ });

function chooseFile(file: File) {
  fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
  fireEvent.change(screen.getByTestId("pdf-input"), { target: { files: [file] } });
}
const pdfFile = (name = "lecture.pdf", type = "application/pdf") =>
  new File(["%PDF-1.4"], name, { type });

/** Waits for the one-second look at the job. */
const nextLook = () => act(() => jest.advanceTimersByTimeAsync(1100));

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("PDF import in the deck editor", () => {
  it("adds the pages as slides, fills them in as they finish, and keeps the editor usable", async () => {
    await renderEditor();
    const pending = [
      slide("p1", 1, { importStatus: "pending" }),
      slide("p2", 2, { importStatus: "pending" }),
    ];
    api.upload.mockResolvedValue(job());
    api.deck.mockResolvedValue(deck([slide("s1", 0), ...pending]));

    chooseFile(pdfFile());
    await act(() => jest.advanceTimersByTimeAsync(0));

    expect(api.upload).toHaveBeenCalledWith("d1", expect.any(File));
    // The pages are slides at once, each waiting for its image.
    expect(slideButtons()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Slide 2, Content, importing" })).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "PDF import progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("You can keep editing.")).toBeInTheDocument();
    // The session cannot start while pages are missing.
    expect(screen.getByRole("button", { name: "Start session" })).toBeDisabled();

    // Page 1 is done.
    api.get.mockResolvedValue(detail({ donePages: 1 }));
    api.deck.mockResolvedValue(
      deck([slide("s1", 0), slide("p1", 1, { elements: [IMAGE] }), pending[1]]),
    );
    await nextLook();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.queryByRole("button", { name: "Slide 2, Content, importing" })).toBeNull();
    expect(screen.getByRole("button", { name: "Slide 3, Content, importing" })).toBeInTheDocument();

    // The last page is done, and the import is over.
    api.get.mockResolvedValue(detail({ status: "done", donePages: 2 }));
    api.deck.mockResolvedValue(
      deck([
        slide("s1", 0),
        slide("p1", 1, { elements: [IMAGE] }),
        slide("p2", 2, { elements: [IMAGE] }),
      ]),
    );
    await nextLook();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(await screen.findByText("Imported 2 pages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /importing$/ })).toBeNull();
  });

  it("does not drop the host's edits to another slide when a page comes in", async () => {
    await renderEditor();
    api.upload.mockResolvedValue(job({ pageCount: 1 }));
    api.deck.mockResolvedValue(deck([slide("s1", 0), slide("p1", 1, { importStatus: "pending" })]));
    chooseFile(pdfFile());
    await act(() => jest.advanceTimersByTimeAsync(0));

    // The server still has slide 1 empty; the host has just added a heading to it.
    fireEvent.click(slideButtons()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    const stageText = () => document.querySelectorAll("[data-canvas] [data-element-id]").length;
    const afterInsert = stageText();
    expect(afterInsert).toBeGreaterThan(0);

    api.get.mockResolvedValue(detail({ status: "done", pageCount: 1, donePages: 1 }));
    api.deck.mockResolvedValue(deck([slide("s1", 0), slide("p1", 1, { elements: [IMAGE] })]));
    await nextLook();
    fireEvent.click(slideButtons()[0]);
    expect(stageText()).toBe(afterInsert);
  });

  it("picks up an import that was still running when the editor opened", async () => {
    api.deck.mockResolvedValue(deck([slide("s1", 0), slide("p1", 1, { importStatus: "pending" })]));
    api.list.mockResolvedValue([job({ pageCount: 1 })]);
    renderWithIntl(
      <ToastProvider closeLabel="Close">
        <DeckEditor deckId="d1" />
      </ToastProvider>,
      "en",
    );
    await screen.findByRole("heading", { name: "INT365 W05" });
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("offers a retry for pages that failed, and runs the import again", async () => {
    await renderEditor();
    api.upload.mockResolvedValue(job({ pageCount: 2 }));
    api.deck.mockResolvedValue(
      deck([
        slide("s1", 0),
        slide("p1", 1, { importStatus: "pending" }),
        slide("p2", 2, { importStatus: "pending" }),
      ]),
    );
    chooseFile(pdfFile());
    await act(() => jest.advanceTimersByTimeAsync(0));

    api.get.mockResolvedValue(detail({ status: "done", donePages: 1, failedPages: 1 }));
    api.deck.mockResolvedValue(
      deck([
        slide("s1", 0),
        slide("p1", 1, { elements: [IMAGE] }),
        slide("p2", 2, { importStatus: "failed" }),
      ]),
    );
    await nextLook();
    expect(screen.getByText("1 of 2 pages could not be imported.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Slide 3, Content, import failed" }),
    ).toBeInTheDocument();
    // No success toast when something failed.
    expect(screen.queryByText(/^Imported/)).toBeNull();

    api.retry.mockResolvedValue(job({ pageCount: 2, donePages: 1, status: "queued" }));
    api.deck.mockResolvedValue(
      deck([
        slide("s1", 0),
        slide("p1", 1, { elements: [IMAGE] }),
        slide("p2", 2, { importStatus: "pending" }),
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(api.retry).toHaveBeenCalledWith("i1");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("button", { name: "Slide 3, Content, importing" })).toBeInTheDocument();
  });

  it("says why an import failed as a whole", async () => {
    api.deck.mockResolvedValue(deck([slide("s1", 0), slide("p1", 1, { importStatus: "failed" })]));
    api.list.mockResolvedValue([
      job({ status: "failed", pageCount: 1, failedPages: 1, errorCode: "PDF_INVALID" }),
    ]);
    renderWithIntl(
      <ToastProvider closeLabel="Close">
        <DeckEditor deckId="d1" />
      </ToastProvider>,
      "en",
    );
    await screen.findByRole("heading", { name: "INT365 W05" });
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(
      screen.getByText("Could not import lecture.pdf: The file is not a readable PDF."),
    ).toBeInTheDocument();
    // The selected slide says so too, with the same way out.
    fireEvent.click(slideButtons()[1]);
    const status = screen
      .getAllByRole("status")
      .find((el) => /could not be imported/.test(el.textContent ?? ""));
    expect(status).toBeDefined();
    expect(within(status!).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it.each([
    ["not_pdf", 415, "Choose a PDF file."],
    ["corrupt", 422, "This PDF is damaged and cannot be read."],
    ["protected", 422, "This PDF is password protected. Remove the password and try again."],
    ["too_many_pages", 422, "A PDF can have at most 150 pages."],
  ])("shows the server's reason when it refuses the file (%s)", async (reason, status, message) => {
    await renderEditor();
    api.upload.mockRejectedValue(
      new ApiError(status, "INVALID_PAYLOAD", "refused", { field: "file", reason }),
    );
    chooseFile(pdfFile());
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(slideButtons()).toHaveLength(1);
  });

  it("rejects a file that is not a PDF, or is too large, without asking the server", async () => {
    await renderEditor();
    chooseFile(new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByText("Choose a PDF file.")).toBeInTheDocument();

    const big = pdfFile("big.pdf");
    Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
    chooseFile(big);
    expect(await screen.findByText("This PDF is larger than 50 MB.")).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("does not offer a second import while one is running", async () => {
    await renderEditor();
    api.upload.mockResolvedValue(job());
    api.deck.mockResolvedValue(deck([slide("s1", 0), slide("p1", 1, { importStatus: "pending" })]));
    chooseFile(pdfFile());
    await act(() => jest.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^PDF file/ })).toBeDisabled();
  });
});
