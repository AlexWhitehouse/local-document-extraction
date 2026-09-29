import React, { useState } from "react";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { getDataTypeLabel } from "../templates/templateFields.js";
import { scalarValue, tableAnswerRows, tableColumns, validateReference } from "./evaluationScoring.js";

function AnswerInput({ type, value, onChange, label, multiline = false }) {
  if (type === "boolean") {
    const normalized = scalarValue(value, "boolean");
    return <select aria-label={label} value={normalized.valid ? String(normalized.value) : ""} onChange={event => onChange(event.target.value === "" ? "" : event.target.value === "true")}>
      <option value="">Choose Yes or No</option><option value="true">Yes</option><option value="false">No</option>
    </select>;
  }
  if (multiline) return <textarea aria-label={label} value={value ?? ""} onChange={event => onChange(event.target.value)} />;
  return <input aria-label={label} inputMode={type === "number" ? "decimal" : undefined} placeholder={type === "date" ? "YYYY-MM-DD" : undefined} value={value ?? ""} onChange={event => onChange(event.target.value)} />;
}

export function ReferenceModal({ row, initial, onSave, onClose }) {
  const table = row.field.data_type === "array<object>";
  const columns = tableColumns(row.field);
  const [value, setValue] = useState(() => table ? structuredClone(tableAnswerRows(initial.value) ?? [Object.fromEntries(columns.map(c => [c.key, ""]))]) : typeof initial.value === "object" && initial.value !== null ? JSON.stringify(initial.value, null, 2) : initial.value ?? "");
  const [absent, setAbsent] = useState(initial.absent || false);
  const [exact, setExact] = useState(initial.exact || false);
  const [rows, setRows] = useState(initial.rows || { mode: "", key: "" });
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const changeCell = (key, answer) => setValue(previous => previous.map((record, i) => i === selected ? { ...record, [key]: answer } : record));
  const addRow = () => {
    setValue([...value, Object.fromEntries(columns.map(c => [c.key, ""]))]);
    setSelected(value.length);
  };
  const removeRow = () => {
    setValue(value.filter((_, i) => i !== selected));
    setSelected(Math.max(0, Math.min(selected, value.length - 2)));
  };
  const verify = () => {
    const reference = { verified: true, absent, exact, value, rows };
    const problem = validateReference(row.field, reference);
    if (problem) { setError(problem); return; }
    onSave(reference);
  };
  return <ModalDialog className={`evaluation-reference ${table ? "object-schema-modal evaluation-table-reference" : ""}`} label="Verify expected answer" onClose={onClose}>
    <div className={table ? "object-schema-modal-head" : "evaluation-heading"}>
      <div><h2>{row.field.name} · Expected answer</h2><p>Review against the document before verifying. Only verified answers affect scores.</p></div>
      <button type="button" className="icon-action-button object-schema-modal-close" aria-label="Close expected answer editor" onClick={onClose}>×</button>
    </div>
    <div className="evaluation-reference-body">
      <div className="evaluation-reference-options"><label><input type="checkbox" checked={absent} onChange={event => setAbsent(event.target.checked)} />Not present in document</label>
        {!absent && ["string", "array<object>"].includes(row.field.data_type) && <label><input type="checkbox" checked={exact} onChange={event => setExact(event.target.checked)} />Exact text match</label>}
      </div>
      {!absent && (table ? <>
        <div className="evaluation-record-toolbar"><div><strong>Expected rows</strong><p>{value.length} {value.length === 1 ? "row" : "rows"} · {columns.length} schema columns</p></div><div className="actions compact"><button type="button" className="secondary" disabled={!value.length} onClick={removeRow}>Remove row {value.length ? selected + 1 : ""}</button><button type="button" onClick={addRow}>Add row</button></div></div>
        <div className="evaluation-record-editor">
          <ScrollArea className="evaluation-record-list" role="navigation" aria-label="Expected rows">
            {value.map((_, i) => <button type="button" className="secondary" key={i} aria-label={`Select row ${i + 1}`} aria-pressed={selected === i} onClick={() => setSelected(i)}>Row {i + 1}</button>)}
          </ScrollArea>
          <ScrollArea className="object-schema-table-wrap" role="region" aria-label="Expected row columns" tabIndex={0}>
            <table className="object-schema-table evaluation-schema-values" aria-label="Expected row schema values"><thead><tr><th scope="col">Order</th><th scope="col">Column name</th><th scope="col">Type</th><th scope="col">Expected value</th></tr></thead><tbody>
              {!value.length ? <tr><td colSpan={4} className="object-schema-empty">No expected rows. Add a row to enter values using this Template’s schema.</td></tr> : columns.map((column, i) => <tr key={column.key}>
                <td><span className="object-schema-row-number">{String(i + 1).padStart(2, "0")}</span></td>
                <td><strong>{column.heading}</strong>{column.description && <p>{column.description}</p>}</td>
                <td>{getDataTypeLabel(column.data_type)}</td>
                <td><AnswerInput type={column.data_type} label={`Expected row ${selected + 1} ${column.heading}`} value={value[selected]?.[column.key]} onChange={answer => changeCell(column.key, answer)} /></td>
              </tr>)}
            </tbody></table>
          </ScrollArea>
        </div>
      </> : <label>Expected value<AnswerInput type={row.field.data_type} label="Expected value" value={value} onChange={setValue} multiline /></label>)}
    </div>
    <div className={table ? "object-schema-modal-footer evaluation-reference-footer" : "evaluation-reference-footer"}>
      {table && !absent && <label>Compare rows<select aria-label="Compare rows" value={rows.mode === "key" ? rows.key : rows.mode} onChange={event => setRows(event.target.value === "position" ? { mode: "position" } : { mode: "key", key: event.target.value })}><option value="">Choose row matching (required)</option><option value="position">By row position</option>{columns.map(c => <option value={c.key} key={c.key}>By {c.heading}</option>)}</select><small>Match by a unique column, or compare rows in their listed order.</small></label>}
      {error && <p role="alert">{error}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button>{initial.verified && <button type="button" className="secondary" onClick={() => onSave({ ...initial, verified: false })}>Remove verification</button>}<button type="button" onClick={verify}>Use as expected answer</button></div>
    </div>
  </ModalDialog>;
}
