import React, { cloneElement, useEffect, useId, useState } from "react";
import "./Tooltip.css";

// Shows `content` on hover and keyboard focus. When the child already has an
// accessible name equal to the tip (icon buttons), the tip is visual only;
// otherwise it describes the child.
export function Tooltip({ content, placement = "top", describe = true, className, children }) {
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
      show();
    },
    onMouseLeave: (event) => {
      children.props.onMouseLeave?.(event);
      hide();
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
    <span className="ui-tooltip-anchor">
      {child}
      <span
        id={id}
        role="tooltip"
        aria-hidden={describe ? undefined : true}
        className={["ui-tooltip", `ui-tooltip-${placement}`, open && "is-open", className].filter(Boolean).join(" ")}
      >
        {content}
      </span>
    </span>
  );
}
