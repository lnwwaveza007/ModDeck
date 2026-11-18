import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PinInfo } from "@moddeck/shared";
import { ApiError } from "@/lib/api/client";
import { getPinInfo } from "@/lib/api/participants";
import { renderWithIntl } from "@/test/render";
import { PinForm } from "./PinForm";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api/participants");

const info = jest.mocked(getPinInfo);
const PIN = "482914";

const pinInfo: PinInfo = {
  status: "live",
  title: "INT365 Software Engineering",
  hostName: "Somchai Jaidee",
  participantCount: 87,
  requireLogin: false,
  joined: null,
};

const apiError = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiError(status, code, code, details);

const field = () => screen.getByLabelText<HTMLInputElement>("PIN");
const type = (value: string) => fireEvent.change(field(), { target: { value } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PinForm", () => {
  it("keeps digits only and waits for all 6", () => {
    renderWithIntl(<PinForm />, "en");
    type("48a2 9");
    expect(field()).toHaveValue("4829");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    expect(info).not.toHaveBeenCalled();
  });

  it("goes to the join page when a session holds the PIN", async () => {
    info.mockResolvedValue(pinInfo);
    renderWithIntl(<PinForm />, "en");

    type(PIN);
    expect(info).toHaveBeenCalledWith(PIN);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/j/${PIN}`));
  });

  it("clears a wrong PIN and asks for it again, on the same page", async () => {
    info.mockRejectedValue(apiError(404, "NOT_FOUND"));
    renderWithIntl(<PinForm />, "en");

    type(PIN);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No class uses this PIN. Check the PIN on the screen and enter it again.",
    );
    expect(field()).toHaveValue("");
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("drops the message once the student types again, and tries the new PIN", async () => {
    info.mockRejectedValueOnce(apiError(404, "NOT_FOUND")).mockResolvedValue(pinInfo);
    renderWithIntl(<PinForm />, "en");

    type("111111");
    await screen.findByRole("alert");
    type("4");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("You join automatically after 6 digits")).toBeVisible();
    type(PIN);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/j/${PIN}`));
  });

  it("says how long to wait after too many wrong PINs", async () => {
    info.mockRejectedValue(apiError(429, "TOO_MANY_ATTEMPTS", { retryAfter: 42 }));
    renderWithIntl(<PinForm />, "en");

    type(PIN);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many wrong PINs. Wait 42 seconds, then enter the PIN again.",
    );
    expect(field()).toHaveValue("");
  });

  it("keeps the PIN when ModDeck can't be reached, so Join tries it again", async () => {
    info.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    info.mockResolvedValue(pinInfo);
    renderWithIntl(<PinForm />, "en");

    type(PIN);
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach ModDeck");
    expect(field()).toHaveValue(PIN);
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/j/${PIN}`));
  });

  it("leaves a full class to the join page, which explains it", async () => {
    info.mockRejectedValue(apiError(409, "SESSION_FULL"));
    renderWithIntl(<PinForm />, "en");

    type(PIN);
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/j/${PIN}`));
  });

  it("shows the message it was sent back with", () => {
    renderWithIntl(<PinForm initialError={{ kind: "invalid" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ไม่มีห้องเรียนที่ใช้ PIN นี้ ตรวจสอบ PIN บนจอแล้วใส่ใหม่อีกครั้ง",
    );
    expect(field()).toHaveValue("");
  });
});
