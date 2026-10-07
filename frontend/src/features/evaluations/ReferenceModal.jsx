import { isJsonObject } from "../../../../shared/json.ts";
import React, { useId, useRef, useState } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { getDataTypeLabel } from "../templates/templateFields.js";
import {
  normalizeReferenceDates,
  referenceProblem,
  scalarValue,
  tableAnswerRows,
  tableColumns,
  tableSchemaChanges,
} from "./evaluationScoring.js";
import { DateFormatSelect, DatePreview } from "./DateFormatSelect.jsx";
import { adaptReferenceDraft, draftValue } from "./referenceDraft.js";
import { display } from "./evaluationFormat.js";

function AnswerInput({ type, value, onChange, label, multiline = false, error, errorId, dateOrder }) {
  const validation = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? errorId : undefined };

  if (type === "boolean") {
    const normalized = scalarValue(value, "boolean");

    return (
      <>
        <select
          aria-label={label}
          {...validation}
          value={normalized.valid ? String(normalized.value) : ""}
          onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "true")}
        >
          <option value="">Choose Yes or No</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        {!normalized.valid && value !== "" && value != null && (
          <small className="evaluation-input-hint">Previous value: {display(value)}. Choose Yes or No.</small>
        )}
      </>
    );
  }

  if (multiline && type === "string")
    return (
      <textarea
        aria-label={label}
        {...validation}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );

  return (
    <>
      <input
        aria-label={label}
        {...validation}
        inputMode={type === "number" ? "decimal" : undefined}
        placeholder={type === "date" ? (dateOrder === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY") : undefined}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
      {type === "date" && <DatePreview value={value} dateOrder={dateOrder} />}
    </>
  );
}

export function ReferenceModal({
  row,
  initial,
  sourceField = row.field,
  previousField = row.field,
  schemas = [{ field: row.field, label: "Template" }],
  onSave,
  onSaveField,
  onRemoveVerification,
  onClose,
}) {
  const [schema, setSchema] = useState(0);
  const drafts = useRef(new Map());
  const field = schemas[schema].field;

  return (
    <ReferenceEditor
      key={schema}
      row={{ ...row, field }}
      initial={drafts.current.get(schema) || adaptReferenceDraft(initial, sourceField, field, true)}
      sourceField={sourceField}
      sourceRows={initial.rows}
      previousField={previousField}
      schemas={schemas}
      schema={schema}
      onSchemaChange={(index, draft) => {
        drafts.current.set(schema, draft);
        setSchema(index);
      }}
      onSave={(answer) => (onSaveField ? onSaveField(answer, field) : onSave(answer))}
      onRemoveVerification={
        initial.verified
          ? () => (onRemoveVerification ? onRemoveVerification() : onSave({ ...initial, verified: false }))
          : null
      }
      onClose={onClose}
    />
  );
}

function ReferenceEditor({
  row,
  initial,
  previousField,
  sourceField,
  sourceRows,
  schemas,
  schema,
  onSchemaChange,
  onSave,
  onRemoveVerification,
  onClose,
}) {
  const table = row.field.data_type === "array<object>";
  const columns = tableColumns(row.field);
  const changes = tableSchemaChanges(previousField, row.field);
  const sourceChanges = tableSchemaChanges(sourceField, row.field);
  const [columnMappings, setColumnMappings] = useState(initial.columnMappings || {});

  const [value, setValue] = useState(() =>
    table
      ? structuredClone(tableAnswerRows(initial.value) ?? [Object.fromEntries(columns.map((c) => [c.key, ""]))])
      : (Array.isArray(initial.value) || isJsonObject(initial.value)) && initial.value !== null
        ? JSON.stringify(initial.value, null, 2)
        : (initial.value ?? ""),
  );

  const [absent, setAbsent] = useState(initial.absent || false);
  const [exact, setExact] = useState(initial.exact || false);
  const [rows, setRows] = useState(initial.rows || { mode: "", key: "" });

  const [cellStates, setCellStates] = useState(() =>
    table ? structuredClone(initial.cellStates || (tableAnswerRows(initial.value) ?? [{}]).map(() => ({}))) : [],
  );

  const [dateOrder, setDateOrder] = useState(initial.dateOrder || "dmy");
  const [selected, setSelected] = useState(initial.selected || 0);
  const [error, setError] = useState(null);
  const errorId = useId();
  const clearError = () => setError(null);

  const changeCell = (key, answer) => {
    clearError();
    setValue((previous) => previous.map((record, i) => (i === selected ? { ...record, [key]: answer } : record)));
  };

  const changeStatus = (key, state) => {
    clearError();
    setCellStates((previous) =>
      previous.map((record, i) => {
        if (i !== selected) return record;
        const next = { ...record };

        if (state === "value") delete next[key];
        else next[key] = state;

        return next;
      }),
    );
  };

  const linkColumn = (column, previousKey) => {
    clearError();
    setColumnMappings({ ...columnMappings, [column.key]: previousKey });
    setValue((records) =>
      records.map((record) => ({
        ...record,
        [column.key]: previousKey ? draftValue(record[previousKey], column.data_type) : "",
      })),
    );
    setCellStates((records) =>
      records.map((record) => {
        const next = { ...record };

        if (previousKey && record[previousKey]) next[column.key] = record[previousKey];
        else delete next[column.key];

        return next;
      }),
    );

    if (rows.mode === "key" && !rows.key && sourceRows?.key === previousKey) setRows({ mode: "key", key: column.key });
  };

  const addRow = () => {
    clearError();
    setValue([...value, Object.fromEntries(columns.map((c) => [c.key, ""]))]);
    setCellStates([...cellStates, {}]);
    setSelected(value.length);
  };

  const removeRow = () => {
    clearError();
    setValue(value.filter((_, i) => i !== selected));
    setCellStates(cellStates.filter((_, i) => i !== selected));
    setSelected(Math.max(0, Math.min(selected, value.length - 2)));
  };

  const verify = () => {
    const draft = { verified: true, absent, exact, value, rows };

    if (table) draft.cellStates = cellStates;
    const projected = table ? { ...adaptReferenceDraft(draft, row.field, row.field), verified: true } : draft;
    const reference = normalizeReferenceDates(row.field, projected, dateOrder);
    const problem = referenceProblem(row.field, reference, dateOrder);

    if (problem) {
      setError(problem);

      if (problem.row !== undefined) setSelected(problem.row);
      requestAnimationFrame(() =>
        document
          .getElementById(errorId)
          ?.closest(".evaluation-reference")
          ?.querySelector('[aria-invalid="true"]')
          ?.focus(),
      );

      return;
    }

    onSave(reference);
  };

  const showError = (control, column) =>
    error &&
    error.control === control &&
    (!table || error.row === undefined || error.row === selected) &&
    (!column || error.column === column);

  const errorMessage = (
    <p id={errorId} role="alert" className="evaluation-validation-error">
      {error?.message}
    </p>
  );

  return (
    <ModalDialog
      className={`evaluation-reference ${table ? "object-schema-modal evaluation-table-reference" : ""}`}
      label="Verify expected answer"
      onClose={onClose}
    >
      <div className={table ? "object-schema-modal-head" : "evaluation-heading"}>
        <div>
          <h2>{row.field.name} · Expected answer</h2>
          <p>Review against the document before verifying. Only verified answers affect scores.</p>
        </div>
        <button type="button" className="modal-close" aria-label="Close expected answer editor" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="evaluation-reference-body">
        {schemas.length > 1 ? (
          <label>
            Expected answer Template
            <select
              aria-label="Expected answer Template"
              value={schema}
              onChange={(event) =>
                onSchemaChange(Number(event.target.value), {
                  value,
                  absent,
                  exact,
                  rows,
                  cellStates,
                  dateOrder,
                  selected,
                  columnMappings,
                })
              }
            >
              {schemas.map((option, index) => (
                <option key={index} value={index}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>Candidates use different fields. Choose the Template to verify against.</small>
          </label>
        ) : (
          <p className="evaluation-muted">Using {schemas[schema].label}</p>
        )}
        {previousField.data_type !== row.field.data_type && (
          <div className="evaluation-schema-notice" role="status">
            <strong>
              Field type changed: {getDataTypeLabel(previousField.data_type)} → {getDataTypeLabel(row.field.data_type)}
            </strong>
            <p>Review the existing answer using the new type before verifying.</p>
          </div>
        )}
        {table && changes.hasChanges && (
          <div className="evaluation-schema-notice" role="status">
            <strong>Template columns changed</strong>
            <p>Existing answers are carried forward where possible. Review the changes before verifying.</p>
            <ul>
              {changes.changed.map(([column, old]) => (
                <li key={column.key}>
                  {column.heading}: {getDataTypeLabel(old.data_type)} → {getDataTypeLabel(column.data_type)}
                </li>
              ))}
              {changes.added.map((column) => (
                <li key={column.key}>Added: {column.heading}. Enter a value, mark it absent, or ignore it.</li>
              ))}
              {changes.renamed.map(([column, old]) => (
                <li key={`name:${column.key}`}>
                  Renamed: {old.heading} → {column.heading}. Existing answers are kept.
                </li>
              ))}
              {changes.reordered && <li>Column order changed. Existing answers stay with their columns.</li>}
              {changes.removed.map((column) => (
                <li key={column.key}>Removed: {column.heading}. It will be left out of this expected table.</li>
              ))}
            </ul>
            {initial.rows?.mode === "key" && !initial.rows.key && (
              <p>The row identifier was removed. Choose how to compare rows below.</p>
            )}
          </div>
        )}
        <div className="evaluation-reference-options">
          <label>
            <input
              type="checkbox"
              checked={absent}
              onChange={(event) => {
                clearError();
                setAbsent(event.target.checked);
              }}
            />
            Not present in document
          </label>
          {!absent && ["string", "array<object>"].includes(row.field.data_type) && (
            <label>
              <input
                type="checkbox"
                checked={exact}
                onChange={(event) => {
                  clearError();
                  setExact(event.target.checked);
                }}
              />
              Exact text match
            </label>
          )}
        </div>
        {!absent && (row.field.data_type === "date" || (table && columns.some((c) => c.data_type === "date"))) && (
          <DateFormatSelect
            value={dateOrder}
            onChange={(order) => {
              clearError();
              setDateOrder(order);
            }}
          />
        )}
        {!absent &&
          (table ? (
            <>
              <div className="evaluation-record-toolbar">
                <div>
                  <strong>Expected rows</strong>
                  <p>
                    {value.length} {value.length === 1 ? "row" : "rows"} · {columns.length} schema columns
                  </p>
                </div>
                <div className="actions compact">
                  <button type="button" className="secondary" disabled={!value.length} onClick={removeRow}>
                    Remove row {value.length ? selected + 1 : ""}
                  </button>
                  <button type="button" onClick={addRow}>
                    Add row
                  </button>
                </div>
              </div>
              <div className="evaluation-record-editor">
                <ScrollArea className="evaluation-record-list" role="navigation" aria-label="Expected rows">
                  {value.map((_, i) => (
                    <button
                      type="button"
                      className="secondary"
                      key={i}
                      aria-label={`Select row ${i + 1}`}
                      aria-pressed={selected === i}
                      onClick={() => {
                        clearError();
                        setSelected(i);
                      }}
                    >
                      Row {i + 1}
                    </button>
                  ))}
                </ScrollArea>
                <ScrollArea
                  className="object-schema-table-wrap"
                  role="region"
                  aria-label="Expected row columns"
                  tabIndex={0}
                >
                  <table
                    className="object-schema-table evaluation-schema-values"
                    aria-label="Expected row schema values"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Column name</th>
                        <th scope="col">Type</th>
                        <th scope="col">Expected value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!value.length ? (
                        <tr>
                          <td colSpan={4} className="object-schema-empty">
                            No expected rows. Add a row to enter values using this Template’s schema.
                          </td>
                        </tr>
                      ) : (
                        columns.map((column, i) => (
                          <tr key={column.key}>
                            <td>
                              <span className="object-schema-row-number">{String(i + 1).padStart(2, "0")}</span>
                            </td>
                            <td>
                              <strong>{column.heading}</strong>
                              {column.description && <p>{column.description}</p>}
                              {sourceChanges.added.some((added) => added.key === column.key) &&
                                sourceChanges.removed.length > 0 && (
                                  <label className="evaluation-link-field">
                                    Renamed column? Reuse previous answers
                                    <select
                                      aria-label={`Use previous column for ${column.heading}`}
                                      value={columnMappings[column.key] || ""}
                                      onChange={(event) => linkColumn(column, event.target.value)}
                                    >
                                      <option value="">New column · enter answers</option>
                                      {sourceChanges.removed
                                        .filter(
                                          (old) =>
                                            !Object.entries(columnMappings).some(
                                              ([key, value]) => key !== column.key && value === old.key,
                                            ),
                                        )
                                        .map((old) => (
                                          <option key={old.key} value={old.key}>
                                            {old.heading} · {getDataTypeLabel(old.data_type)}
                                          </option>
                                        ))}
                                    </select>
                                  </label>
                                )}
                            </td>
                            <td>{getDataTypeLabel(column.data_type)}</td>
                            <td>
                              <div className="evaluation-cell-editor">
                                <select
                                  aria-label={`Expected row ${selected + 1} ${column.heading} status`}
                                  value={cellStates[selected]?.[column.key] || "value"}
                                  aria-invalid={showError("status", column.key) ? true : undefined}
                                  aria-describedby={showError("status", column.key) ? errorId : undefined}
                                  onChange={(event) => changeStatus(column.key, event.target.value)}
                                >
                                  <option value="value">Expected value</option>
                                  <option value="absent">Not present in document</option>
                                  <option value="ignored">Ignore for scoring</option>
                                </select>
                                {!cellStates[selected]?.[column.key] ? (
                                  <AnswerInput
                                    type={column.data_type}
                                    label={`Expected row ${selected + 1} ${column.heading}`}
                                    value={value[selected]?.[column.key]}
                                    onChange={(answer) => changeCell(column.key, answer)}
                                    dateOrder={dateOrder}
                                    error={showError("value", column.key)}
                                    errorId={errorId}
                                  />
                                ) : (
                                  <small className="evaluation-input-hint">
                                    {cellStates[selected][column.key] === "absent"
                                      ? "Expects an empty cell in the extracted row."
                                      : "This cell is excluded from accuracy scores."}
                                  </small>
                                )}
                                {error?.row === selected && error.column === column.key && errorMessage}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ScrollArea>
              </div>
            </>
          ) : (
            <div className="evaluation-scalar-editor">
              <label>
                Expected value
                <AnswerInput
                  type={row.field.data_type}
                  label="Expected value"
                  value={value}
                  onChange={(answer) => {
                    clearError();
                    setValue(answer);
                  }}
                  multiline
                  dateOrder={dateOrder}
                  error={showError("value")}
                  errorId={errorId}
                />
              </label>
              {error && errorMessage}
            </div>
          ))}
      </div>
      <div className={table ? "object-schema-modal-footer evaluation-reference-footer" : "evaluation-reference-footer"}>
        {table && !absent && (
          <label>
            Compare rows
            <select
              aria-label="Compare rows"
              aria-invalid={showError("rows") ? true : undefined}
              aria-describedby={showError("rows") ? errorId : undefined}
              value={rows.mode === "key" ? rows.key : rows.mode}
              onChange={(event) => {
                clearError();
                setRows(
                  event.target.value === "position" ? { mode: "position" } : { mode: "key", key: event.target.value },
                );
              }}
            >
              <option value="">Choose row matching (required)</option>
              <option value="position">By row position</option>
              {columns.map((c) => (
                <option value={c.key} key={c.key}>
                  By {c.heading}
                </option>
              ))}
            </select>
            <small>Match by a unique column, or compare rows in their listed order.</small>
          </label>
        )}
        {table && error && !error.column && errorMessage}
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          {onRemoveVerification && (
            <button type="button" className="secondary" onClick={onRemoveVerification}>
              Remove verification
            </button>
          )}
          <button type="button" onClick={verify}>
            Use as expected answer
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
