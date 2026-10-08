import { describe, expect, it, vi } from "vitest";
import { createNotifier } from "./notify";
import { copyWithFeedback } from "./copyWithFeedback";

function fakeToast() {
  return { success: vi.fn(), error: vi.fn() };
}

describe("createNotifier", () => {
  it("uses short durations for success and longer ones for failures", () => {
    const toast = fakeToast();
    const notify = createNotifier(toast);

    notify("template.delete", "success", { targetName: "Invoice" });
    notify("template.delete", "failure", {});

    expect(toast.success.mock.calls[0][1]).toEqual({ duration: 4000 });
    expect(toast.error.mock.calls[0][1]).toEqual({ duration: 8000 });
  });

  it("adds the mapped reason to failures and never the raw message", () => {
    const toast = fakeToast();
    const notify = createNotifier(toast);

    notify("template.delete", "failure", { error: Object.assign(new Error("<html>"), { status: 403 }) });

    expect(toast.error.mock.calls[0][0]).toMatch(/You don't have permission to do that\.$/);
    expect(toast.error.mock.calls[0][0]).not.toMatch(/html/);
  });

  it("offers Undo and Try again actions", () => {
    const toast = fakeToast();
    const notify = createNotifier(toast);
    const undo = vi.fn();
    const retry = vi.fn();

    notify("template.delete", "success", { undo });
    notify("template.delete", "failure", { retry });

    expect(toast.success.mock.calls[0][1].action).toEqual({ label: "Undo", onClick: undo });
    expect(toast.error.mock.calls[0][1].action).toEqual({ label: "Try again", onClick: retry });
  });

  it("offers a link to related settings after a completed action", () => {
    const toast = fakeToast();
    const notify = createNotifier(toast);
    const onClick = vi.fn();

    notify("workspace.extractionModel", "success", { targetName: "best/model", link: { label: "Open model settings", onClick } });

    expect(toast.success).toHaveBeenCalledWith("Extraction model changed: best/model", expect.anything());
    expect(toast.success.mock.calls[0][1].action).toEqual({ label: "Open model settings", onClick });
  });
});

describe("copyWithFeedback", () => {
  it("reports success and failure with one toast each", async () => {
    const toast = fakeToast();
    const writeText = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    await expect(copyWithFeedback(toast, "abc", "Workspace ID")).resolves.toBe(true);
    await expect(copyWithFeedback(toast, "abc", "Workspace ID")).resolves.toBe(false);

    expect(toast.success).toHaveBeenCalledWith("Workspace ID copied", { duration: 4000 });
    expect(toast.error).toHaveBeenCalledWith("Couldn't copy. Select the text and copy it manually.", { duration: 8000 });
  });
});
