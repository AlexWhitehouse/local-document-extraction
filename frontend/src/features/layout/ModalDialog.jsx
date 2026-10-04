import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const CONTROLS = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)";

export function ModalDialog({
  label,
  className = "",
  initialFocus = "button, input, textarea, select",
  onClose,
  children,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector(initialFocus)?.focus();

    return () => previous?.focus();
  }, [initialFocus]);

  const keyboard = (event) => {
    // Nested dialogs rendered through portals own their keyboard handling.
    if (!dialog.current.contains(event.target)) return;

    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }

    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll(CONTROLS)];

    const first = controls[0],
      last = controls.at(-1);

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className={`modal-card ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={keyboard}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// The standard modal title strip: title and optional description, with an optional
// trailing slot and the one shared close control.
export function ModalHeader({
  title,
  titleId,
  description,
  onClose,
  closeLabel = "Close",
  closeDisabled = false,
  children,
}) {
  return (
    <div className="workspace-head modal-head">
      <div>
        <h2 id={titleId}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children || onClose ? (
        <div className="modal-head-actions">
          {children}
          {onClose ? (
            <button
              type="button"
              className="modal-close"
              aria-label={closeLabel}
              title={closeLabel}
              disabled={closeDisabled}
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
