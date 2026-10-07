import React from "react";
import { describeError } from "../../lib/describeError";
import "./States.css";

// Shared load, empty and error states. Variants: "inline" for sidebar lists and
// small regions, "panel" for page bodies, "tableRow" inside a table (pass colSpan).
function StateFrame({ variant = "inline", colSpan, className, role, children }) {
  const classes = `ui-state ui-state-${variant} ${className}`;

  if (variant === "tableRow") {
    return (
      <tr className={classes} role={role}>
        <td colSpan={colSpan}>{children}</td>
      </tr>
    );
  }

  return (
    <div className={classes} role={role}>
      {children}
    </div>
  );
}

export function EmptyState({ message, action, variant, colSpan }) {
  return (
    <StateFrame variant={variant} colSpan={colSpan} className="ui-empty-state">
      <p>{message}</p>
      {action ? <div className="ui-state-action">{action}</div> : null}
    </StateFrame>
  );
}

export function Spinner({ size = "md" }) {
  return <span className={`ui-spinner ui-spinner-${size}`} aria-hidden="true" />;
}

export function LoadingState({ label = "Loading…", variant, colSpan }) {
  return (
    <StateFrame variant={variant} colSpan={colSpan} className="ui-loading-state" role="status">
      <Spinner size={variant === "panel" ? "md" : "sm"} />
      <p>{label}</p>
    </StateFrame>
  );
}

// Placeholder rows at a fixed height so content doesn't jump in when it loads.
export function Skeleton({ rows = 3, height = 36, label = "Loading…" }) {
  return (
    <div className="ui-skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="ui-skeleton-row" style={{ height }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, message, fallback = "This couldn't be loaded.", onRetry, variant, colSpan }) {
  const text = message || describeError(error, fallback);

  return (
    <StateFrame variant={variant} colSpan={colSpan} className="ui-error-state" role="alert">
      <p>{text}</p>
      {onRetry ? (
        <button type="button" className="secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </StateFrame>
  );
}

// The loading / error / empty / ready switch every list repeats.
export function ListStatus({
  status,
  error,
  errorMessage,
  onRetry,
  emptyMessage,
  emptyAction,
  isEmpty,
  skeletonRows = 4,
  children,
}) {
  if (status === "loading") return <Skeleton rows={skeletonRows} />;

  if (status === "error") return <ErrorState error={error} message={errorMessage} onRetry={onRetry} />;

  if (isEmpty) return <EmptyState message={emptyMessage} action={emptyAction} />;

  return children;
}
