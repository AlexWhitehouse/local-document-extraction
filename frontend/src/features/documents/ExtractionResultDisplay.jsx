import React, { useMemo } from "react";

const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);

export function ExtractionJobStatusDisplay({ job }) {
  if (!job) {
    return <p className="muted">Select an uploaded document.</p>;
  }

  const isFailure = job.status === "failed";
  const isCompleted = job.status === "completed";
  const isProcessing = LIVE_DOCUMENT_STATUSES.has(job.status);
  const statusLabel = isFailure
    ? "This extraction finished with a failure status."
    : isCompleted
      ? "This extraction completed successfully."
      : isProcessing
        ? "The job is processing"
        : "The job is queued";
  const isTerminal = isCompleted || isFailure;
  const currentAttempt = Number(job.current_attempt || 0);
  const completedAttempt = Number(job.completed_attempt || 0);
  const lastFailedAttempt = Number(job.last_failed_attempt || 0);
  const attemptLabel =
    currentAttempt > 0
      ? `Current attempt: ${currentAttempt}`
      : completedAttempt > 0
        ? `Completed on attempt: ${completedAttempt}`
        : lastFailedAttempt > 0
          ? `Last failed attempt: ${lastFailedAttempt}`
          : "Attempt: pending";

  return (
    <div className="job-status-stack">
      <div
        className={`job-status-skeleton ${
          isTerminal ? "is-terminal" : "is-processing"
        } ${isFailure ? "is-failed" : ""}`}
      >
        <span className="job-status-spinner" aria-hidden="true" />
        <div>
          <p>{statusLabel}</p>
          <p className="hint">{attemptLabel}</p>
        </div>
      </div>
    </div>
  );
}

export function ExtractionResultDisplay({ job, isLoading = false }) {
  const rows = useMemo(() => {
    if (!Array.isArray(job.results)) {
      return [];
    }

    const withIndex = job.results.map((result, index) => ({ result, index }));
    withIndex.sort((left, right) => {
      const leftArrayObject =
        left.result?.data_type === "array<object>" ? 1 : 0;
      const rightArrayObject =
        right.result?.data_type === "array<object>" ? 1 : 0;
      if (leftArrayObject !== rightArrayObject) {
        return leftArrayObject - rightArrayObject;
      }
      return left.index - right.index;
    });

    return withIndex.map((entry) => entry.result);
  }, [job.results]);

  return (
    <div className="result-stack">
      {job.status !== "completed" ? (
        <p className="muted">This job is not completed yet. Poll again shortly.</p>
      ) : null}

      {rows.length ? (
        <div className="result-cards">
          {rows.map((result) => (
            <article
              key={result.field_id}
              className={
                result.data_type === "array<object>"
                  ? "result-card result-card-wide"
                  : "result-card"
              }
            >
              <header>
                <h3>{result.name}</h3>
                <div className="result-card-badges">
                  <span className={`status-pill ${statusTone(result.status)}`}>
                    {result.status}
                  </span>
                  {typeof result.confidence === "number" ? (
                    <span
                      className={`status-pill ${confidenceTone(result.confidence)}`}
                    >
                      Confidence {(result.confidence * 100).toFixed(1)}%
                    </span>
                  ) : null}
                </div>
              </header>
              <div className="result-card-answer">
                {renderAnswer(result.answer)}
              </div>
              {result.evidence ? (
                <div className="result-card-foot">
                  {result.evidence ? (
                    <p className="hint">Evidence: {result.evidence}</p>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : isLoading ? null : (
        <p className="muted">No result rows available yet.</p>
      )}
    </div>
  );
}

function renderAnswer(answer) {
  if (answer === null || answer === undefined) {
    return <p className="muted">No value extracted.</p>;
  }

  if (Array.isArray(answer)) {
    if (!answer.length) {
      return <p className="muted">No rows returned.</p>;
    }

    const allObjects = answer.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    );

    if (allObjects) {
      const keys = Array.from(
        new Set(answer.flatMap((row) => Object.keys(row))),
      );

      return (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {answer.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {keys.map((key) => (
                    <td key={`${key}-${rowIndex}`}>
                      {formatAnswerValue(row?.[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="kv-list">
        {answer.map((value, index) => (
          <div className="kv-row" key={index}>
            <span className="kv-key">{index}</span>
            <span className="kv-value">{formatAnswerValue(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  if (isTableAnswer(answer)) {
    const columns = answer.columns.map((column, index) => {
      if (typeof column === "string") {
        return { key: column, heading: column, index };
      }
      return {
        key: column.key || String(index),
        heading: column.heading || column.key || `Column ${index + 1}`,
        index,
      };
    });

    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {answer.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {columns.map((column) => (
                  <td key={`${column.key}-${rowIndex}`}>
                    {formatAnswerValue(row?.[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (typeof answer === "object") {
    const entries = Object.entries(answer);
    if (!entries.length) {
      return <p className="muted">No values returned.</p>;
    }

    return (
      <div className="kv-list">
        {entries.map(([key, value]) => (
          <div className="kv-row" key={key}>
            <span className="kv-key">{key}</span>
            <span className="kv-value">{formatAnswerValue(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <p className="answer-text">{String(answer)}</p>;
}

function formatAnswerValue(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function isTableAnswer(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray(value.columns) &&
    Array.isArray(value.rows)
  );
}

function confidenceTone(confidence) {
  const percent = confidence * 100;
  if (percent > 90) {
    return "good";
  }
  if (percent >= 80) {
    return "pending";
  }
  return "bad";
}

function statusTone(status) {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  return "pending";
}
