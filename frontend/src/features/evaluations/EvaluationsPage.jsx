import { getDataTypeLabel } from "../templates/templateFields.js";
import { EvaluationDialog } from "./EvaluationDialog.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TemplateEditorModal } from "../templates/TemplateEditorModal.jsx";
import { candidateBusy } from "./useEvaluations.js";
import { fieldIdentity, scoreCandidate, tableColumns, validateReference } from "./evaluationScoring.js";
import "./evaluations.css";

const display = value => value === undefined || value === null ? "—" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
export function EvaluationsPage({ evaluation, templates, draft, enabled, maxSourceFileBytes, onTemplateSaved }) {
  const { state, patch, edit, api } = evaluation;
  const [templateId, setTemplateId] = useState("");
  const [version, setVersion] = useState("");
  const [editor, setEditor] = useState(null);
  const [referenceEditor, setReferenceEditor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [replacement, setReplacement] = useState(null);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; setEditor(null); setReferenceEditor(null); setExpanded(null); setTemplateId(""); setVersion(""); setReplacement(null); }, [state.id]);
  const busy = state.candidates.some(candidateBusy);
  const sourceUrl = useMemo(() => state.document ? URL.createObjectURL(state.document) : "", [state.document]);
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  const definitions = { ...state.definitions };
  const rows = new Map();
  for (const candidate of state.candidates) {
    for (const field of candidate.result?.fields || candidate.template.fields) {
      definitions[fieldIdentity(field)] ||= field;
      const identity = state.alignments[candidate.id]?.[field.id] || fieldIdentity(field);
      definitions[identity] ||= field;
      if (!rows.has(identity)) rows.set(identity, { identity, field: definitions[identity], candidates: {} });
      rows.get(identity).candidates[candidate.id] = field;
    }
  }
  for (const [identity, field] of Object.entries(state.definitions)) if (!rows.has(identity)) rows.set(identity, { identity, field, candidates: {} });
  const scores = Object.fromEntries(state.candidates.map(c => [c.id, scoreCandidate(c, state.references, definitions, state.alignments[c.id], state.columns[c.id])]));
  const selectedTemplate = templates.find(t => t.id === templateId);
  const load = async () => {
    const current = lifetime.current;
    setLoading(true); setLocalError("");
    try {
      const template = templateId ? await (await api(`/evaluations/templates/${encodeURIComponent(templateId)}${version ? `?version=${version}` : ""}`)).json() : draft;
      if (current !== lifetime.current) return;
      const selected = { ...template, source: templateId ? { id: templateId, version: Number(version || template.current_version) } : undefined, name: templateId ? `${template.name} · fields v${version || template.current_version}` : template.name || "Untitled Template" };
      if (replacement) { edit(replacement, { template: selected }); setReplacement(null); }
      else evaluation.start(selected);
    } catch (error) { if (current === lifetime.current) setLocalError(error.message); }
    finally { if (current === lifetime.current) setLoading(false); }
  };
  const openEditor = (candidate, save = false) => setEditor({ candidateId: candidate.id, save, initial: { ...candidate.template, name: save ? `${candidate.template.name} copy` : candidate.template.name }, notice: save && candidate.result?.revision !== candidate.revision ? "These current edits have not been tested. Saving creates a new Template." : save ? "Creates a new Template from the current draft." : "Changes apply to the draft. Run again to test them." });
  const applyTemplate = async payload => {
    if (editor.save) {
      await api("/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setNotice("New Template saved. Your Evaluation draft and original Template are unchanged.");
      await onTemplateSaved?.();
    } else if (state.mode === "models") {
      patch({ candidates: state.candidates.map(c => ({ ...c, template: { ...structuredClone(payload), source: c.template.source ? { ...c.template.source, modified: true } : undefined }, revision: c.revision + 1 })) });
    } else edit(editor.candidateId, { template: { ...payload, source: state.candidates.find(c => c.id === editor.candidateId).template.source ? { ...state.candidates.find(c => c.id === editor.candidateId).template.source, modified: true } : undefined } });
  };
  const reference = (row, candidate) => {
    const raw = candidate?.result?.raw.find(r => r.field_id === row.candidates[candidate.id]?.id);
    const existing = state.references[row.identity];
    setReferenceEditor({ row, initial: candidate ? { value: raw?.answer, absent: raw?.status === "not_found", exact: false } : existing || { value: "", absent: false, exact: false } });
  };
  const align = (candidate, field, identity) => {
    const map = { ...state.alignments[candidate.id], [field.id]: identity };
    // One-to-one links prevent counting one expected field more than once.
    for (const key of Object.keys(map)) if (key !== field.id && map[key] === identity) delete map[key];
    patch({ alignments: { ...state.alignments, [candidate.id]: map } });
  };
  const renderValue = (row, candidate, full = false) => {
    const field = row.candidates[candidate.id];
    if (!field) return <span className="muted">Not requested</span>;
    if (!candidate.result) return <span className="muted">Run to compare</span>;
    const raw = candidate.result.raw.find(r => r.field_id === field.id);
    const score = scores[candidate.id].byField[field.id];
    const columns = tableColumns(field);
    return <div className="evaluation-value">
      <span className={`evaluation-score ${score?.state === "Match" ? "match" : score?.state === "Mismatch" ? "mismatch" : ""}`}>{score?.state || "Unscored"}</span>
      <small>{raw?.status || "not_found"}</small>
      {field.data_type === "array<object>" && Array.isArray(raw?.answer) && columns.length ? <>
        <div className="evaluation-table-scroll"><table><thead><tr>{columns.map(c => <th key={c.key}>{c.heading}</th>)}</tr></thead><tbody>{raw.answer.slice(0, full ? undefined : 3).map((r, i) => <tr key={i}>{columns.map(c => <td key={c.key}>{display(r?.[c.key])}</td>)}</tr>)}</tbody></table></div>
        <small>{raw.answer.length} rows{!full && raw.answer.length > 3 ? " · showing first 3" : ""}</small>
      </> : <pre>{display(raw?.answer)}</pre>}
      {score?.reason && <p>{score.reason}</p>}
      {score?.kind === "table" && <p>Cells: {score.matched}/{score.total} · Missing rows: {score.missing.join(", ") || "none"} · Extra rows: {score.extra.join(", ") || "none"}</p>}
      {full && score?.cells?.some(cell => !cell.match) && <details><summary>Cell mismatches</summary>{score.cells.filter(cell => !cell.match).map((cell, index) => <p key={index}>Row {cell.row} · {cell.column}: {display(cell.actual)} → Expected {display(cell.expected)}</p>)}</details>}
      {full && columns.length > 0 && <details><summary>Align table columns</summary>{tableColumns(row.field).map(expected => <label key={expected.key}>{expected.heading}<select aria-label={`Align ${expected.heading} in ${candidate.model}`} value={state.columns[candidate.id]?.[field.id]?.[expected.key] || ""} onChange={event => patch({ columns: { ...state.columns, [candidate.id]: { ...state.columns[candidate.id], [field.id]: { ...state.columns[candidate.id]?.[field.id], [expected.key]: event.target.value } } } })}><option value="">Match by name and type</option>{columns.filter(c => c.data_type === expected.data_type).map(c => <option key={c.key} value={c.key}>{c.heading}</option>)}</select></label>)}</details>}
      <button type="button" className="studio-text-button" onClick={() => reference(row, candidate)}>Review as expected answer</button>
      <details><summary>Field alignment</summary><select aria-label={`Align ${field.name} for ${candidate.model}`} value={state.alignments[candidate.id]?.[field.id] || fieldIdentity(field)} onChange={event => align(candidate, field, event.target.value)}>{Object.entries(definitions).filter(([, f]) => f.data_type === field.data_type).map(([identity, f]) => <option key={identity} value={identity}>{f.name}</option>)}</select></details>
    </div>;
  };
  return <section className="evaluations-page" aria-label="Evaluations">
    <header className="evaluation-heading"><div><p className="studio-eyebrow">Temporary comparisons</p><h1>Evaluations</h1><p>One document. Compare models or Template variants. Refreshing discards this Evaluation.</p></div><button type="button" className="secondary" onClick={() => { if (window.confirm("Clear this Evaluation, including drafts, results and expected answers?")) evaluation.clear(); }}>Clear Evaluation</button></header>
    {notice && <p role="status">{notice}</p>}
    {(state.error || localError) && <p role="alert">{state.error || localError}</p>}
    <div className="evaluation-setup">
      <label>Comparison mode<select value={state.mode} disabled={busy} onChange={event => evaluation.changeMode(event.target.value)}><option value="models">Model comparison</option><option value="templates">Template comparison</option></select></label>
      <label>Document{state.document ? <strong>{state.document.name}</strong> : <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={busy || Boolean(state.document && state.candidates.length)} onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > maxSourceFileBytes) { setLocalError("Document exceeds the Workspace file limit."); return; }
        patch({ document: file }); setLocalError("");
      }} />}</label>
      {state.document && <button type="button" className="secondary" onClick={() => setPreview(true)}>View {state.document.name}</button>}
      {(!state.candidates.length || replacement) && <>
        <label>Starting Template<select value={templateId} onChange={event => { setTemplateId(event.target.value); setVersion(""); }}><option value="">Current Template draft</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {selectedTemplate && <label>Field version<select value={version} onChange={event => setVersion(event.target.value)}><option value="">Current · v{selectedTemplate.current_version}</option>{Array.from({ length: selectedTemplate.current_version || 1 }, (_, index) => <option key={index} value={index + 1}>Fields v{index + 1}</option>)}</select></label>}
        <button type="button" disabled={!enabled || !state.setup?.configured || loading} onClick={load}>{loading ? "Loading…" : replacement ? "Replace candidate Template" : "Start comparison"}</button>
      </>}
    </div>
    {state.candidates.length > 0 && <>
      <div className="evaluation-runbar"><span>{state.candidates.length} of 8 candidates · {state.mode === "models" ? "Shared Template fields" : "Shared model settings"}</span>
        {state.mode === "templates" && <label>Shared model<input value={state.candidates[0].model} onChange={event => patch({ candidates: state.candidates.map(c => ({ ...c, model: event.target.value, revision: c.revision + 1 })) })} /></label>}
        {state.mode === "templates" && <details><summary>Advanced</summary>{["pdf", "structured"].map(key => <label key={key}><input type="checkbox" checked={state.candidates[0][key]} onChange={event => patch({ candidates: state.candidates.map(c => ({ ...c, [key]: event.target.checked, revision: c.revision + 1 })) })} />{key === "pdf" ? "Direct PDF input" : "Structured output"}</label>)}</details>}
        {state.mode === "models" && <button type="button" className="secondary" onClick={() => openEditor(state.candidates[0])}>Edit shared Template</button>}
        <button type="button" disabled={busy || !state.document || state.stale || state.candidates.some(c => !c.model.trim())} onClick={() => evaluation.run(state.candidates.map(c => c.id))}>Run all</button>
      </div>
      <div className="evaluation-comparison-scroll"><table className="evaluation-comparison"><thead><tr><th>Fields & expected answers</th>{state.candidates.map((candidate, index) => {
        const score = scores[candidate.id];
        return <th key={candidate.id}><div className="evaluation-candidate"><strong>Candidate {index + 1}</strong>
          {state.mode === "models" ? <label>Model name<input aria-label={`Candidate ${index + 1} model`} value={candidate.model} onChange={event => edit(candidate.id, { model: event.target.value })} /></label> : <><span>{candidate.template.name}</span><button type="button" className="secondary" onClick={() => openEditor(candidate)}>Edit Template</button><button type="button" className="studio-text-button" onClick={() => setReplacement(candidate.id)}>Choose another Template/version</button></>}
          {state.mode === "models" && <details><summary>Advanced</summary><label><input type="checkbox" checked={candidate.pdf} onChange={event => edit(candidate.id, { pdf: event.target.checked })} />Direct PDF input</label><label><input type="checkbox" checked={candidate.structured} onChange={event => edit(candidate.id, { structured: event.target.checked })} />Structured output</label></details>}
          <div className="actions"><button type="button" disabled={candidateBusy(candidate) || !state.document || !candidate.model.trim() || state.stale} onClick={() => evaluation.run([candidate.id])}>Run candidate</button><button type="button" className="secondary" disabled={state.candidates.length >= 8} onClick={() => evaluation.duplicate(candidate.id)}>Duplicate</button></div>
          <button type="button" className="studio-text-button" onClick={() => openEditor(candidate, true)}>Save as new Template</button>
          <span role="status">{candidate.status}{candidate.attempt > 1 ? ` · attempt ${candidate.attempt}/3` : ""}</span>
          {candidate.message && <p role="alert">{candidate.message}</p>}
          {candidate.result && <><span className={candidate.revision !== candidate.result.revision ? "evaluation-stale" : "muted"}>{candidate.revision !== candidate.result.revision ? "Edited · needs rerun" : "Tested inputs"}{candidateBusy(candidate) || ["failure", "interrupted"].includes(candidate.status) ? " · Previous result" : ""}</span>
            <details><summary>Run details</summary><small>Tested Template: {candidate.result.templateName}{candidate.result.source?.modified ? " · edited fields" : ""}</small><small>Tested model: {candidate.result.model} · PDF {candidate.result.pdf ? "direct" : "rendered"} · Structured {candidate.result.structured ? "on" : "off"}</small>
            <small>Queue {(candidate.result.queueMs / 1000).toFixed(1)}s · Processing {(candidate.result.processingMs / 1000).toFixed(1)}s · {candidate.result.attempts} attempt(s)</small><small>Tokens: {candidate.result.usage ? `${candidate.result.usage.input_tokens ?? "Unavailable"} input · ${candidate.result.usage.output_tokens ?? "Unavailable"} output · successful attempt only` : "Unavailable"}</small></details>
            {candidate.cleanup !== "complete" && <small>Cleanup {candidate.cleanup === "pending" ? "pending" : "unconfirmed"}</small>}
            <div className="evaluation-metrics"><span>Fields: {score.fields ? `${score.fields.matched}/${score.fields.total} match` : "Unscored"}</span><span>Table cells: {score.tables ? `${score.tables.matched}/${score.tables.total} match` : "Unscored"}</span><span>Coverage: {score.coverage?.total ? `${score.coverage.requested}/${score.coverage.total} verified fields requested` : "No verified answers"}</span></div>
          </>}
        </div></th>;
      })}</tr></thead><tbody>{[...rows.values()].map(row => <tr key={row.identity}><th><strong>{row.field.name}</strong><small>{getDataTypeLabel(row.field.data_type)}</small><button type="button" className="studio-text-button" onClick={() => reference(row)}> {state.references[row.identity]?.verified ? "Edit expected answer" : "Add expected answer"}</button>{state.references[row.identity]?.verified && <small>Verified · {state.references[row.identity].absent ? "Not present in document" : Array.isArray(state.references[row.identity].value) ? `${state.references[row.identity].value.length} expected rows` : display(state.references[row.identity].value)}</small>}{["array<object>", "object", "array"].includes(row.field.data_type) && <button type="button" className="studio-text-button" onClick={() => setExpanded(row.identity)}>Expand comparison</button>}</th>{state.candidates.map(c => <td key={c.id}>{renderValue(row, c)}</td>)}</tr>)}</tbody></table></div>
    </>}
    {editor && <TemplateEditorModal key={`${editor.candidateId}:${editor.save}`} {...editor} title={editor.save ? "Save as new Template" : "Edit Template"} action={editor.save ? "Save new Template" : "Apply changes"} onSubmit={applyTemplate} onClose={() => setEditor(null)} />}
    {referenceEditor && <ReferenceModal {...referenceEditor} onClose={() => setReferenceEditor(null)} onSave={value => { const { row } = referenceEditor; patch({ references: { ...state.references, [row.identity]: value }, definitions: { ...state.definitions, [row.identity]: row.field } }); setReferenceEditor(null); }} />}
    {expanded && rows.has(expanded) && <EvaluationDialog className="evaluation-expanded" label="Expanded comparison" onClose={() => setExpanded(null)}><div className="evaluation-heading"><h2>{rows.get(expanded).field.name}</h2><button onClick={() => setExpanded(null)}>Close</button></div><div className="evaluation-expanded-grid">{state.candidates.map((c, i) => <section key={c.id}><h3>Candidate {i + 1} · {c.result?.model || c.model}</h3>{renderValue(rows.get(expanded), c, true)}</section>)}</div></EvaluationDialog>}
    {preview && <EvaluationDialog className="evaluation-expanded" label="Document preview" onClose={() => setPreview(false)}><button onClick={() => setPreview(false)}>Close document</button>{state.document?.type === "application/pdf" ? <iframe title="Evaluation document" src={sourceUrl} /> : <img alt="Evaluation document" src={sourceUrl} />}</EvaluationDialog>}
  </section>;
}

