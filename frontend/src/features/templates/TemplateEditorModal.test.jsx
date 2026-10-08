import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { confirmLeavingUnsavedEdits, hasUnsavedEdits } from "../../lib/unsavedChanges.js";
import { TemplateEditorModal } from "./TemplateEditorModal.jsx";

const initial = {
  name: "Invoice",
  description: "Invoices",
  fields: [{ id: "total", name: "Total", description: "Invoice total", data_type: "string" }],
};

function renderEditor(props = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn(async () => {});
  render(<TemplateEditorModal initial={initial} onSubmit={onSubmit} onClose={onClose} {...props} />);

  return { onClose, onSubmit, user: userEvent.setup() };
}

const editName = (value = "Edited invoice") =>
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value } });

const backdrop = () => document.querySelector(".modal-backdrop");

describe("TemplateEditorModal unsaved edits", () => {
  it("closes without asking while the draft is unchanged", async () => {
    const { onClose, user } = renderEditor();

    expect(hasUnsavedEdits()).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("treats a draft edited back to its opening state as unchanged", async () => {
    const { onClose, user } = renderEditor();

    editName();
    editName("Invoice");
    await user.click(screen.getByRole("button", { name: "Close template editor" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ["Cancel", (user) => user.click(screen.getByRole("button", { name: "Cancel" }))],
    ["the close button", (user) => user.click(screen.getByRole("button", { name: "Close template editor" }))],
    ["Escape", (user) => user.keyboard("{Escape}")],
    [
      "the overlay",
      async () => {
        fireEvent.pointerDown(backdrop());
        fireEvent.pointerUp(backdrop());
      },
    ],
  ])("asks before %s discards edits", async (_name, dismiss) => {
    const { onClose, user } = renderEditor();

    editName();
    screen.getByLabelText("Template name").focus();
    await dismiss(user);

    expect(await screen.findByRole("alertdialog", { name: "Discard changes?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Template name").value).toBe("Edited invoice");

    screen.getByLabelText("Template name").focus();
    await dismiss(user);
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("closes without asking after a successful save", async () => {
    const { onClose, onSubmit, user } = renderEditor({ action: "Save template" });

    editName();
    await user.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Edited invoice" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("registers its edits so in-app navigation asks and closes it on discard", async () => {
    const { onClose, user } = renderEditor();

    expect(confirmLeavingUnsavedEdits({ page: "documents", workspaceId: "a" })).toBe(true);
    editName();
    expect(hasUnsavedEdits()).toBe(true);

    let verdict;
    act(() => {
      verdict = confirmLeavingUnsavedEdits({ page: "documents", workspaceId: "a" });
    });
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    await expect(verdict).resolves.toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a safe message instead of the raw validation error", async () => {
    const { onSubmit, user } = renderEditor();

    editName("");
    await user.click(screen.getByRole("button", { name: "Apply changes" }));

    expect((await screen.findAllByRole("alert")).map((node) => node.textContent)).toContain(
      "Template draft is incomplete. Fix required fields before saving.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
