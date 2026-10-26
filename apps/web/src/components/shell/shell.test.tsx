import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { setLocale } from "@/lib/i18n/actions";
import { LanguageSwitch } from "./LanguageSwitch";
import { PagePlaceholder } from "./PagePlaceholder";
import { RouteError } from "./RouteError";

jest.mock("@/lib/i18n/actions", () => ({ setLocale: jest.fn() }));

describe("LanguageSwitch", () => {
  afterEach(() => jest.mocked(setLocale).mockClear());

  it("switches Thai to English", () => {
    renderWithIntl(<LanguageSwitch />, "th");
    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    expect(setLocale).toHaveBeenCalledWith("en");
  });

  it("switches English to Thai", () => {
    renderWithIntl(<LanguageSwitch />, "en");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนเป็นภาษาไทย" }));
    expect(setLocale).toHaveBeenCalledWith("th");
  });
});

describe("PagePlaceholder", () => {
  it("shows the screen name in the current language", () => {
    renderWithIntl(<PagePlaceholder page="decks" />, "th");
    expect(screen.getByRole("heading", { name: "เด็คของฉัน" })).toBeInTheDocument();
  });

  it("shows English when English is chosen", () => {
    renderWithIntl(<PagePlaceholder page="decks" />, "en");
    expect(screen.getByRole("heading", { name: "My decks" })).toBeInTheDocument();
    expect(screen.getByText("This page is under construction")).toBeInTheDocument();
  });
});

describe("RouteError", () => {
  it("shows the error state and retries", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const retry = jest.fn();
    renderWithIntl(<RouteError error={new Error("boom")} retry={retry} />, "en");
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});
