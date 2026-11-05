import {
  activityActionBodySchema,
  activityWordingBodySchema,
  availableActivityActions,
  nextActivityState,
} from "./live";

describe("activity state machine", () => {
  it("starts only from draft", () => {
    expect(nextActivityState("draft", "start")).toBe("live");
    expect(nextActivityState("live", "start")).toBeNull();
    expect(nextActivityState("closed", "start")).toBeNull();
  });

  it("stops, shows results and reopens", () => {
    expect(nextActivityState("live", "stop")).toBe("closed");
    expect(nextActivityState("live", "show_results")).toBe("results_shown");
    expect(nextActivityState("closed", "show_results")).toBe("results_shown");
    expect(nextActivityState("closed", "reopen")).toBe("live");
    expect(nextActivityState("results_shown", "reopen")).toBe("live");
  });

  it("refuses the moves that make no sense", () => {
    expect(nextActivityState("draft", "stop")).toBeNull();
    expect(nextActivityState("draft", "show_results")).toBeNull();
    expect(nextActivityState("draft", "reopen")).toBeNull();
    expect(nextActivityState("results_shown", "stop")).toBeNull();
    expect(nextActivityState("results_shown", "show_results")).toBeNull();
    expect(nextActivityState("live", "reopen")).toBeNull();
  });

  it("lists the buttons of each state", () => {
    expect(availableActivityActions("draft")).toEqual(["start"]);
    expect(availableActivityActions("live")).toEqual(["stop", "show_results"]);
    expect(availableActivityActions("closed")).toEqual(["show_results", "reopen"]);
    expect(availableActivityActions("results_shown")).toEqual(["reopen"]);
  });
});

describe("activityActionBodySchema", () => {
  it("takes a timer on start and reopen only", () => {
    expect(
      activityActionBodySchema.safeParse({ action: "start", durationSeconds: 60 }).success,
    ).toBe(true);
    expect(
      activityActionBodySchema.safeParse({ action: "reopen", durationSeconds: 30 }).success,
    ).toBe(true);
    expect(
      activityActionBodySchema.safeParse({ action: "stop", durationSeconds: 30 }).success,
    ).toBe(false);
    expect(activityActionBodySchema.safeParse({ action: "show_results" }).success).toBe(true);
  });

  it("keeps the timer between 5 s and 1 h", () => {
    expect(
      activityActionBodySchema.safeParse({ action: "start", durationSeconds: 4 }).success,
    ).toBe(false);
    expect(
      activityActionBodySchema.safeParse({ action: "start", durationSeconds: 3601 }).success,
    ).toBe(false);
    expect(
      activityActionBodySchema.safeParse({ action: "start", durationSeconds: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(activityActionBodySchema.safeParse({ action: "delete" }).success).toBe(false);
  });
});

describe("activityWordingBodySchema", () => {
  it("trims the wording and needs a prompt", () => {
    const parsed = activityWordingBodySchema.parse({ prompt: "  Which one?  " });
    expect(parsed.prompt).toBe("Which one?");
    expect(activityWordingBodySchema.safeParse({ prompt: "   " }).success).toBe(false);
  });

  it("rejects an empty option label", () => {
    expect(
      activityWordingBodySchema.safeParse({ prompt: "Q", options: [{ label: " " }] }).success,
    ).toBe(false);
  });

  it("rejects the same option id twice", () => {
    const id = "0190f2a4-7b1c-7000-8000-000000000001";
    const other = "0190f2a4-7b1c-7000-8000-000000000002";
    expect(
      activityWordingBodySchema.safeParse({
        prompt: "Q",
        options: [
          { id, label: "Red" },
          { id, label: "Blue" },
        ],
      }).success,
    ).toBe(false);
    expect(
      activityWordingBodySchema.safeParse({
        prompt: "Q",
        options: [{ id, label: "Red" }, { id: other, label: "Blue" }, { label: "New" }],
      }).success,
    ).toBe(true);
  });
});
