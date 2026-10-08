import React, { useEffect, useId, useRef, useState } from "react";
import { candidateBusy } from "./useEvaluations.js";
import { normalizeReferenceDates, scalarValue, validateReference } from "./evaluationScoring.js";
import { DateFormatSelect, DatePreview } from "./DateFormatSelect.jsx";
import { display, dollars, seconds } from "./evaluationFormat.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Badge, StatusDot } from "../ui/Status.jsx";
import { Field } from "../ui/Field.jsx";
import { Popover } from "../ui/Popover.jsx";
import { CheckIcon, CloseIcon, ExternalIcon, MoreIcon } from "../layout/Icons.jsx";

const SCALAR_TYPES = ["string", "number", "date", "boolean"];

const STATUS = {
  idle: "Not run",
  submitting: "Submitting",
  queued: "Queued",
  running: "Running",
  retrying: "Retrying",
  success: "Completed",
  failure: "Failed",
  interrupted: "Interrupted",
};

export function StatusLine({ candidate }) {
  const edited = candidate.result && candidate.revision !== candidate.result.revision;

  const busy = candidateBusy(candidate);

  const tone = busy
    ? "info"
    : edited
      ? "warning"
      : candidate.status === "success"
        ? "success"
        : ["failure", "interrupted"].includes(candidate.status)
          ? "danger"
          : "neutral";

  const label = busy
    ? `${STATUS[candidate.status]}${candidate.attempt > 1 ? ` · ${candidate.attempt} of 3` : ""}`
    : edited
      ? "Edited · run again"
      : STATUS[candidate.status] || candidate.status;

  return (
    <Badge tone={tone} busy={busy} className="evaluation-status" title={candidate.message || undefined}>
      {label}
      {candidate.status === "success" && !edited && candidate.result
        ? ` · ${seconds(candidate.result.processingMs)}`
        : ""}
    </Badge>
  );
}

const MARKS = {
  Match: { tone: "success", icon: CheckIcon },
  Mismatch: { tone: "danger", icon: CloseIcon },
  "Needs review": { tone: "warning" },
};

// The score of one field: an icon badge whose meaning is in its shape and its
// screen-reader text, so the matrix stays dense. Review needs action, so it is spelled out.
export function Mark({ state }) {
  const mark = MARKS[state];

  if (!mark) return <StatusDot tone="neutral" label="Unscored" srOnlyLabel />;

  const Icon = mark.icon;

  return (
    <Badge tone={mark.tone} className="evaluation-mark" title={state}>
      {Icon ? (
        <>
          <Icon size={10} />
          <span className="sr-only">{state}</span>
        </>
      ) : (
        "Review"
      )}
    </Badge>
  );
}

export function RunCost({ result }) {
  if (!result) return null;
  const label = result.cost ? dollars(result.cost) : "Cost not reported";

  return (
    <span
      className={`evaluation-cost${result.cost?.amount == null ? " evaluation-muted" : ""}`}
      title={
        result.cost?.amount == null
          ? "Cost not reported for this run."
          : `${dollars(result.cost, { full: true })} for the successful run${result.cost.complete ? "" : " · part of the cost not reported"}`
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
        <dt>Tested template</dt>
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
          {result.pdf ? "Direct PDF input" : "Rendered pages"} · Structured output {result.structured ? "on" : "off"}
        </dd>
      </div>
      <div>
        <dt>Queue time</dt>
        <dd>{seconds(result.queueMs)}</dd>
      </div>
      <div>
        <dt>Processing</dt>
        <dd>
          {seconds(result.processingMs)}
        </dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>
          {result.cost ? dollars(result.cost, { full: true }) : "Cost not reported"}
        </dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>
          {result.usage
            ? `${result.usage.input_tokens ?? "Not reported"} input · ${result.usage.output_tokens ?? "Not reported"} output`
            : "Not reported"}
        </dd>
      </div>
    </dl>
  );
}

// Rarely used candidate controls live in a popover so the column head stays compact.
export function CandidateMenu({ label, candidate, inputs, onInputChange, actions }) {
  const [open, setOpen] = useState(false);
  const hintId = useId();

  return (
    <Popover
      className="evaluation-menu"
      panelClassName="evaluation-menu-panel"
      label={`${label} options`}
      open={open}
      onClose={() => setOpen(false)}
      trigger={(triggerProps) => (
        <IconButton
          size="sm"
          label={`${label} options`}
          icon={MoreIcon}
          onClick={() => setOpen(!open)}
          {...triggerProps}
        />
      )}
    >
      <div role="group" aria-label={`${label} options`}>
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
          {actions.flatMap((action, index) =>
            action
              ? [
                  <Button
                    key={action.label}
                    variant={action.danger ? "danger-text" : "text"}
                    disabled={action.disabled}
                    aria-describedby={action.hint ? `${hintId}-${index}` : undefined}
                    onClick={() => {
                      setOpen(false);
                      action.onClick();
                    }}
                  >
                    {action.label}
                  </Button>,
                  // Says why an action is unavailable, next to it.
                  action.hint && (
                    <small key={`${action.label}-hint`} id={`${hintId}-${index}`} className="evaluation-menu-hint">
                      {action.hint}
                    </small>
                  ),
                ]
              : [],
          )}
        </div>
      </div>
    </Popover>
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
  const input = useRef(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (!SCALAR_TYPES.includes(field.data_type)) {
    if (field.data_type !== "array<object>") return <span className="evaluation-muted">Not automatically scored</span>;

    return (
      <button
        type="button"
        className={`evaluation-expected-button ${verified ? "verified" : "unverified"}`}
        onClick={onOpenEditor}
      >
        {verified ? <CheckIcon size={12} /> : null}
        <span>
          {verified
            ? reference.absent
              ? "Not in document"
              : `${reference.value.length} ${reference.value.length === 1 ? "row" : "rows"} verified`
            : "Add expected rows"}
        </span>
        <em aria-hidden="true">
          <ExternalIcon size={12} />
        </em>
      </button>
    );
  }

  if (!editing)
    return (
      <button
        type="button"
        className={`evaluation-expected-button ${verified ? "verified" : "unverified"}`}
        aria-label={verified ? `Edit expected ${field.name}` : `Add expected ${field.name}`}
        onClick={() => {
          setDraft(initial());
          setError("");
          setEditing(true);
        }}
      >
        {verified ? <CheckIcon size={12} /> : null}
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
        <Field label={`Expected ${field.name}`} labelHidden error={error || undefined}>
          <select
            ref={input}
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
        </Field>
      ) : (
        <Field label={`Expected ${field.name}`} labelHidden error={error || undefined}>
          <input
            ref={input}
            inputMode={field.data_type === "number" ? "decimal" : undefined}
            placeholder={field.data_type === "date" ? (dateOrder === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY") : undefined}
            value={draft ?? ""}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
          />
        </Field>
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
      <div className="evaluation-expected-actions">
        <Button variant="text" type="submit">
          Verify
        </Button>
        <Button variant="text"
          onClick={() => {
            onSave({ verified: true, absent: true, exact: false, value: "" });
            setEditing(false);
          }}
        >
          Not in document
        </Button>
        <Button variant="text"
          onClick={() => {
            setEditing(false);
            onOpenEditor();
          }}
        >
          More options
        </Button>
        {verified && (
          <Button variant="danger-text"
            onClick={() => {
              onSave({ ...reference, verified: false });
              setEditing(false);
            }}
          >
            Unverify
          </Button>
        )}
      </div>
    </form>
  );
}
