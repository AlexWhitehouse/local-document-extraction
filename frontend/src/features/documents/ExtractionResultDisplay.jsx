import React, { useMemo } from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";

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
        ? "The document is processing"
        : "The document is queued";
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

  const structured = rows.filter(isStructuredResult);
  const scalar = rows.filter((result) => !isStructuredResult(result));
  return (
    <div className="studio-results" aria-busy={isLoading}>
      {isLoading && !rows.length ? (
        <p className="muted" role="status">
          Loading document results…
        </p>
      ) : null}
      {scalar.length ? (
        <ScrollArea
          className="table-scroll studio-results-scroll"
          role="region"
          aria-label="Extracted fields scroll area"
          tabIndex={0}
        >
          <table
            className="studio-table studio-results-table"
            aria-label="Extracted fields"
          >
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Extracted value</th>
                <th scope="col">Confidence</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {scalar.map((result) => (
                <tr key={result.field_id}>
                  <th scope="row">{result.name || result.field_id}</th>
                  <td className="studio-extracted-value">
                    {result.status === "not_found" ? (
                      <span className="studio-not-found">Not Found</span>
                    ) : null}
                    {renderAnswer(result.answer)}
                  </td>
                  <td>
                    <ResultConfidence value={result.confidence} />
                  </td>
                  <td className="studio-evidence">
                    {result.evidence ? formatAnswerValue(result.evidence) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      ) : null}
      {structured.map((result) => (
        <section className="studio-structured-result" key={result.field_id}>
          <div className="studio-section-heading">
            <div>
              <h2>{result.name || result.field_id}</h2>
              <p>Structured rows from the source document.</p>
            </div>
            <ResultConfidence value={result.confidence} />
          </div>
          {result.status === "not_found" ? (
            <span className="studio-not-found">Not Found</span>
          ) : null}
          {renderAnswer(result.answer)}
          {result.evidence ? (
            <p className="studio-evidence">
              {formatAnswerValue(result.evidence)}
            </p>
          ) : null}
        </section>
      ))}
      {!rows.length && !isLoading ? (
        <p className="muted">
          {job.status === "completed"
            ? "No result rows available yet."
            : "Results will appear here when extraction completes."}
        </p>
      ) : null}
    </div>
  );
}

function isStructuredResult(result) {
  return (
    result.data_type === "array<object>" ||
    isTableAnswer(result.answer) ||
    (Array.isArray(result.answer) &&
      result.answer.length > 0 &&
      result.answer.every(
        (item) => item && typeof item === "object" && !Array.isArray(item),
      ))
  );
}

function ResultConfidence({ value }) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return <span className="muted">—</span>;
  const percent = Math.min(100, Math.max(0, value * 100));
  return (
    <span
      className={`studio-confidence ${confidenceTone(value)}`}
      aria-label={`Confidence ${percent.toFixed(1)}%`}
    >
      <span className="studio-confidence-track" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </span>
      {percent.toFixed(1)}%
    </span>
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
        <ScrollArea
          className="table-scroll"
          role="region"
          aria-label="Structured result scroll area"
          tabIndex={0}
        >
          <table className="studio-table">
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
        </ScrollArea>
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
      <ScrollArea
        className="table-scroll"
        role="region"
        aria-label="Structured result scroll area"
        tabIndex={0}
      >
        <table className="studio-table">
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
      </ScrollArea>
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
