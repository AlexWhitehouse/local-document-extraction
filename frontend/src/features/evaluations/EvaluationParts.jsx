import { pluralize } from "../../lib/text.js";
import React, { useEffect, useId, useRef, useState } from "react";
import { candidateBusy } from "./useEvaluations.js";
import { normalizeReferenceDates, scalarValue, validateReference } from "./evaluationScoring.js";
import { DateFormatSelect, DatePreview } from "./DateFormatSelect.jsx";
import { display, dollars, seconds } from "./evaluationFormat.js";

const SCALAR_TYPES = ["string", "number", "date", "boolean"];

const STATUS = {
  idle: "Not run",
  submitting: "Submitting",
  queued: "Queued",
  running: "Running",
  retrying: "Retrying",
  success: "Done",
  failure: "Failed",
  interrupted: "Interrupted",
};

export function StatusLine({ candidate }) {
  const edited = candidate.result && candidate.revision !== candidate.result.revision;

  const tone = candidateBusy(candidate)
    ? "busy"
    : edited
      ? "warn"
      : candidate.status === "success"
        ? "good"
        : ["failure", "interrupted"].includes(candidate.status)
          ? "bad"
          : "idle";

  const label = candidateBusy(candidate)
    ? `${STATUS[candidate.status]}${candidate.attempt > 1 ? ` · attempt ${candidate.attempt}/3` : ""}`
    : edited
      ? "Edited · needs rerun"
      : STATUS[candidate.status] || candidate.status;

  return (
    <span
      role="status"
      className={`evaluation-status evaluation-status-${tone}`}
      title={candidate.message || undefined}
    >
      <i aria-hidden="true" />
      {label}
      {candidate.status === "success" && !edited && candidate.result
        ? ` · ${seconds(candidate.result.processingMs)}`
        : ""}
    </span>
  );
}

const MARKS = { Match: ["match", "✓"], Mismatch: ["mismatch", "✕"], "Needs review": ["review", "!"] };

export function Mark({ state }) {
  const [tone, glyph] = MARKS[state] || ["none", "·"];

  return (
    <span
      className={`evaluation-mark evaluation-mark-${tone}`}
      title={state || "Unscored"}
      aria-label={state || "Unscored"}
    >
      {glyph}
    </span>
  );
}

export function RunCost({ result }) {
  if (!result) return null;
  const label = result.cost ? dollars(result.cost) : "Unavailable";

  return (
    <span
      className={`evaluation-cost${result.cost?.amount == null ? " evaluation-muted" : ""}`}
      title={
        result.cost?.amount == null
          ? "The model endpoint did not report a cost for this run."
          : `${dollars(result.cost, { full: true })} for the successful attempt${result.cost.complete ? "" : " · some calls did not report cost"}`
      }
      aria-label={`Run cost: ${label}`}
    >
      {label}
    </span>
  );
}

export function Meter({ value, best }) {
  return (
    <span className={`evaluation-meter ${best ? "best" : ""}`} aria-hidden="true">
      <i style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </span>
  );
}

function RunDetails({ candidate }) {
  const result = candidate.result;

  if (!result) return <p className="evaluation-muted">Run this candidate to see timings and token use.</p>;

  return (
    <dl className="evaluation-details">
      <div>
        <dt>Tested Template</dt>
        <dd>
          {result.templateName}
          {result.source?.modified ? " · edited fields" : ""}
        </dd>
      </div>
      <div>
        <dt>Tested model</dt>
        <dd>{result.model}</dd>
      </div>
      <div>
        <dt>Input</dt>
        <dd>
          PDF {result.pdf ? "direct" : "rendered"} · Structured {result.structured ? "on" : "off"}
        </dd>
      </div>
      <div>
        <dt>Queue</dt>
        <dd>{seconds(result.queueMs)}</dd>
      </div>
      <div>
        <dt>Processing</dt>
        <dd>
          {seconds(result.processingMs)} · {pluralize(result.attempts, "attempt")}
        </dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>
          {result.cost ? `${dollars(result.cost, { full: true })} · successful attempt only` : "Unavailable"}
        </dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>
          {result.usage
            ? `${result.usage.input_tokens ?? "Unavailable"} input · ${result.usage.output_tokens ?? "Unavailable"} output · successful attempt only`
            : "Unavailable"}
        </dd>
      </div>
      {candidate.cleanup !== "complete" && (
        <div>
          <dt>Cleanup</dt>
          <dd>{candidate.cleanup === "pending" ? "Pending" : "Unconfirmed"}</dd>
        </div>
      )}
    </dl>
  );
}

