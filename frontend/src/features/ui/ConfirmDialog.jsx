import React, { useId, useState } from "react";
import { ModalDialog } from "../layout/ModalDialog";
import { describeError } from "../../lib/describeError";

// One confirmation surface for destructive and discard prompts. `action` keeps the
// dialog open, with a pending label, until it settles; failures stay inline.
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pendingLabel,
  tone = "danger",
  action,
  onSettle,
}) {
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const isDanger = tone === "danger";

  const confirm = async () => {
    if (pending) return;

    if (!action) {
      onSettle(true);

      return;
    }

    setPending(true);
    setError("");

    try {
      await action();
      onSettle(true);
    } catch (failure) {
      setError(describeError(failure));
      setPending(false);
    }
  };

  return (
    <ModalDialog
      labelledBy={titleId}
      className="confirm-dialog"
      role="alertdialog"
      initialFocus={isDanger ? "[data-confirm-cancel]" : "[data-confirm-action]"}
      closeDisabled={pending}
      onClose={() => onSettle(false)}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();

          // Enter alone never confirms a destructive action.
          if (!isDanger) confirm();
        }}
      >
        <h2 id={titleId} className="confirm-dialog-title">
          {title}
        </h2>
        {body ? <p className="confirm-dialog-body">{body}</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="actions confirm-dialog-actions">
          <button type="button" className="secondary" data-confirm-cancel disabled={pending} onClick={() => onSettle(false)}>
            {cancelLabel}
          </button>
          <button
            type={isDanger ? "button" : "submit"}
            className={isDanger ? "danger" : undefined}
            data-confirm-action
            disabled={pending}
            onClick={isDanger ? confirm : undefined}
          >
            {pending ? pendingLabel || `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
