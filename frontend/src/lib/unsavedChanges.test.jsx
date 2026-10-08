import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { hasUnsavedEdits, unsavedEditLabels, useUnsavedGuard } from "./unsavedChanges";

function Editor({ dirty, label = "Editor" }) {
  useUnsavedGuard(dirty, label);

  return null;
}

describe("useUnsavedGuard", () => {
  it("registers only while the editor is dirty and mounted", () => {
    const { rerender, unmount } = render(<Editor dirty={false} />);
    expect(hasUnsavedEdits()).toBe(false);

    rerender(<Editor dirty label="Expected answer" />);
    expect(hasUnsavedEdits()).toBe(true);
    expect(unsavedEditLabels()).toEqual(["Expected answer"]);

    unmount();
    expect(hasUnsavedEdits()).toBe(false);
  });
});
