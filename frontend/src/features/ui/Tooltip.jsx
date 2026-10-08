import React, { cloneElement, useEffect, useId, useState } from "react";
import "./Tooltip.css";

// Shows `content` on hover and keyboard focus. When the child already has an
// accessible name equal to the tip (icon buttons), the tip is visual only;
// otherwise it describes the child. An interactive tip stays open while the
// pointer is over it, so its content can be read and selected.
export function Tooltip({ content, placement = "top", describe = true, interactive = false, className, children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  // A hovered tip has no focus, so Escape dismisses it from anywhere on the page.
  useEffect(() => {
    if (!open) return undefined;

    const dismiss = (event) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("keydown", dismiss);

    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  const child = cloneElement(children, {
    title: undefined,
    "aria-describedby": describe ? [children.props["aria-describedby"], id].filter(Boolean).join(" ") : children.props["aria-describedby"],
    onMouseEnter: (event) => {
      children.props.onMouseEnter?.(event);
      if (!interactive) show();
    },
    onMouseLeave: (event) => {
      children.props.onMouseLeave?.(event);
      if (!interactive) hide();
    },
    onFocus: (event) => {
      children.props.onFocus?.(event);
      show();
    },
    onBlur: (event) => {
      children.props.onBlur?.(event);
      hide();
    },
    onKeyDown: (event) => {
      children.props.onKeyDown?.(event);

      if (event.key === "Escape") hide();
    },
  });

  return (
    <span className="ui-tooltip-anchor" {...(interactive ? { onMouseEnter: show, onMouseLeave: hide } : {})}>
      {child}
      <span
        id={id}
        role="tooltip"
        aria-hidden={describe ? undefined : true}
        className={["ui-tooltip", `ui-tooltip-${placement}`, interactive && "is-interactive", open && "is-open", className].filter(Boolean).join(" ")}
      >
        {content}
      </span>
    </span>
  );
}
