import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const CONTROLS = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)";

export function ModalDialog({ label, className = "", initialFocus = "button, input, textarea, select", onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector(initialFocus)?.focus();
    return () => previous?.focus();
  }, [initialFocus]);
  const keyboard = event => {
    // Nested dialogs rendered through portals own their keyboard handling.
    if (!dialog.current.contains(event.target)) return;
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const controls = [...dialog.current.querySelectorAll(CONTROLS)];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  return createPortal(<div className="modal-backdrop" onClick={onClose}><div ref={dialog} className={`modal-card ${className}`} role="dialog" aria-modal="true" aria-label={label} onClick={event => event.stopPropagation()} onKeyDown={keyboard}>{children}</div></div>, document.body);
}
