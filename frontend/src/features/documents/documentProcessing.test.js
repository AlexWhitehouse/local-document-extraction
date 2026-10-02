import { describe, expect, it } from "vitest";
import { formatPages, parsePageSelection, validateSplitPlan } from "./documentProcessing.js";

describe("Original PDF page selections", () => {
  it("expands ranges and preserves sorted unique physical page numbers", () => {
    expect(parsePageSelection("5, 1-3, 2")).toEqual([1, 2, 3, 5]);
    expect(parsePageSelection(" ")).toBeNull();
    expect(formatPages([1, 3])).toBe("1, 3");
  });
  it.each(["0", "2-1", "1,", "1.5", "1-10001", "9007199254740992", "abc"])("rejects invalid page selection %s", (value) => {
    expect(() => parsePageSelection(value)).toThrow();
  });
  it("requires every selected page exactly once, with reasons for exclusions", () => {
    const groups = [{ pages: [1, 3] }];
    const exclusions = [{ page: 2, reason: "Blank" }];
    expect(validateSplitPlan(groups, exclusions, [1, 2, 3])).toEqual({ groups, exclusions });
    expect(() => validateSplitPlan(groups, [], [1, 2, 3])).toThrow("Assign or explicitly exclude pages: 2");
    expect(() => validateSplitPlan([{ pages: [1] }, { pages: [1] }], [], [1])).toThrow("more than once");
    expect(() => validateSplitPlan(groups, [{ page: 2, reason: "" }], [1, 2, 3])).toThrow("Give a reason");
    expect(() => validateSplitPlan(groups, [{ page: 1, reason: "Blank" }], [1, 2, 3])).toThrow("more than once");
    expect(() => validateSplitPlan([{ pages: [] }], [], [1])).toThrow("at least one page");
    expect(() => validateSplitPlan(groups, [], [1])).toThrow("outside");
  });
});
