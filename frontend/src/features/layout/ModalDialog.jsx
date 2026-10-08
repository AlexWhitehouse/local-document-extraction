import React, { createContext, useContext, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DISCARD_CHANGES, confirmDialog } from "../ui/confirm.jsx";
import { CloseIcon } from "./Icons.jsx";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type=hidden])",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const FIELDS = "input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled)";

// Every open modal marks the app root inert; the count keeps nested modals from
// releasing it early.
let inertCount = 0;

function holdAppInert() {
  const root = document.getElementById("root");
  inertCount += 1;
  root?.setAttribute("inert", "");

  return () => {
    inertCount -= 1;

    if (inertCount === 0) root?.removeAttribute("inert");
  };
}

// Lets the shared close control route through the dialog's dirty-aware close.
const ModalCloseContext = createContext(null);

export function ModalDialog({
  label,
  labelledBy,
  role = "dialog",
  className = "",
  initialFocus,
  isDirty = false,
  closeDisabled = false,
  onClose,
  children,
  ...cardProps
}) {
  const dialog = useRef(null);
  const backdropPress = useRef(false);
  const closing = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    const releaseInert = holdAppInert();
    const node = dialog.current;

    const target =
      (initialFocus && node?.querySelector(initialFocus)) ||
      node?.querySelector(FIELDS) ||
      [...(node?.querySelectorAll(FOCUSABLE) || [])].find((element) => !element.classList.contains("modal-close")) ||
      node;

    target?.focus();

    return () => {
      releaseInert();
      previous?.focus?.();
    };
  }, [initialFocus]);

  const requestClose = async () => {
    if (closeDisabled || closing.current) return;

    if (!isDirty) {
      onClose();

      return;
    }

    closing.current = true;

    try {
      if (await confirmDialog(DISCARD_CHANGES)) onClose();
    } finally {
      closing.current = false;
    }
  };

  const keyboard = (event) => {
    // Nested dialogs rendered through portals own their keyboard handling.
    if (!dialog.current.contains(event.target)) return;

    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
    }

    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll(FOCUSABLE)];

    const first = controls[0],
      last = controls.at(-1);

    if (!first) {
      event.preventDefault();

      return;
    }

    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Close on the backdrop only when the press both starts and ends there, so a text
  // selection dragged out of the card doesn't dismiss it.
  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget) requestClose();

        backdropPress.current = false;
      }}
    >
      <div
        {...cardProps}
        ref={dialog}
        className={`modal-card ${className}`}
        role={role}
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={keyboard}
      >
        <ModalCloseContext.Provider value={requestClose}>{children}</ModalCloseContext.Provider>
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
  const requestClose = useContext(ModalCloseContext);

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
              onClick={requestClose || onClose}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The standard modal action row: secondary actions first, the primary action last.
export function ModalFooter({ className = "", children }) {
  return <div className={`actions modal-footer ${className}`.trim()}>{children}</div>;
}
