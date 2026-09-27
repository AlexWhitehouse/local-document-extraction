import { getDataTypeLabel } from "../templates/templateFields.js";
import { WorkspaceToolbar } from "../layout/MainLayout.jsx";
import { DocumentUploadPanel } from "../documents/DocumentUploadPanel.jsx";
import { ReferenceModal } from "./ReferenceModal.jsx";
import { EvaluationDialog } from "./EvaluationDialog.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TemplateEditorModal } from "../templates/TemplateEditorModal.jsx";
import { candidateBusy } from "./useEvaluations.js";
import { fieldIdentity, scoreCandidate, tableAnswerRows, tableColumns } from "./evaluationScoring.js";
import "./evaluations.css";

const display = value => value === undefined || value === null ? "—" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
export function EvaluationsPage({ evaluation, templates, workspaceLabel = "Workspace", enabled, maxSourceFileBytes, onTemplateSaved }) {
  const { state, patch, edit, api } = evaluation;
  const [templateId, setTemplateId] = useState("");
  const [version, setVersion] = useState("");
  const [editor, setEditor] = useState(null);
  const [referenceEditor, setReferenceEditor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [preview, setPreview] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isDragActive, setDragActive] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [replacement, setReplacement] = useState(null);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; setEditor(null); setReferenceEditor(null); setExpanded(null); setTemplateId(""); setVersion(""); setReplacement(null); setUploadOpen(false); setPreview(false); setSelectedId(null); setNotice(""); setLocalError(""); }, [state.id]);
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
  const selectedCandidate = state.candidates.find(c => c.id === selectedId) || state.candidates[0];
  const selectDocument = files => {
    const file = files[0];
    setDragActive(false);
    if (!file) return;
    if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLocalError("Choose a PDF, PNG, JPG or WEBP document."); return; }
    if (file.size > maxSourceFileBytes) { setLocalError("Document exceeds the Workspace file limit."); return; }
    patch({ document: file }); setLocalError(""); setUploadOpen(false);
  };
  const load = async () => {
    if (!templateId) return;
    const current = lifetime.current;
    setLoading(true); setLocalError("");
    try {
      const template = await (await api(`/evaluations/templates/${encodeURIComponent(templateId)}${version ? `?version=${version}` : ""}`)).json();
      if (current !== lifetime.current) return;
      const selected = { ...template, source: { id: templateId, version: Number(version || template.current_version) }, name: `${template.name} · fields v${version || template.current_version}` };
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
    setReferenceEditor({ row, initial: candidate ? { value: raw?.answer, absent: raw?.status === "not_found", exact: existing?.exact || false, rows: existing?.rows } : existing || { value: "", absent: false, exact: false } });
  };
  const renderValue = (row, candidate, full = false) => {
    const field = row.candidates[candidate.id];
    if (!field) return <span className="muted">Not requested</span>;
    if (!candidate.result) return <span className="muted">Run to compare</span>;
    const raw = candidate.result.raw.find(r => r.field_id === field.id);
    const score = scores[candidate.id].byField[field.id];
    const columns = tableColumns(field);
    const tableRows = tableAnswerRows(raw?.answer);
    return <div className="evaluation-value">
      <span className={`evaluation-score ${score?.state === "Match" ? "match" : score?.state === "Mismatch" ? "mismatch" : ""}`}>{score?.state || "Unscored"}</span>
      <small>{raw?.status || "not_found"}</small>
      {field.data_type === "array<object>" && tableRows !== null && columns.length ? <>
        <div className="evaluation-table-scroll"><table><thead><tr>{columns.map(c => <th key={c.key}>{c.heading}</th>)}</tr></thead><tbody>{tableRows.slice(0, full ? undefined : 3).map((r, i) => <tr key={i}>{columns.map(c => <td key={c.key}>{display(r?.[c.key])}</td>)}</tr>)}</tbody></table></div>
        <small>{tableRows.length} rows{!full && tableRows.length > 3 ? " · showing first 3" : ""}</small>
      </> : <pre>{display(raw?.answer)}</pre>}
      {score?.reason && <p>{score.reason}</p>}
      {score?.kind === "table" && <p>Cells: {score.matched}/{score.total} · Missing rows: {score.missing.join(", ") || "none"} · Extra rows: {score.extra.join(", ") || "none"}</p>}
      {full && score?.cells?.some(cell => !cell.match) && <details><summary>Cell mismatches</summary>{score.cells.filter(cell => !cell.match).map((cell, index) => <p key={index}>Row {cell.row} · {cell.column}: {display(cell.actual)} → Expected {display(cell.expected)}</p>)}</details>}
      {full && columns.length > 0 && <details><summary>Align table columns</summary>{tableColumns(row.field).map(expected => <label key={expected.key}>{expected.heading}<select aria-label={`Align ${expected.heading} in ${candidate.model}`} value={state.columns[candidate.id]?.[field.id]?.[expected.key] || ""} onChange={event => patch({ columns: { ...state.columns, [candidate.id]: { ...state.columns[candidate.id], [field.id]: { ...state.columns[candidate.id]?.[field.id], [expected.key]: event.target.value } } } })}><option value="">Match by name and type</option>{columns.filter(c => c.data_type === expected.data_type).map(c => <option key={c.key} value={c.key}>{c.heading}</option>)}</select></label>)}</details>}
      <button type="button" className="studio-text-button" onClick={() => reference(row, candidate)}>Review as expected answer</button>
    </div>;
  };
  return <section className="evaluations-page" aria-label="Evaluations">
    <WorkspaceToolbar activePage="evaluations" workspaceLabel={workspaceLabel} pageTitle="Evaluations"
      pageDescription="Compare one document. Changes and results disappear when you refresh or close this tab."
      actions={<><button type="button" className="secondary" onClick={() => { if (window.confirm("Clear this Evaluation, including drafts, results and expected answers?")) evaluation.clear(); }}>Clear Evaluation</button>
        <button type="button" disabled={!state.candidates.length || busy || !state.document || state.stale || state.candidates.some(c => !c.model.trim())} onClick={() => evaluation.run(state.candidates.map(c => c.id))}>Run all</button></>} />
    {notice && <p role="status">{notice}</p>}
    {(state.error || localError) && !uploadOpen && <p role="alert">{state.error || localError}</p>}
    <div className="evaluation-setup">
      <div className="evaluation-document-slot"><small>DOCUMENT</small>
        <button type="button" className="evaluation-document-button" onClick={() => state.document ? setPreview(true) : setUploadOpen(true)}>
          <span aria-hidden="true">▤</span><span className="evaluation-document-name" title={state.document?.name}>{state.document?.name || "Upload document"}</span><span className="evaluation-document-action">{state.document ? "View ↗" : "Choose ↗"}</span>
        </button><p>One document · Shared across every candidate</p>
      </div>
      <label>Comparison mode<select value={state.mode} disabled={busy} onChange={event => evaluation.changeMode(event.target.value)}><option value="models">Compare models</option><option value="templates">Compare Templates</option></select></label>
      {!state.candidates.length ? <div className="evaluation-starting-template">
        <label>Starting Template<select value={templateId} disabled={loading} onChange={event => { setTemplateId(event.target.value); setVersion(""); }}><option value="" disabled>{templates.length ? "Choose a Template" : "No saved Templates available"}</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <div className="evaluation-start-actions"><label>Field version<select value={version} disabled={!selectedTemplate || loading} onChange={event => setVersion(event.target.value)}><option value="">{selectedTemplate ? `Current · v${selectedTemplate.current_version}` : "Select a Template first"}</option>{Array.from({ length: Math.max(0, (selectedTemplate?.current_version || 1) - 1) }, (_, index) => <option key={index} value={index + 1}>Fields v{index + 1}</option>)}</select></label>
        <button type="button" disabled={!enabled || !state.setup?.configured || !templateId || loading} onClick={load}>{loading ? "Loading…" : "Start comparison"}</button></div>
      </div> : state.mode === "models" ? <div className="evaluation-shared-template"><small>SHARED TEMPLATE</small><button type="button" className="secondary" onClick={() => openEditor(state.candidates[0])}>Edit shared Template</button><p title={state.candidates[0].template.name}>{state.candidates[0].template.name} · {state.candidates[0].template.fields.length} fields</p></div> : <div>
        <label>Shared model<input value={state.candidates[0].model} onChange={event => patch({ candidates: state.candidates.map(c => ({ ...c, model: event.target.value, revision: c.revision + 1 })) })} /></label>
        <details className="evaluation-shared-settings"><summary>Advanced settings</summary>{["pdf", "structured"].map(key => <label key={key}><input type="checkbox" checked={state.candidates[0][key]} onChange={event => patch({ candidates: state.candidates.map(c => ({ ...c, [key]: event.target.checked, revision: c.revision + 1 })) })} />{key === "pdf" ? "Direct PDF input" : "Structured output"}</label>)}</details>
      </div>}
    </div>
    {state.candidates.length > 0 ? <>
      <div className="evaluation-runbar"><div><h2>Comparison matrix</h2><p>{state.mode === "models" ? "One Template, different models." : "One model, independent Template drafts."} Select a candidate to copy its inputs.</p></div>
        <button type="button" className="secondary" disabled={state.candidates.length >= 8} onClick={() => { const id = evaluation.duplicate(selectedCandidate.id); if (id) setSelectedId(id); }}>Add candidate ({state.candidates.length}/8)</button>
      </div>
      <div className="evaluation-comparison-scroll"><table className="evaluation-comparison" style={{ minWidth: 175 + state.candidates.length * 285 }}><thead><tr><th><small>FIELD / EXPECTED</small><p className="evaluation-matrix-hint">Compare each answer across candidates.</p></th>{state.candidates.map((candidate, index) => {
        const score = scores[candidate.id];
        const resultNotice = [
          candidate.result && candidate.revision !== candidate.result.revision && "Edited · needs rerun",
          candidate.result && (candidateBusy(candidate) || ["failure", "interrupted"].includes(candidate.status)) && "Previous result",
        ].filter(Boolean).join(" · ");
        return <th key={candidate.id}><div className={`evaluation-candidate ${selectedCandidate.id === candidate.id ? "selected" : ""}`}><button type="button" className="evaluation-candidate-name" aria-label={`Select Candidate ${index + 1}`} aria-pressed={selectedCandidate.id === candidate.id} onClick={() => setSelectedId(candidate.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>Candidate {index + 1}</strong>{selectedCandidate.id === candidate.id && <small>Selected</small>}</button>
          {state.mode === "models" ? <label>Model name<input aria-label={`Candidate ${index + 1} model`} value={candidate.model} onChange={event => edit(candidate.id, { model: event.target.value })} /></label> : <><span>{candidate.template.name}</span><button type="button" className="secondary" onClick={() => openEditor(candidate)}>Edit Template</button><button type="button" className="studio-text-button" onClick={() => { setReplacement(candidate.id); setTemplateId(""); setVersion(""); }}>Choose another Template/version</button></>}
          {state.mode === "models" && <details><summary>Advanced</summary><label><input type="checkbox" checked={candidate.pdf} onChange={event => edit(candidate.id, { pdf: event.target.checked })} />Direct PDF input</label><label><input type="checkbox" checked={candidate.structured} onChange={event => edit(candidate.id, { structured: event.target.checked })} />Structured output</label></details>}
          <div className="actions"><button type="button" disabled={candidateBusy(candidate) || !state.document || !candidate.model.trim() || state.stale} onClick={() => evaluation.run([candidate.id])}>Run candidate</button></div>
          <button type="button" className="studio-text-button" onClick={() => openEditor(candidate, true)}>Save as new Template</button>
          <span role="status">{candidate.status}{candidate.attempt > 1 ? ` · attempt ${candidate.attempt}/3` : ""}</span>
          {candidate.message && <p role="alert">{candidate.message}</p>}
          {candidate.result && <>{resultNotice && <span className={candidate.revision !== candidate.result.revision ? "evaluation-stale" : "muted"}>{resultNotice}</span>}
            <details><summary>Run details</summary><small>Tested Template: {candidate.result.templateName}{candidate.result.source?.modified ? " · edited fields" : ""}</small><small>Tested model: {candidate.result.model} · PDF {candidate.result.pdf ? "direct" : "rendered"} · Structured {candidate.result.structured ? "on" : "off"}</small>
            <small>Queue {(candidate.result.queueMs / 1000).toFixed(1)}s · Processing {(candidate.result.processingMs / 1000).toFixed(1)}s · {candidate.result.attempts} attempt(s)</small><small>Tokens: {candidate.result.usage ? `${candidate.result.usage.input_tokens ?? "Unavailable"} input · ${candidate.result.usage.output_tokens ?? "Unavailable"} output · successful attempt only` : "Unavailable"}</small></details>
            {candidate.cleanup !== "complete" && <small>Cleanup {candidate.cleanup === "pending" ? "pending" : "unconfirmed"}</small>}
            <div className="evaluation-metrics"><span>Fields: {score.fields ? `${score.fields.matched}/${score.fields.total} match` : "Unscored"}</span><span>Table cells: {score.tables ? `${score.tables.matched}/${score.tables.total} match` : score.tablesNeedingReview ? "Needs review" : "Unscored"}{score.tablesNeedingReview > 0 && ` · ${score.tablesNeedingReview} table${score.tablesNeedingReview === 1 ? "" : "s"} awaiting review`}</span><span>Coverage: {score.coverage?.total ? `${score.coverage.requested}/${score.coverage.total} verified fields requested` : "No verified answers"}</span></div>
          </>}
        </div></th>;
      })}</tr></thead><tbody>{[...rows.values()].map(row => <tr key={row.identity}><th><div className="evaluation-field-heading"><strong>{row.field.name}</strong><small>{getDataTypeLabel(row.field.data_type)}</small><button type="button" className="studio-text-button" onClick={() => reference(row)}> {state.references[row.identity]?.verified ? "Edit expected answer" : "Add expected answer"}</button>{state.references[row.identity]?.verified && <small>Verified · {state.references[row.identity].absent ? "Not present in document" : Array.isArray(state.references[row.identity].value) ? `${state.references[row.identity].value.length} expected rows` : display(state.references[row.identity].value)}</small>}{["array<object>", "object", "array"].includes(row.field.data_type) && <button type="button" className="studio-text-button" onClick={() => setExpanded(row.identity)}>Expand comparison</button>}</div></th>{state.candidates.map(c => <td key={c.id}>{renderValue(row, c)}</td>)}</tr>)}</tbody></table></div>
    </> : <div className="evaluation-empty"><h2>Set up your comparison</h2><p>Choose a saved Template to start with two candidates, then add up to eight. Upload one document to evaluate them together.</p></div>}
    {uploadOpen && <EvaluationDialog label="Upload evaluation document" onClose={() => { setUploadOpen(false); setLocalError(""); }}><div className="evaluation-heading"><h2>Upload document</h2><button className="secondary" onClick={() => { setUploadOpen(false); setLocalError(""); }}>Close</button></div>
      <DocumentUploadPanel label="Document" multiple={false} maxSourceFileBytes={maxSourceFileBytes} isDragActive={isDragActive} onSelectSourceFiles={selectDocument} onDragOver={() => setDragActive(true)} onDragLeave={() => setDragActive(false)} onDrop={event => selectDocument(Array.from(event.dataTransfer.files || []))} />
      {localError && <p role="alert">{localError}</p>}
    </EvaluationDialog>}
    {replacement && <EvaluationDialog label="Choose candidate Template" onClose={() => setReplacement(null)}><h2>Choose candidate Template</h2><label>Template<select value={templateId} disabled={loading} onChange={event => { setTemplateId(event.target.value); setVersion(""); }}><option value="" disabled>Choose a Template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Field version<select value={version} disabled={!selectedTemplate || loading} onChange={event => setVersion(event.target.value)}><option value="">{selectedTemplate ? `Current · v${selectedTemplate.current_version}` : "Select a Template first"}</option>{Array.from({ length: Math.max(0, (selectedTemplate?.current_version || 1) - 1) }, (_, index) => <option key={index} value={index + 1}>Fields v{index + 1}</option>)}</select></label>
      <div className="actions"><button className="secondary" onClick={() => setReplacement(null)}>Cancel</button><button disabled={!templateId || loading} onClick={load}>{loading ? "Loading…" : "Replace candidate Template"}</button></div>{localError && <p role="alert">{localError}</p>}
    </EvaluationDialog>}
    {editor && <TemplateEditorModal key={`${editor.candidateId}:${editor.save}`} {...editor} title={editor.save ? "Save as new Template" : "Edit Template"} action={editor.save ? "Save new Template" : "Apply changes"} onSubmit={applyTemplate} onClose={() => setEditor(null)} />}
    {referenceEditor && <ReferenceModal {...referenceEditor} onClose={() => setReferenceEditor(null)} onSave={value => { const { row } = referenceEditor; patch({ references: { ...state.references, [row.identity]: value }, definitions: { ...state.definitions, [row.identity]: row.field } }); setReferenceEditor(null); }} />}
    {expanded && rows.has(expanded) && <EvaluationDialog className="evaluation-expanded" label="Expanded comparison" onClose={() => setExpanded(null)}><div className="evaluation-heading"><h2>{rows.get(expanded).field.name}</h2><button onClick={() => setExpanded(null)}>Close</button></div><div className="evaluation-expanded-grid">{state.candidates.map((c, i) => <section key={c.id}><h3>Candidate {i + 1} · {c.result?.model || c.model}</h3>{renderValue(rows.get(expanded), c, true)}</section>)}</div></EvaluationDialog>}
    {preview && <EvaluationDialog className="evaluation-expanded" label="Document preview" onClose={() => setPreview(false)}><button onClick={() => setPreview(false)}>Close document</button>{state.document?.type === "application/pdf" ? <iframe title="Evaluation document" src={sourceUrl} /> : <img alt="Evaluation document" src={sourceUrl} />}</EvaluationDialog>}
  </section>;
}