function ReferenceModal({ row, initial, onSave, onClose }) {
  const [value, setValue] = useState(() => typeof initial.value === "object" && initial.value !== null ? JSON.stringify(initial.value, null, 2) : initial.value === undefined ? "" : String(initial.value));
  const [absent, setAbsent] = useState(initial.absent || false), [exact, setExact] = useState(initial.exact || false);
  const [rows, setRows] = useState(initial.rows || { mode: "", key: "" });
  const [error, setError] = useState("");
  const table = row.field.data_type === "array<object>";
  const columns = tableColumns(row.field);
  let tableRows = [];
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) tableRows = parsed; } catch { /* Manual entry starts with an empty table. */ }
  const changeCell = (index, key, answer) => setValue(JSON.stringify(tableRows.map((r, i) => i === index ? { ...r, [key]: answer } : r)));
  const verify = () => {
    try {
      const reference = { verified: true, absent, exact, value: table && !absent ? tableRows : value, rows };
      const problem = validateReference(row.field, reference);
      if (problem) throw new Error(problem);
      onSave(reference);
    } catch (failure) { setError(failure.message); }
  };
  return <EvaluationDialog className="evaluation-reference" label="Verify expected answer" onClose={onClose}><h2>{row.field.name} · Expected answer</h2><p>Review against the document before verifying. Only verified answers affect scores.</p><label><input type="checkbox" checked={absent} onChange={event => setAbsent(event.target.checked)} />Not present in document</label>{!absent && (table ? <div className="evaluation-table-scroll"><p>Complete expected table</p><table><thead><tr>{columns.map(c => <th key={c.key}>{c.heading}</th>)}<th>Rows</th></tr></thead><tbody>{tableRows.map((r, index) => <tr key={index}>{columns.map(c => <td key={c.key}><input aria-label={`Expected row ${index + 1} ${c.heading}`} value={r[c.key] ?? ""} onChange={event => changeCell(index, c.key, event.target.value)} /></td>)}<td><button type="button" className="secondary" onClick={() => setValue(JSON.stringify(tableRows.filter((_, i) => i !== index)))}>Remove row {index + 1}</button></td></tr>)}</tbody></table><button type="button" className="secondary" onClick={() => setValue(JSON.stringify([...tableRows, Object.fromEntries(columns.map(c => [c.key, ""]))]))}>Add row</button></div> : <label>Expected value<textarea value={value} onChange={event => setValue(event.target.value)} /></label>)}{["string", "array<object>"].includes(row.field.data_type) && <label><input type="checkbox" checked={exact} onChange={event => setExact(event.target.checked)} />Exact text match</label>}{table && !absent && <label>Compare rows<select value={rows.mode === "key" ? rows.key : rows.mode} onChange={event => setRows(event.target.value === "position" ? { mode: "position" } : { mode: "key", key: event.target.value })}><option value="">Choose alignment</option><option value="position">By row position</option>{tableColumns(row.field).map(c => <option value={c.key} key={c.key}>By {c.heading}</option>)}</select></label>}{error && <p role="alert">{error}</p>}<div className="actions"><button className="secondary" onClick={onClose}>Cancel</button>{initial.verified && <button className="secondary" onClick={() => onSave({ ...initial, verified: false })}>Remove verification</button>}<button onClick={verify}>Use as expected answer</button></div></EvaluationDialog>;
}
