import { getDataTypeLabel } from "../templates/templateFields.js";
import { WorkspaceToolbar } from "../layout/MainLayout.jsx";
import { DocumentUploadPanel } from "../documents/DocumentUploadPanel.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ReferenceModal } from "./ReferenceModal.jsx";
import { EvaluationDialog } from "./EvaluationDialog.jsx";
import { EvaluationSetup } from "./EvaluationSetup.jsx";
import { TableComparison } from "./TableComparison.jsx";
import { CandidateMenu, ExpectedInline, Mark, Meter, StatusLine } from "./EvaluationParts.jsx";
import { display, percent } from "./evaluationFormat.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TemplateEditorModal } from "../templates/TemplateEditorModal.jsx";
import { MAX_CANDIDATES, candidateBusy } from "./useEvaluations.js";
import { answerSignature, bestCandidateId, candidateAccuracy, fieldIdentity, scalarValue, scoreCandidate, tableAnswerRows, tableColumns, validateReference } from "./evaluationScoring.js";
import "./evaluations.css";

const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const COMPARABLE_TYPES = ["array<object>", "object", "array"];
const FILTERS = [["all", "All fields"], ["differ", "Candidates differ"], ["mismatch", "Has mismatch"], ["unverified", "Unverified"]];

export function EvaluationsPage({ evaluation, templates, workspaceLabel = "Workspace", enabled, maxSourceFileBytes, suggestedModels, onTemplateSaved }) {
  const { state, patch, edit, api } = evaluation;
  const [templateId, setTemplateId] = useState("");
  const [version, setVersion] = useState("");
  const [editor, setEditor] = useState(null);
  const [referenceEditor, setReferenceEditor] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [preview, setPreview] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isDragActive, setDragActive] = useState(false);
  const [inspect, setInspect] = useState(null);
  const [filter, setFilter] = useState("all");
  const [autoRun, setAutoRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [replacement, setReplacement] = useState(null);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; setEditor(null); setReferenceEditor(null); setExpanded(null); setTemplateId(""); setVersion(""); setReplacement(null); setUploadOpen(false); setPreview(false); setInspect(null); setFilter("all"); setAutoRun(null); setNotice(""); setLocalError(""); }, [state.id]);
  const busy = state.candidates.some(candidateBusy);
  const sourceUrl = useMemo(() => state.document ? URL.createObjectURL(state.document) : "", [state.document]);
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);
  // Setup can start and run in one step; run once the new candidates are in state.
  useEffect(() => {
    if (!autoRun || !autoRun.every(id => state.candidates.some(c => c.id === id))) return;
    setAutoRun(null);
    evaluation.run(autoRun);
  }, [autoRun, state.candidates, evaluation]);
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
  const bestId = bestCandidateId(state.candidates, scores);
  const selectedTemplate = templates.find(t => t.id === templateId);
  const labelFor = candidate => state.mode === "models" ? candidate.model || `Candidate ${state.candidates.indexOf(candidate) + 1}` : candidate.template.name;
  const rawFor = (row, candidate) => candidate.result?.raw.find(r => r.field_id === row.candidates[candidate.id]?.id);
  const allRows = [...rows.values()];
  const verifiedCount = allRows.filter(row => state.references[row.identity]?.verified).length;
  const visible = allRows.filter(row => filter === "all" ? true
    : filter === "differ" ? new Set(state.candidates.filter(c => c.result && row.candidates[c.id]).map(c => answerSignature(row.candidates[c.id], rawFor(row, c)))).size > 1
      : filter === "mismatch" ? state.candidates.some(c => row.candidates[c.id] && scores[c.id].byField[row.candidates[c.id].id]?.state === "Mismatch")
        : !state.references[row.identity]?.verified);

  const selectDocument = files => {
    const file = files[0];
    setDragActive(false);
    if (!file) return;
    if (!DOCUMENT_TYPES.includes(file.type)) { setLocalError("Choose a PDF, PNG, JPG or WEBP document."); return; }
    if (file.size > maxSourceFileBytes) { setLocalError("Document exceeds the Workspace file limit."); return; }
    patch({ document: file }); setLocalError(""); setUploadOpen(false);
  };
  const loadTemplate = useCallback(async (id, fieldVersion) => {
    const template = await (await api(`/evaluations/templates/${encodeURIComponent(id)}${fieldVersion ? `?version=${fieldVersion}` : ""}`)).json();
    const tested = Number(fieldVersion || template.current_version);
    return { ...template, source: { id, version: tested }, name: `${template.name} · fields v${tested}` };
  }, [api]);
  const startEvaluation = async ({ mode, templateId: id, versions, models, runNow }) => {
    const current = lifetime.current;
    setLocalError("");
    try {
      const loaded = await Promise.all(versions.map(v => loadTemplate(id, v)));
      if (current !== lifetime.current) return;
      const templates = mode === "templates" && loaded.length === 1 ? [loaded[0], loaded[0]] : loaded;
      const ids = evaluation.start(mode, mode === "models" ? models.map(model => ({ template: loaded[0], model })) : templates.map(template => ({ template })));
      if (runNow) setAutoRun(ids);
    } catch (error) { if (current === lifetime.current) setLocalError(error.message); }
  };
  const replaceTemplate = async () => {
    if (!templateId) return;
    const current = lifetime.current;
    setLoading(true); setLocalError("");
    try {
      const selected = await loadTemplate(templateId, version);
      if (current !== lifetime.current) return;
      edit(replacement, { template: selected }); setReplacement(null);
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
  const saveReference = (row, value) => patch({ references: { ...state.references, [row.identity]: value }, definitions: { ...state.definitions, [row.identity]: row.field } });
  const reference = (row, candidate) => {
    const raw = candidate && rawFor(row, candidate);
    const existing = state.references[row.identity];
    setReferenceEditor({ row, initial: candidate ? { value: raw?.answer, absent: raw?.status === "not_found", exact: existing?.exact || false, rows: existing?.rows, verified: existing?.verified } : existing || { value: "", absent: false, exact: false } });
  };
  // One click uses a scalar answer as verified; anything that needs checking opens the editor.
  const acceptAnswer = (row, candidate) => {
    const raw = rawFor(row, candidate);
    const existing = state.references[row.identity];
    const next = raw?.status === "not_found" ? { verified: true, absent: true, exact: false, value: "" } : { verified: true, absent: false, exact: existing?.exact || false, value: raw?.answer };
    if (row.field.data_type === "array<object>" || validateReference(row.field, next)) { reference(row, candidate); return; }
    saveReference(row, next);
  };
  // In Template mode, input settings are shared by every candidate.
  const setInput = (candidate, key, value) => state.mode === "models" ? edit(candidate.id, { [key]: value }) : patch({ candidates: state.candidates.map(c => ({ ...c, [key]: value, revision: c.revision + 1 })) });
  const compact = (field, raw) => {
    if (!raw || raw.status === "not_found") return <span className="evaluation-muted">Not found</span>;
    if (field.data_type === "array<object>") { const records = tableAnswerRows(raw.answer); return records ? `${records.length} ${records.length === 1 ? "row" : "rows"}` : "Unreadable table"; }
    if (typeof raw.answer === "object" && raw.answer !== null) return <code>{JSON.stringify(raw.answer)}</code>;
    const normalized = field.data_type === "boolean" ? scalarValue(raw.answer, "boolean") : null;
    return display(normalized?.valid ? normalized.value : raw.answer);
  };
  const renderValue = (row, candidate, full = false) => {
    const field = row.candidates[candidate.id];
    if (!field) return <span className="evaluation-muted">Not requested</span>;
    if (!candidate.result) return <span className="evaluation-muted">Run to compare</span>;
    const raw = rawFor(row, candidate);
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
    </div>;
  };
  const openComparison = row => row.field.data_type === "array<object>" ? setExpanded({ identity: row.identity, table: true }) : setExpanded({ identity: row.identity });
  const inspected = inspect && rows.has(inspect.identity) && state.candidates.find(c => c.id === inspect.candidateId)
    ? { row: rows.get(inspect.identity), candidate: state.candidates.find(c => c.id === inspect.candidateId) } : null;
  const runDisabled = !state.candidates.length || busy || !state.document || state.stale || state.candidates.some(c => !c.model.trim());

  return <section className="evaluations-page" aria-label="Evaluations">
    <WorkspaceToolbar activePage="evaluations" workspaceLabel={workspaceLabel} pageTitle="Evaluations"
      pageDescription="Compare candidates on one document. Everything here is temporary and clears when you close this tab."
      actions={<><button type="button" className="secondary" onClick={() => { if (window.confirm("Clear this Evaluation, including drafts, results and expected answers?")) evaluation.clear(); }}>Clear Evaluation</button>
        <button type="button" disabled={runDisabled} onClick={() => evaluation.run(state.candidates.map(c => c.id))}>{`Run all${state.candidates.length ? ` ${state.candidates.length}` : ""}`}</button></>} />
    {notice && <p role="status" className="evaluation-notice">{notice}</p>}
    {!state.candidates.length ? <EvaluationSetup state={state} templates={templates} enabled={enabled} maxSourceFileBytes={maxSourceFileBytes} documentUrl={sourceUrl} suggestedModels={suggestedModels}
      error={!uploadOpen ? state.error || localError : ""} loadTemplate={loadTemplate} onSelectDocument={selectDocument} onRemoveDocument={() => patch({ document: null })} onPreviewDocument={() => setPreview(true)} onStart={startEvaluation} /> : <>
      {(state.error || localError) && !uploadOpen && <p role="alert" className="evaluation-page-alert">{state.error || localError}</p>}
      <div className="evaluation-contextbar">
        <div className="evaluation-context-item"><small>Document</small>
          <span className="evaluation-context-value" title={state.document?.name}>{state.document?.name || "No document"}</span>
          <span className="evaluation-context-actions">{state.document && <button type="button" className="studio-text-button" onClick={() => setPreview(true)}>View ↗</button>}<button type="button" className="studio-text-button" onClick={() => setUploadOpen(true)}>{state.document ? "Replace" : "Upload document"}</button></span></div>
        <div className="evaluation-context-item"><small>Comparing</small>
          <div className="evaluation-segmented" role="group" aria-label="Comparison mode">{[["models", "Models"], ["templates", "Templates"]].map(([mode, label]) => <button key={mode} type="button" disabled={busy} aria-pressed={state.mode === mode} onClick={() => evaluation.changeMode(mode)}>{label}</button>)}</div></div>
        {state.mode === "models"
          ? <div className="evaluation-context-item"><small>Shared Template</small><span className="evaluation-context-value" title={state.candidates[0].template.name}>{state.candidates[0].template.name} · {state.candidates[0].template.fields.length} {state.candidates[0].template.fields.length === 1 ? "field" : "fields"}</span>
            <span className="evaluation-context-actions"><button type="button" className="studio-text-button" onClick={() => openEditor(state.candidates[0])}>Edit shared Template</button></span></div>
          : <div className="evaluation-context-item"><small>Shared model</small><input aria-label="Shared model" value={state.candidates[0].model} onChange={event => patch({ candidates: state.candidates.map(c => ({ ...c, model: event.target.value, revision: c.revision + 1 })) })} /></div>}
        <div className="evaluation-context-item evaluation-context-progress"><small>Expected answers</small><span className="evaluation-context-value">{verifiedCount} of {allRows.length} verified</span><Meter value={allRows.length ? verifiedCount / allRows.length : 0} best /></div>
      </div>
      <div className="evaluation-toolbar-row">
        <div className="evaluation-filter" role="group" aria-label="Filter fields">{FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <small className="evaluation-muted">Click an answer to inspect it. Click an expected answer to edit it.</small>
      </div>
      <div className={`evaluation-body ${inspected ? "inspecting" : ""}`}>
        <ScrollArea className="evaluation-comparison-scroll" tabIndex={0} role="region" aria-label="Comparison matrix">
          <table className="evaluation-matrix" style={{ minWidth: 390 + state.candidates.length * 220 + 160 }}>
            <thead><tr><th className="evaluation-field-col">Field</th><th className="evaluation-expected-col">Expected</th>
              {state.candidates.map((candidate, index) => {
                const label = `Candidate ${index + 1}`;
                const score = scores[candidate.id];
                const accuracy = candidateAccuracy(score);
                const best = candidate.id === bestId;
                const previous = candidate.result && (candidateBusy(candidate) || ["failure", "interrupted"].includes(candidate.status));
                return <th key={candidate.id} className="evaluation-candidate">
                  <div className="evaluation-candidate-top"><span className="evaluation-index">{String(index + 1).padStart(2, "0")}</span>
                    {state.mode === "models" ? <input aria-label={`${label} model`} placeholder="Model name" value={candidate.model} onChange={event => edit(candidate.id, { model: event.target.value })} /> : <strong title={candidate.template.name}>{candidate.template.name}</strong>}
                    <CandidateMenu label={label} candidate={candidate} inputs={{ shared: state.mode === "templates" }} onInputChange={(key, value) => setInput(candidate, key, value)} actions={[
                      { label: "Edit Template", onClick: () => openEditor(candidate) },
                      state.mode === "templates" && { label: "Choose another Template/version", onClick: () => { setReplacement(candidate.id); setTemplateId(""); setVersion(""); } },
                      { label: "Save as new Template", onClick: () => openEditor(candidate, true) },
                      { label: "Duplicate candidate", disabled: state.candidates.length >= MAX_CANDIDATES, onClick: () => evaluation.duplicate(candidate.id) },
                      { label: "Remove candidate", danger: true, disabled: state.candidates.length <= 1 || candidateBusy(candidate), onClick: () => { evaluation.remove(candidate.id); if (inspect?.candidateId === candidate.id) setInspect(null); } },
                    ]} /></div>
                  <div className="evaluation-candidate-score"><strong>{accuracy ? percent(accuracy.ratio) : "—"}</strong>{best && <span className="status-chip good">Best</span>}<Meter value={accuracy?.ratio} best={best} /></div>
                  {candidate.message && <p role="alert" className="evaluation-candidate-alert" title={candidate.message}>{candidate.message}</p>}
                  <div className="evaluation-candidate-foot"><StatusLine candidate={candidate} />
                    <small>{previous ? "Previous result" : !candidate.result ? "" : accuracy ? `${accuracy.matched}/${accuracy.total} fields${score.tables ? ` · ${score.tables.matched}/${score.tables.total} cells` : ""}` : score.tablesNeedingReview ? "Table needs review" : "Not scored yet"}</small>
                    <button type="button" className="secondary" aria-label={`Run ${label}`} title="Run candidate" disabled={candidateBusy(candidate) || !state.document || !candidate.model.trim() || state.stale} onClick={() => evaluation.run([candidate.id])}>▶</button></div>
                </th>;
              })}
              <th className="evaluation-add-col"><button type="button" className="secondary" disabled={state.candidates.length >= MAX_CANDIDATES} onClick={() => evaluation.duplicate(state.candidates.at(-1).id)}>+ Add candidate</button><small>{state.candidates.length}/{MAX_CANDIDATES}</small></th>
            </tr></thead>
            <tbody>{visible.map(row => {
              const answered = state.candidates.filter(c => c.result && row.candidates[c.id]).length;
              return <tr key={row.identity}>
                <th className="evaluation-field-col"><strong>{row.field.name}</strong><small className="evaluation-type">{getDataTypeLabel(row.field.data_type)}</small>
                  {COMPARABLE_TYPES.includes(row.field.data_type) && answered > 0 && <button type="button" className="studio-text-button evaluation-compare-link" onClick={() => openComparison(row)}>Compare all {answered} {row.field.data_type === "array<object>" ? (answered === 1 ? "table" : "tables") : "answers"} ↗</button>}</th>
                <td className="evaluation-expected-col"><ExpectedInline key={`${row.identity}:${state.references[row.identity]?.verified}`} field={row.field} reference={state.references[row.identity]} onSave={value => saveReference(row, value)} onOpenEditor={() => reference(row)} /></td>
                {state.candidates.map((candidate, index) => {
                  const field = row.candidates[candidate.id];
                  const score = field && scores[candidate.id].byField[field.id];
                  const active = inspect?.identity === row.identity && inspect?.candidateId === candidate.id;
                  return <td key={candidate.id} className={`evaluation-cell ${score?.state === "Mismatch" ? "mismatch" : ""} ${active ? "active" : ""}`}>
                    {!field ? <span className="evaluation-muted">Not requested</span>
                      : !candidate.result ? <span className="evaluation-muted">{candidateBusy(candidate) ? "Running…" : "Run to compare"}</span>
                        : <button type="button" className="evaluation-cell-button" aria-label={`Inspect ${row.field.name} for Candidate ${index + 1}`} aria-pressed={active} onClick={() => setInspect(active ? null : { identity: row.identity, candidateId: candidate.id })}>
                          <Mark state={score?.state} /><span className="evaluation-cell-value">{compact(field, rawFor(row, candidate))}{score?.reason && <small>{score.reason}</small>}</span></button>}
                  </td>;
                })}
                <td className="evaluation-add-col" />
              </tr>;
            })}
            {!visible.length && <tr><td colSpan={3 + state.candidates.length} className="evaluation-empty-row">No fields match this filter.</td></tr>}
            </tbody>
          </table>
        </ScrollArea>
        {inspected && <aside className="evaluation-inspector" aria-label="Answer inspector">
          <div className="evaluation-inspector-head"><div><small>{labelFor(inspected.candidate)}</small><h2>{inspected.row.field.name}</h2></div><button type="button" className="icon-action-button" aria-label="Close inspector" onClick={() => setInspect(null)}>×</button></div>
          <ScrollArea className="evaluation-inspector-body">
            <section><h3>Answer</h3>{renderValue(inspected.row, inspected.candidate, true)}
              <div className="evaluation-actions start">{!COMPARABLE_TYPES.includes(inspected.row.field.data_type) && scores[inspected.candidate.id].byField[inspected.row.candidates[inspected.candidate.id].id]?.state !== "Match" && <button type="button" onClick={() => acceptAnswer(inspected.row, inspected.candidate)}>{state.references[inspected.row.identity]?.verified ? "Replace expected with this answer" : "Use as expected answer"}</button>}
                <button type="button" className="secondary" onClick={() => reference(inspected.row, inspected.candidate)}>Review as expected answer</button></div></section>
            <section><h3>Expected</h3><p className="evaluation-inspector-value">{state.references[inspected.row.identity]?.verified ? state.references[inspected.row.identity].absent ? "Not in document" : Array.isArray(state.references[inspected.row.identity].value) ? `${state.references[inspected.row.identity].value.length} expected rows` : display(state.references[inspected.row.identity].value) : <span className="evaluation-muted">Not verified yet</span>}</p></section>
            <section><h3>Other candidates</h3><ul className="evaluation-inspector-others">{state.candidates.filter(c => c.id !== inspected.candidate.id && c.result && inspected.row.candidates[c.id]).map(c => <li key={c.id}><Mark state={scores[c.id].byField[inspected.row.candidates[c.id].id]?.state} /><span>{labelFor(c)}</span><span>{compact(inspected.row.candidates[c.id], rawFor(inspected.row, c))}</span></li>)}</ul>
              {COMPARABLE_TYPES.includes(inspected.row.field.data_type) && <button type="button" className="studio-text-button" onClick={() => openComparison(inspected.row)}>Compare all candidates ↗</button>}</section>
          </ScrollArea>
        </aside>}
      </div>
    </>}
    {uploadOpen && <EvaluationDialog label="Upload evaluation document" onClose={() => { setUploadOpen(false); setLocalError(""); }}><div className="evaluation-heading"><h2>Upload document</h2><button className="secondary" onClick={() => { setUploadOpen(false); setLocalError(""); }}>Close</button></div>
      <DocumentUploadPanel label="Document" multiple={false} maxSourceFileBytes={maxSourceFileBytes} isDragActive={isDragActive} onSelectSourceFiles={selectDocument} onDragOver={() => setDragActive(true)} onDragLeave={() => setDragActive(false)} onDrop={event => selectDocument(Array.from(event.dataTransfer.files || []))} />
      {localError && <p role="alert">{localError}</p>}
    </EvaluationDialog>}
    {replacement && <EvaluationDialog label="Choose candidate Template" onClose={() => setReplacement(null)}><h2>Choose candidate Template</h2><label>Template<select value={templateId} disabled={loading} onChange={event => { setTemplateId(event.target.value); setVersion(""); }}><option value="" disabled>Choose a Template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Field version<select value={version} disabled={!selectedTemplate || loading} onChange={event => setVersion(event.target.value)}><option value="">{selectedTemplate ? `Current · v${selectedTemplate.current_version}` : "Select a Template first"}</option>{Array.from({ length: Math.max(0, (selectedTemplate?.current_version || 1) - 1) }, (_, index) => <option key={index} value={index + 1}>Fields v{index + 1}</option>)}</select></label>
      <div className="actions"><button className="secondary" onClick={() => setReplacement(null)}>Cancel</button><button disabled={!templateId || loading} onClick={replaceTemplate}>{loading ? "Loading…" : "Replace candidate Template"}</button></div>{localError && <p role="alert">{localError}</p>}
    </EvaluationDialog>}
    {editor && <TemplateEditorModal key={`${editor.candidateId}:${editor.save}`} {...editor} title={editor.save ? "Save as new Template" : "Edit Template"} action={editor.save ? "Save new Template" : "Apply changes"} onSubmit={applyTemplate} onClose={() => setEditor(null)} />}
    {referenceEditor && <ReferenceModal {...referenceEditor} onClose={() => setReferenceEditor(null)} onSave={value => { saveReference(referenceEditor.row, value); setReferenceEditor(null); }} />}
    {expanded?.table && !referenceEditor && rows.has(expanded.identity) && <TableComparison row={rows.get(expanded.identity)} candidates={state.candidates} reference={state.references[expanded.identity]} scores={scores} columnMappings={state.columns} labelFor={labelFor} onEditExpected={() => reference(rows.get(expanded.identity))} onClose={() => setExpanded(null)} />}
    {expanded && !expanded.table && rows.has(expanded.identity) && <EvaluationDialog className="evaluation-expanded" label="Expanded comparison" onClose={() => setExpanded(null)}><div className="evaluation-heading"><h2>{rows.get(expanded.identity).field.name}</h2><button onClick={() => setExpanded(null)}>Close</button></div><div className="evaluation-expanded-grid">{state.candidates.map((c, i) => <section key={c.id}><h3>Candidate {i + 1} · {c.result?.model || c.model}</h3>{renderValue(rows.get(expanded.identity), c, true)}</section>)}</div></EvaluationDialog>}
    {preview && <EvaluationDialog className="evaluation-expanded" label="Document preview" onClose={() => setPreview(false)}><button onClick={() => setPreview(false)}>Close document</button>{state.document?.type === "application/pdf" ? <iframe title="Evaluation document" src={sourceUrl} /> : <img alt="Evaluation document" src={sourceUrl} />}</EvaluationDialog>}
  </section>;
}
