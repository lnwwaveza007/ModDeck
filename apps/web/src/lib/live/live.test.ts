import { formatDuration, secondsLeft } from "./clock";
import { toggleAction } from "./commands";
import { shortcutFor } from "./shortcuts";

const key = (
  k: string,
  init: Partial<KeyboardEvent> = {},
  target: EventTarget | null = document.body,
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...init,
  target,
});

describe("shortcutFor", () => {
  it("moves slides with the arrows, space and page keys", () => {
    expect(shortcutFor(key("ArrowRight"))).toBe("next");
    expect(shortcutFor(key(" "))).toBe("next");
    expect(shortcutFor(key("PageDown"))).toBe("next");
    expect(shortcutFor(key("ArrowLeft"))).toBe("previous");
    expect(shortcutFor(key(" ", { shiftKey: true }))).toBe("previous");
    expect(shortcutFor(key("Home"))).toBe("first");
    expect(shortcutFor(key("End"))).toBe("last");
  });

  it("maps the letter keys in either case", () => {
    expect(shortcutFor(key("a"))).toBe("toggleActivity");
    expect(shortcutFor(key("S"))).toBe("showResults");
    expect(shortcutFor(key("o"))).toBe("overlay");
    expect(shortcutFor(key("O"))).toBe("overlay");
    expect(shortcutFor(key("b"))).toBe("blank");
    expect(shortcutFor(key("j"))).toBe("join");
    expect(shortcutFor(key("f"))).toBe("fullscreen");
    expect(shortcutFor(key("?"))).toBe("help");
    expect(shortcutFor(key("x"))).toBeNull();
  });

  it("stays out of the way of typing and browser shortcuts", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const button = document.createElement("button");
    expect(shortcutFor(key("ArrowRight", {}, input))).toBeNull();
    expect(shortcutFor(key("a", {}, textarea))).toBeNull();
    expect(shortcutFor(key(" ", {}, button))).toBeNull();
    expect(shortcutFor(key("ArrowRight", {}, button))).toBe("next");
    expect(shortcutFor(key("f", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("leaves the keys to an open dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("span");
    dialog.append(inside);
    expect(shortcutFor(key("ArrowRight", {}, inside))).toBeNull();
  });
});

describe("toggleAction", () => {
  it("starts a draft, stops a live activity and reopens a closed one", () => {
    expect(toggleAction("draft")).toBe("start");
    expect(toggleAction("live")).toBe("stop");
    expect(toggleAction("closed")).toBe("reopen");
    expect(toggleAction("results_shown")).toBe("reopen");
  });
});

describe("clock", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("rounds the time left up and never below zero", () => {
    expect(secondsLeft(10_500, 10_000)).toBe(1);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
  });
});
