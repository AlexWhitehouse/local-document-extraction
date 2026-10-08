import React, { useEffect, useId, useRef } from "react";
import "./Popover.css";

// An anchored panel with one set of dismissal rules: outside press and Escape
// close it, and focus returns to the trigger. The caller owns `open`.
export function Popover({
  open,
  onClose,
  trigger,
  label,
  align = "end",
  className,
  panelClassName,
  role = "dialog",
  children,
}) {
  const root = useRef(null);
  const panelId = useId();
  const wasOpen = useRef(false);
  // An outside press moves focus where the user clicked, so only Escape and in-panel closes return it.
  const restoreFocus = useRef(true);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (root.current?.contains(event.target)) return;

      restoreFocus.current = false;
      onClose({ restoreFocus: false });
    };

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;

      event.stopPropagation();
      restoreFocus.current = true;
      onClose({ restoreFocus: true });
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      restoreFocus.current = true;

      return;
    }

    // Return focus to the trigger when the panel held it as it closed (not on mount).
    if (!wasOpen.current) return;

    wasOpen.current = false;

    // Wait a tick: an action that closes the panel may open a dialog that takes focus itself.
    const timer = setTimeout(() => {
      const trigger = root.current?.querySelector("[data-popover-trigger]");
      const focusInside = root.current?.contains(document.activeElement) || document.activeElement === document.body;

      if (restoreFocus.current && focusInside) trigger?.focus();
    }, 0);

    return () => clearTimeout(timer);
  }, [open]);

  return (
    <div className={["ui-popover-root", className].filter(Boolean).join(" ")} ref={root}>
      {trigger({ "aria-expanded": open, "aria-controls": open ? panelId : undefined, "data-popover-trigger": true })}
      {open ? (
        <div
          id={panelId}
          className={["ui-popover", `ui-popover-${align}`, panelClassName].filter(Boolean).join(" ")}
          role={role}
          aria-label={label}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
