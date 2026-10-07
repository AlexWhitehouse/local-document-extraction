import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextCopyButton } from "./ContextCopyButton.jsx";

describe("ContextCopyButton", () => {
  let toast;

  beforeEach(() => {
    vi.useRealTimers();
    toast = { error: vi.fn(), success: vi.fn() };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies the value, reports one toast, and shows a check mark briefly", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ContextCopyButton ariaLabel="Copy workspace ID ws_1" label="Workspace ID" toast={toast} value="ws_1" />);

    const button = screen.getByRole("button", { name: "Copy workspace ID ws_1" });
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("data-copied")).toBe("true"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("ws_1");
    expect(toast.success).toHaveBeenCalledWith("Workspace ID copied", expect.anything());

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await waitFor(() => expect(button.getAttribute("data-copied")).toBeNull());
  });

  it("reports a failed copy with a toast and no check mark", async () => {
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    render(<ContextCopyButton ariaLabel="Copy template ID t_1" toast={toast} value="t_1" />);

    const button = screen.getByRole("button", { name: "Copy template ID t_1" });
    fireEvent.click(button);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't copy"), expect.anything()));
    expect(button.getAttribute("data-copied")).toBeNull();
  });
});
