import React from "react";
import { describeLocation } from "../../../../shared/templateAssistant.ts";
import "./TemplateAssistant.css";
import { ChevronLeftIcon, ChevronRightIcon } from "../layout/Icons.jsx";
import { Button } from "../ui/Button.jsx";

export function TemplateProblems({ issues, draft, onFocus, activeIndex = 0, onIndexChange, blocked = null }) {
  if (!issues.length) return null;
  const index = Math.min(activeIndex, issues.length - 1);
  const current = issues[index];

  const focus = (next) => {
    const position = (next + issues.length) % issues.length;
    onIndexChange?.(position);
    onFocus(issues[position]);
  };

  return (
    <div
      key={blocked ?? "problems"}
      className={blocked ? "template-problems template-problems-pulse" : "template-problems"}
      aria-label="Template problems"
      role="status"
      aria-live="polite"
    >
      <span className="template-problems-count">
        {blocked
          ? "Fix these to save"
          : `${issues.length} problem${issues.length === 1 ? "" : "s"} stop${issues.length === 1 ? "s" : ""} this template saving`}
      </span>
      <button
        type="button"
        className="template-problems-current"
        title="Go to this problem"
        onClick={() => focus(index)}
      >
        <span>
          {index + 1}/{issues.length}
        </span>
        <strong>{describeLocation(current.location, draft)}</strong>
        <em>{current.title}</em>
      </button>
      <span className="template-problems-nav">
        <Button
          type="button"
          variant="text"
          aria-label="Previous problem"
          disabled={issues.length < 2}
          onClick={() => focus(index - 1)}
        >
          <ChevronLeftIcon />
          Prev
        </Button>
        <Button
          type="button"
          variant="text"
          aria-label="Next problem"
          disabled={issues.length < 2}
          onClick={() => focus(index + 1)}
        >
          Next
          <ChevronRightIcon />
        </Button>
      </span>
    </div>
  );
}
