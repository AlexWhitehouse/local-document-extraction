import React from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

export const DISCARD_CHANGES = {
  title: "Discard changes?",
  body: "Your edits will be lost.",
  confirmLabel: "Discard",
  cancelLabel: "Keep editing",
  tone: "default",
};

const openDialogs = new Set();

// Cancels every open confirmation, for example when the session ends.
export function dismissConfirmDialogs() {
  for (const settle of [...openDialogs]) settle(false);
}

// Imperative entry point so controllers can `await confirmDialog({...})` where they
// previously called window.confirm. Resolves true when confirmed (and `action`, if
// given, succeeded), false when cancelled.
export function confirmDialog(options) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const settle = (confirmed) => {
      openDialogs.delete(settle);
      resolve(confirmed);
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };

    openDialogs.add(settle);
    root.render(<ConfirmDialog {...options} onSettle={settle} />);
  });
}

export function useConfirm() {
  return confirmDialog;
}
