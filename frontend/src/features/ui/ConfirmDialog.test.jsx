import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { confirmDialog } from "./confirm.jsx";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";

function open(options) {
  let result;

  act(() => {
    result = confirmDialog(options);
  });

  return result;
}

describe("confirmDialog", () => {
  it("focuses Cancel for danger prompts and resolves false on cancel", async () => {
    const user = userEvent.setup();
    const result = open({ title: 'Delete "Invoice"?', confirmLabel: "Delete template" });

    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    expect(screen.getByRole("alertdialog", { name: 'Delete "Invoice"?' })).toBeTruthy();

    await user.click(cancel);
    await expect(result).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("does not confirm a danger prompt with Enter", async () => {
    const user = userEvent.setup();
    const result = open({ title: "Delete?", confirmLabel: "Delete" });
    await screen.findByRole("alertdialog");

    // Enter activates the focused Cancel button, never the destructive action.
    await user.keyboard("{Enter}");
    await expect(result).resolves.toBe(false);
  });

  it("confirms default prompts with Enter", async () => {
    const user = userEvent.setup();
    const result = open({ title: "Discard changes?", confirmLabel: "Discard", tone: "default" });
    await screen.findByRole("alertdialog");

    await user.keyboard("{Enter}");
    await expect(result).resolves.toBe(true);
  });

  it("stays open with a pending label until the action settles, and shows failures inline", async () => {
    const user = userEvent.setup();
    let finish;

    const action = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("<html>proxy</html>"), { status: 403 }))
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

    const result = open({ title: "Remove Jane?", confirmLabel: "Remove Jane", pendingLabel: "Removing…", action });

    await user.click(await screen.findByRole("button", { name: "Remove Jane" }));
    expect((await screen.findByRole("alert")).textContent).toBe("You don't have permission to do that.");
    expect(screen.queryByText(/proxy/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove Jane" }));
    expect(screen.getByRole("button", { name: "Removing…" }).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    await act(async () => finish());
    await expect(result).resolves.toBe(true);
  });
});

function DirtyModal({ onClose }) {
  const [value, setValue] = useState("");

  return (
    <ModalDialog labelledBy="dirty-title" isDirty={Boolean(value)} onClose={onClose}>
      <ModalHeader title="Edit name" titleId="dirty-title" onClose={onClose} />
      <input aria-label="Name" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="button">Save</button>
    </ModalDialog>
  );
}

describe("ModalDialog", () => {
  it("focuses the first field, is labelled by its title and restores focus on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<DirtyModal onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Edit name" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("asks before closing when dirty", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DirtyModal onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Name"), "Jane");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it("closes on the backdrop only when the press starts and ends there", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DirtyModal onClose={onClose} />);
    const backdrop = document.querySelector(".modal-backdrop");

    await user.pointer([{ keys: "[MouseLeft>]", target: screen.getByLabelText("Name") }, { keys: "[/MouseLeft]", target: backdrop }]);
    expect(onClose).not.toHaveBeenCalled();

    await user.pointer([{ keys: "[MouseLeft>]", target: backdrop }, { keys: "[/MouseLeft]", target: backdrop }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(<DirtyModal onClose={() => {}} />);

    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});
