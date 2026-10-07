import { describe, expect, it } from "vitest";
import { describeError } from "./describeError";

const failure = (message, extra) => Object.assign(new Error(message), extra);

describe("describeError", () => {
  it("maps HTTP statuses to plain messages", () => {
    expect(describeError(failure("nope", { status: 403 }))).toBe("You don't have permission to do that.");
    expect(describeError(failure("gone", { status: 404 }))).toBe("This item no longer exists.");
    expect(describeError(failure("busy", { status: 429 }))).toBe("Studio is busy. Try again in a moment.");
  });

  it("shows readable server messages only for allow-listed codes", () => {
    expect(describeError(failure("A tag with that name already exists.", { status: 409, code: "tag_name_conflict" }))).toBe(
      "A tag with that name already exists.",
    );
    expect(describeError(failure("internal detail", { status: 400, code: "something_else" }), "Couldn't save.")).toBe(
      "Couldn't save.",
    );
  });

  it("never returns HTML or stack traces", () => {
    expect(describeError(failure("<html><body>502</body></html>", { status: 502, code: "tag_name_conflict" }))).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("reports network failures", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toMatch(/can't be reached|offline/);
  });
});
