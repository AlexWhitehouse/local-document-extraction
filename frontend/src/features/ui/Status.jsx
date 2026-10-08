import React from "react";
import { isBusyStatus, statusLabel, statusTone } from "../../lib/status";
import "./Status.css";

// Tones: neutral | info | success | warning | danger. Text always accompanies colour.
export function Badge({ tone = "neutral", busy = false, className, children, ...props }) {
  return (
    <span className={["ui-badge", `ui-tone-${tone}`, busy && "is-busy", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}

// A dot plus its label. With `srOnlyLabel` the label is read by screen readers only.
export function StatusDot({ tone = "neutral", label, pulse = false, srOnlyLabel = false }) {
  return (
    <span className={`ui-status-dot ui-tone-${tone}${pulse ? " is-busy" : ""}`}>
      <span className="ui-status-dot-mark" aria-hidden="true" />
      <span className={srOnlyLabel ? "sr-only" : "ui-status-dot-label"}>{label}</span>
    </span>
  );
}

// A raw backend status, labelled and toned consistently.
export function StatusBadge({ status, className }) {
  return (
    <Badge tone={statusTone(status)} busy={isBusyStatus(status)} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

// A small number, such as an open problem count. The label is read by screen readers only.
export function CountBadge({ count, label, tone = "neutral", className }) {
  return (
    <span className={["ui-count-badge", `ui-tone-${tone}`, className].filter(Boolean).join(" ")}>
      <span aria-hidden={label ? "true" : undefined}>{count}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

// A neutral chip for a label such as a tag. With `selectable` it is a toggle button.
export function Tag({ selectable = false, selected = false, onToggle, className, children, ...props }) {
  const classes = ["ui-tag", selected && "is-selected", className].filter(Boolean).join(" ");

  if (selectable)
    return (
      <button type="button" className={classes} aria-pressed={selected} onClick={onToggle} {...props}>
        {children}
      </button>
    );

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
