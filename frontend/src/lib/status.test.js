import { describe, expect, it } from "vitest";
import { statusLabel, statusTone } from "./status";

describe("statusLabel", () => {
  it("maps known statuses to user-facing labels", () => {
    expect(statusLabel("awaiting_template")).toBe("Needs template");
    expect(statusLabel("completed")).toBe("Completed");
    expect(statusLabel("QUEUED")).toBe("Queued");
  });

  it("humanises unknown statuses instead of showing raw values", () => {
    expect(statusLabel("some_new_state")).toBe("Some new state");
  });

  it("returns an empty string for missing statuses", () => {
    expect(statusLabel(undefined)).toBe("");
  });
});

describe("statusTone", () => {
  it("maps statuses onto the shared tone vocabulary", () => {
    expect(statusTone("completed")).toBe("success");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("awaiting_template")).toBe("warning");
    expect(statusTone("processing")).toBe("info");
    expect(statusTone("mystery")).toBe("neutral");
  });
});
