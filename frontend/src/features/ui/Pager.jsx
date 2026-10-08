import React from "react";
import { IconButton } from "./Button.jsx";
import { ChevronLeftIcon, ChevronRightIcon } from "../layout/Icons.jsx";
import "./Pager.css";

// Previous / next paging with a position label.
export function Pager({ label, hasPrevious, hasNext, onPrevious, onNext, disabled, className }) {
  return (
    <nav className={["ui-pager", className].filter(Boolean).join(" ")} aria-label="Pagination">
      <IconButton label="Previous page" icon={ChevronLeftIcon} size="sm" disabled={disabled || !hasPrevious} onClick={onPrevious} />
      {label ? <span className="ui-pager-label">{label}</span> : null}
      <IconButton label="Next page" icon={ChevronRightIcon} size="sm" disabled={disabled || !hasNext} onClick={onNext} />
    </nav>
  );
}

// Appends the next page to a list; shows its own pending and failure state.
export function LoadMore({ onLoadMore, pending, error, label = "Load more" }) {
  return (
    <div className="ui-load-more">
      {error ? (
        <p className="ui-load-more-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className="ghost" disabled={pending} onClick={onLoadMore}>
        {pending ? "Loading…" : error ? "Try again" : label}
      </button>
    </div>
  );
}
