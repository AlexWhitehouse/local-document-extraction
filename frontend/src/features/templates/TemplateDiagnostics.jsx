import React from "react";
import { describeLocation } from "../../../../shared/templateAssistant.ts";
import "./TemplateAssistant.css";

export function DiagnosticMessages({ issues = [], id, compact = false }) {
  if (!issues.length) return null;

  return (
    <div id={id} className={compact ? "template-problem-messages compact" : "template-problem-messages"}>
      {issues.map((issue) => (
        <p key={issue.id} className="template-problem-message">
          <strong>{issue.title}</strong>
          {compact ? null : <span>{issue.explanation}</span>}
          <em>{issue.remedy}</em>
        </p>
      ))}
    </div>
  );
}

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
          : `${issues.length} problem${issues.length === 1 ? "" : "s"} stop${issues.length === 1 ? "s" : ""} this Template saving`}
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
        <button
          type="button"
          className="studio-text-button"
          aria-label="Previous problem"
          disabled={issues.length < 2}
          onClick={() => focus(index - 1)}
        >
          ‹ Prev
        </button>
        <button
          type="button"
          className="studio-text-button"
          aria-label="Next problem"
          disabled={issues.length < 2}
          onClick={() => focus(index + 1)}
        >
          Next ›
        </button>
      </span>
    </div>
  );
}
