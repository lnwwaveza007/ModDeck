import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { MeView } from "@moddeck/shared";
import { getMe, searchUsers, startImpersonating, stopImpersonating } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import { hardNavigate } from "@/lib/hard-navigate";
import { renderWithIntl } from "@/test/render";
import { ImpersonateControl } from "./ImpersonateControl";

jest.mock("@/lib/api/admin");
jest.mock("@/lib/hard-navigate");

const admin: MeView = {
  id: "admin-1",
  email: "admin@kmutt.ac.th",
  displayName: "Admin",
  studentId: null,
  isAdmin: true,
  impersonator: null,
};
const host = { id: "host-1", email: "host@kmutt.ac.th", displayName: "Host Teacher" };

beforeEach(() => {
  jest.resetAllMocks();
  jest.useRealTimers();
});

describe("ImpersonateControl", () => {
  it("shows nothing to a host who is not an admin", async () => {
    jest.mocked(getMe).mockResolvedValue({ ...admin, isAdmin: false });
    const { container } = renderWithIntl(<ImpersonateControl />, "en");
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when signed out", async () => {
    jest.mocked(getMe).mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Unauthorized"));
    const { container } = renderWithIntl(<ImpersonateControl />, "en");
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("lets an admin pick a user, then reloads as that user", async () => {
    jest.mocked(getMe).mockResolvedValue(admin);
    // The admin's own row is left out of the list.
    jest
      .mocked(searchUsers)
      .mockResolvedValue([
        { id: admin.id, email: admin.email, displayName: admin.displayName },
        host,
      ]);
    jest.mocked(startImpersonating).mockResolvedValue({ ...admin, ...host, impersonator: admin });

    renderWithIntl(<ImpersonateControl />, "en");
    fireEvent.click(await screen.findByRole("button", { name: "Impersonate" }));
    expect(screen.getByRole("dialog", { name: "Impersonate a user" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Find a user"), { target: { value: "host" } });
    const row = await screen.findByRole("button", { name: /Host Teacher/ });
    expect(screen.queryByRole("button", { name: /admin@kmutt\.ac\.th/ })).not.toBeInTheDocument();
    expect(searchUsers).toHaveBeenLastCalledWith("host", expect.any(AbortSignal));

    fireEvent.click(row);
    await waitFor(() => expect(startImpersonating).toHaveBeenCalledWith("host-1"));
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/decks"));
  });

  it("shows who the admin acts as and stops", async () => {
    jest.mocked(getMe).mockResolvedValue({
      ...host,
      studentId: null,
      isAdmin: true,
      impersonator: { id: admin.id, email: admin.email, displayName: admin.displayName },
    });
    jest.mocked(stopImpersonating).mockResolvedValue(undefined);

    renderWithIntl(<ImpersonateControl />, "en");
    expect(await screen.findByText("Host Teacher")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Viewing as Host Teacher");
    expect(screen.queryByRole("button", { name: "Impersonate" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled());
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("/decks"));
  });

  it("keeps the chip when stopping fails", async () => {
    jest.mocked(getMe).mockResolvedValue({ ...admin, ...host, impersonator: admin });
    jest.mocked(stopImpersonating).mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "down"));

    renderWithIntl(<ImpersonateControl />, "en");
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});
