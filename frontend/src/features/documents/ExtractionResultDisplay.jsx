import { isJsonObject, isString } from "../../../../shared/json.ts";
import React from "react";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { DataTable } from "../ui/DataTable.jsx";

const LIVE_DOCUMENT_STATUSES = new Set(["queued", "processing"]);

const MAX_FAILURE_REASON_LENGTH = 300;

export function ExtractionJobStatusDisplay({ job }) {
  const isFailure = job.status === "failed";
  const isProcessing = LIVE_DOCUMENT_STATUSES.has(job.status);
  const isHeld = job.status === "awaiting_template";
  const failureReason = isFailure ? displayableFailureReason(job.error_message) : "";

  const statusLabel = isHeld
    ? "Template selection needs your attention."
    : job.routing_status === "assessing"
      ? "Choosing a template from the document"
      : isFailure
        ? "Extraction failed"
        : isProcessing
          ? "The document is processing"
          : "The document is queued";

  const isTerminal = isFailure || isHeld;
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
          {failureReason ? <p>{failureReason}</p> : null}
          {isFailure ? <p>Try again, choose another template, or check the Model gateway on the Workspace page.</p> : null}
          <p className="hint">{attemptLabel}</p>
        </div>
      </div>
    </div>
  );
}

// Only plain, short reasons are shown. HTML from a proxy or a stack trace is hidden.
function displayableFailureReason(message) {
  if (!isString(message)) return "";

  const reason = message.trim();

  if (!reason || reason.includes("<") || reason.includes("\n") || reason.length > MAX_FAILURE_REASON_LENGTH) return "";

  return reason;
}

export function ExtractionResultDisplay({ job, isLoading = false }) {
  // Array.prototype.sort is stable, so this only moves object-array fields last.
  const rows = Array.isArray(job.results)
    ? [...job.results].sort(
        (left, right) => (left?.data_type === "array<object>") - (right?.data_type === "array<object>"),
      )
    : [];

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
          <DataTable label="Extracted fields" className="studio-results-table">
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
                    {result.status === "not_found" ? <span className="studio-not-found">Not found</span> : null}
                    {renderAnswer(result.answer)}
                  </td>
                  <td>
                    <ResultConfidence value={result.confidence} />
                  </td>
                  <td className="studio-evidence">{result.evidence ? formatAnswerValue(result.evidence) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
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
          {result.status === "not_found" ? <span className="studio-not-found">Not found</span> : null}
          {renderAnswer(result.answer)}
          {result.evidence ? <p className="studio-evidence">{formatAnswerValue(result.evidence)}</p> : null}
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
    (Array.isArray(result.answer) && result.answer.length > 0 && result.answer.every(isPlainObject))
  );
}

function isPlainObject(value) {
  return isJsonObject(value);
}

function ResultConfidence({ value }) {
  if (!Number.isFinite(value)) return <span className="muted">—</span>;
  const percent = Math.min(100, Math.max(0, value * 100));

  return (
    <span className={`studio-confidence ui-tone-${confidenceTone(value)}`} aria-label={`Confidence ${percent.toFixed(1)}%`}>
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

    if (answer.every(isPlainObject)) {
      const keys = [...new Set(answer.flatMap((row) => Object.keys(row)))];

      return <StructuredTable columns={keys.map((key) => ({ key, heading: key }))} rows={answer} />;
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
    const columns = answer.columns.map((column, index) =>
      isString(column)
        ? { key: column, heading: column }
        : {
            key: column.key || String(index),
            heading: column.heading || column.key || `Column ${index + 1}`,
          },
    );

    return <StructuredTable columns={columns} rows={answer.rows} />;
  }

  if (Array.isArray(answer) || isJsonObject(answer)) {
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

function StructuredTable({ columns, rows }) {
  return (
    <ScrollArea className="table-scroll" role="region" aria-label="Structured result scroll area" tabIndex={0}>
      <DataTable>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {columns.map((column) => (
                <td key={`${column.key}-${rowIndex}`}>{formatAnswerValue(row?.[column.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </DataTable>
    </ScrollArea>
  );
}

function formatAnswerValue(value) {
  if (value === null || value === undefined) {
    return "—";
  }

  if (Array.isArray(value) || isJsonObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function isTableAnswer(value) {
  return (
    Boolean(value) &&
    (Array.isArray(value) || isJsonObject(value)) &&
    Array.isArray(value.columns) &&
    Array.isArray(value.rows)
  );
}

// Confidence bands on the shared tone vocabulary: above 90% success, 80 to 90% warning, below 80% danger.
function confidenceTone(confidence) {
  const percent = confidence * 100;

  return percent > 90 ? "success" : percent >= 80 ? "warning" : "danger";
}
