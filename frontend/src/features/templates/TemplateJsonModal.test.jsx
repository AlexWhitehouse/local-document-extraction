import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TemplateJsonModal } from "./TemplateJsonModal.jsx";

function renderModal(overrides = {}) {
  const props = {
    isOpen: true,
    isDirty: false,
    draft: "{}",
    error: "",
    diagnostics: [],
    copied: false,
    isSavingTemplate: false,
    hasApiAccess: true,
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  };

  render(<TemplateJsonModal {...props} />);

  return props;
}

describe("TemplateJsonModal closing", () => {
  it("closes on Escape when the draft is clean", () => {
    const props = renderModal();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Export or import JSON" }), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding an edited draft from Escape and Cancel", async () => {
    const user = userEvent.setup();
    const props = renderModal({ isDirty: true });

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Export or import JSON" }), { key: "Escape" });
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(props.onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TemplateJsonModal copy feedback", () => {
  it("shows a check mark on the copy button without repeating the outcome inline", () => {
    renderModal({ copied: true });

    expect(screen.getByRole("button", { name: "Copy template JSON" })).toBeTruthy();
    expect(screen.queryByText("Copied JSON to clipboard.")).toBeNull();
  });
});

describe("TemplateJsonModal validation", () => {
  it("shows a JSON error inline on the textarea instead of a hint", () => {
    renderModal({ error: "Template JSON must be an object." });

    const textarea = screen.getByLabelText("Template JSON");
    const error = screen.getByText("Template JSON must be an object.");

    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect(textarea.getAttribute("aria-describedby").split(" ")).toContain(error.id);
  });
});
