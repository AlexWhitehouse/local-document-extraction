import { describe, expect, it } from "vitest";
import { pluralize } from "./text";

describe("pluralize", () => {
  it("uses the singular form for one", () => {
    expect(pluralize(1, "member")).toBe("1 member");
  });

  it("adds s for other counts by default", () => {
    expect(pluralize(0, "member")).toBe("0 members");
    expect(pluralize(3, "member")).toBe("3 members");
  });

  it("uses an explicit plural form", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
  });
});