// Rarely used candidate controls live in a popover so the column head stays compact.
export function CandidateMenu({ label, candidate, inputs, onInputChange, actions }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;

    const close = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };

    const key = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);

    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="evaluation-menu" ref={root}>
      <button
        type="button"
        className="icon-action-button"
        aria-label={`${label} options`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="evaluation-menu-panel" role="group" aria-label={`${label} options`}>
          <p className="evaluation-menu-title">Input{inputs.shared ? " · all candidates" : ""}</p>
          <label>
            <input
              type="checkbox"
              checked={candidate.pdf}
              onChange={(event) => onInputChange("pdf", event.target.checked)}
            />
            Direct PDF input
          </label>
          <label>
            <input
              type="checkbox"
              checked={candidate.structured}
              onChange={(event) => onInputChange("structured", event.target.checked)}
            />
            Structured output
          </label>
          <p className="evaluation-menu-title">Run details</p>
          <RunDetails candidate={candidate} />
          <div className="evaluation-menu-actions">
            {actions.flatMap((action) =>
              action
                ? [
                    <button
                      key={action.label}
                      type="button"
                      className={`studio-text-button ${action.danger ? "evaluation-danger-text" : ""}`}
                      disabled={action.disabled}
                      onClick={() => {
                        setOpen(false);
                        action.onClick();
                      }}
                    >
                      {action.label}
                    </button>,
                  ]
                : [],
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Inline expected answer for scalar fields. Tables and other types open the full editor.
export function ExpectedInline({ field, reference, onSave, onOpenEditor }) {
  const verified = reference?.verified;
  const initial = () => (verified && !reference.absent ? reference.value : "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [dateOrder, setDateOrder] = useState("dmy");
  const errorId = useId();
  const input = useRef(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (!SCALAR_TYPES.includes(field.data_type)) {
    if (field.data_type !== "array<object>") return <span className="evaluation-muted">Not automatically scored</span>;

    return (
      <button
        type="button"
        className={`evaluation-expected-button ${verified ? "verified" : ""}`}
        onClick={onOpenEditor}
      >
        <span>
          {verified
            ? reference.absent
              ? "Not in document"
              : `${reference.value.length} ${reference.value.length === 1 ? "row" : "rows"} verified`
            : "Add expected rows"}
        </span>
        <em aria-hidden="true">↗</em>
      </button>
    );
  }

  if (!editing)
    return (
      <button
        type="button"
        className={`evaluation-expected-button ${verified ? "verified" : ""}`}
        aria-label={verified ? `Edit expected ${field.name}` : `Add expected ${field.name}`}
        onClick={() => {
          setDraft(initial());
          setError("");
          setEditing(true);
        }}
      >
        <span className={verified ? "" : "evaluation-muted"}>
          {verified
            ? reference.absent
              ? "Not in document"
              : display(
                  field.data_type === "boolean" && scalarValue(reference.value, "boolean").valid
                    ? scalarValue(reference.value, "boolean").value
                    : reference.value,
                )
            : "Add expected answer"}
        </span>
      </button>
    );

  const save = (value) => {
    const next = normalizeReferenceDates(
      field,
      { verified: true, absent: false, exact: reference?.exact || false, rows: reference?.rows, value },
      dateOrder,
    );

    const problem = validateReference(field, next, dateOrder);

    if (problem) {
      setError(problem);
      input.current?.focus();

      return;
    }

    onSave(next);
    setEditing(false);
  };

  const commit = () => {
    if (field.data_type === "boolean" ? draft === "" : !String(draft).trim()) {
      setEditing(false);

      return;
    }

    save(field.data_type === "boolean" ? draft : String(draft).trim());
  };

  return (
    <form
      className="evaluation-expected-edit"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setEditing(false);
        }
      }}
    >
      {field.data_type === "boolean" ? (
        <select
          ref={input}
          aria-label={`Expected ${field.name}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={draft === "" ? "" : String(draft)}
          onChange={(event) => {
            setDraft(event.target.value === "" ? "" : event.target.value === "true");
            setError("");
          }}
        >
          <option value="">Choose Yes or No</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : (
        <input
          ref={input}
          aria-label={`Expected ${field.name}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          inputMode={field.data_type === "number" ? "decimal" : undefined}
          placeholder={
            field.data_type === "date" ? (dateOrder === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY") : "Expected value"
          }
          value={draft ?? ""}
          onChange={(event) => {
            setDraft(event.target.value);
            setError("");
          }}
        />
      )}
      {field.data_type === "date" && (
        <>
          <DateFormatSelect
            value={dateOrder}
            onChange={(order) => {
              setDateOrder(order);
              setError("");
            }}
          />
          <DatePreview value={draft} dateOrder={dateOrder} />
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className="evaluation-validation-error">
          {error}
        </p>
      )}
      <div className="evaluation-expected-actions">
        <button type="submit" className="studio-text-button">
          Verify
        </button>
        <button
          type="button"
          className="studio-text-button"
          onClick={() => {
            onSave({ verified: true, absent: true, exact: false, value: "" });
            setEditing(false);
          }}
        >
          Not in document
        </button>
        <button
          type="button"
          className="studio-text-button"
          onClick={() => {
            setEditing(false);
            onOpenEditor();
          }}
        >
          More options
        </button>
        {verified && (
          <button
            type="button"
            className="studio-text-button evaluation-danger-text"
            onClick={() => {
              onSave({ ...reference, verified: false });
              setEditing(false);
            }}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
