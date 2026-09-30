import { WorkspaceToolbar } from "../layout/MainLayout.jsx";
import { DocumentUploadPanel } from "../documents/DocumentUploadPanel.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { EvaluationSetup } from "./EvaluationSetup.jsx";
import { DocumentMatrix } from "./DocumentMatrix.jsx";
import { BatchSummary } from "./BatchSummary.jsx";
import { AnswersDialog, ClearDialog, DocumentBanner, DocumentPreview, LibraryPicker, ManageLibrary, SaveDialog, UpdateReview } from "./EvaluationLibrary.jsx";
import { Meter } from "./EvaluationParts.jsx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { TemplateEditorModal } from "../templates/TemplateEditorModal.jsx";
import { MAX_CANDIDATES, documentRunnable, pairBusy } from "./useEvaluations.js";
import { batchSummary, documentCompatibility } from "./evaluationScoring.js";
import { documentDirty, documentTone } from "./evaluationLibrary.js";
import "./evaluations.css";
import { SOURCE_FILE_MIME_TYPES } from "../../lib/runtimeConfiguration";

export function EvaluationsPage({ evaluation, templates, workspaceLabel = "Workspace", enabled, maxSourceFileBytes, suggestedModels, onTemplateSaved }) {
  const { state, patch, edit, api } = evaluation;
  const [templateId, setTemplateId] = useState("");
  const [version, setVersion] = useState("");
  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isDragActive, setDragActive] = useState(false);
  const [autoRun, setAutoRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [replacement, setReplacement] = useState(null);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const [view, setView] = useState(null);
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; setEditor(null); setTemplateId(""); setVersion(""); setReplacement(null); setUploadOpen(false); setPreview(null); setAutoRun(null); setNotice(""); setLocalError(""); setDialog(null); setView(null); }, [state.id]);
  // Setup can start and run in one step; run once the new candidates are in state.
  useEffect(() => {
    if (!autoRun || !autoRun.every(id => state.candidates.some(c => c.id === id))) return;
    setAutoRun(null);
    evaluation.run(autoRun);
  }, [autoRun, state.candidates, evaluation]);
  const batch = state.documents.length > 1;
  const current = view === "summary" && batch ? "summary" : state.documents.find(d => d.key === view)?.key || (batch ? "summary" : state.documents[0]?.key);
  const document = state.documents.find(d => d.key === current);
  const fields = state.candidates[0]?.template.fields || [];
  const labelFor = candidate => state.mode === "models" ? candidate.model || `Candidate ${state.candidates.indexOf(candidate) + 1}` : candidate.template.name;
  // The selected document's view of each candidate: its pair status plus the displayed result details.
  const shown = pair => pair?.result || pair?.previous || null;
  const viewCandidates = document ? state.candidates.map(candidate => {
    const pair = state.pairs[document.key]?.[candidate.id], record = shown(pair);
    const detail = record && evaluation.detail(record.recordId);
    const unavailable = record && record === pair.result && pair.detail === "unavailable";
    return { ...candidate, status: pair?.status || "idle", attempt: pair?.attempt, message: pair?.message || "", cleanup: pair?.cleanup, previousShown: !pair?.result && !!pair?.previous,
      detailState: !record ? null : unavailable ? "unavailable" : detail ? "ready" : "loading", result: record && detail && !unavailable ? { ...record, raw: detail.raw, values: detail.values } : null };
  }) : [];
  const visibleKey = viewCandidates.filter(c => c.detailState && c.detailState !== "unavailable").map(c => shown(state.pairs[document.key][c.id]).recordId).join("|");
  // Only the open document's details are decrypted; the summary and other tabs use compact metrics.
  useEffect(() => { if (evaluation.hydrate) evaluation.hydrate(visibleKey ? visibleKey.split("|") : []); }, [visibleKey, evaluation]);
  const summary = batch && current === "summary" ? batchSummary(state.documents, state.candidates, state.pairs, documentRunnable) : null;
  const runnable = state.documents.filter(documentRunnable);
  const busyFor = candidateId => Object.values(state.pairs).some(byCandidate => pairBusy(byCandidate[candidateId]));
  const anyBusy = state.candidates.some(c => busyFor(c.id));
  const unsaved = state.documents.filter(d => d.kind === "upload" || documentDirty(d)).length;

  const selectDocuments = files => {
    setDragActive(false);
    if (!files.length) return;
    const valid = files.filter(file => SOURCE_FILE_MIME_TYPES.includes(file.type) && file.size <= maxSourceFileBytes);
    const problem = files.some(file => !SOURCE_FILE_MIME_TYPES.includes(file.type)) ? "Choose a PDF, PNG, JPG or WEBP document." : files.some(file => file.size > maxSourceFileBytes) ? "Document exceeds the Workspace file limit." : "";
    if (valid.length) evaluation.addUploads(valid);
    setLocalError(problem ? `${problem}${valid.length ? ` Added ${valid.length} other ${valid.length === 1 ? "document" : "documents"}.` : ""}` : "");
    if (!problem) setUploadOpen(false);
  };
  const loadTemplate = useCallback(async (id, fieldVersion) => {
    const template = await (await api(`/evaluations/templates/${encodeURIComponent(id)}${fieldVersion ? `?version=${fieldVersion}` : ""}`)).json();
    const tested = Number(fieldVersion || template.current_version);
    return { ...template, source: { id, version: tested }, name: `${template.name} · fields v${tested}` };
  }, [api]);
  const startEvaluation = async ({ mode, templateId: id, versions, models, runNow }) => {
    const owner = lifetime.current;
    setLocalError("");
    try {
      const loaded = await Promise.all(versions.map(v => loadTemplate(id, v)));
      if (owner !== lifetime.current) return;
      const chosen = mode === "templates" && loaded.length === 1 ? [loaded[0], loaded[0]] : loaded;
      const ids = evaluation.start(mode, mode === "models" ? models.map(model => ({ template: loaded[0], model })) : chosen.map(template => ({ template })));
      if (runNow) setAutoRun(ids);
    } catch (error) { if (owner === lifetime.current) setLocalError(error.message); }
  };
  const replaceTemplate = async () => {
    if (!templateId) return;
    const owner = lifetime.current;
    setLoading(true); setLocalError("");
    try {
      const selected = await loadTemplate(templateId, version);
      if (owner !== lifetime.current) return;
      edit(replacement, { template: selected }); setReplacement(null);
    } catch (error) { if (owner === lifetime.current) setLocalError(error.message); }
    finally { if (owner === lifetime.current) setLoading(false); }
  };
  const openEditor = (candidate, save = false) => setEditor({ candidateId: candidate.id, save, initial: { ...candidate.template, name: save ? `${candidate.template.name} copy` : candidate.template.name }, notice: save && Object.values(state.pairs).some(p => { const tested = shown(p[candidate.id]); return tested && tested.revision !== candidate.revision; }) ? "These current edits have not been tested. Saving creates a new Template." : save ? "Creates a new Template from the current draft." : "Changes apply to the draft. Run again to test them." });
  const modifiedSource = source => source ? { ...source, modified: true } : undefined;
  const applyTemplate = async payload => {
    if (editor.save) {
      await api("/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setNotice("New Template saved. Your Evaluation draft and original Template are unchanged.");
      await onTemplateSaved?.();
    } else if (state.mode === "models") {
      patch({ candidates: state.candidates.map(c => ({ ...c, template: { ...structuredClone(payload), source: modifiedSource(c.template.source) }, revision: c.revision + 1 })) });
    } else edit(editor.candidateId, { template: { ...payload, source: modifiedSource(state.candidates.find(c => c.id === editor.candidateId).template.source) } });
  };
  // In Template mode, input settings are shared by every candidate.
  const setInput = (candidate, key, value) => state.mode === "models" ? edit(candidate.id, { [key]: value }) : patch({ candidates: state.candidates.map(c => ({ ...c, [key]: value, revision: c.revision + 1 })) });
  const menuFor = candidate => ({ inputs: { shared: state.mode === "templates" }, onInputChange: (key, value) => setInput(candidate, key, value), actions: [
    { label: "Edit Template", onClick: () => openEditor(candidate) },
    state.mode === "templates" && { label: "Choose another Template/version", onClick: () => { setReplacement(candidate.id); setTemplateId(""); setVersion(""); } },
    { label: "Save as new Template", onClick: () => openEditor(candidate, true) },
    { label: "Duplicate candidate", disabled: state.candidates.length >= MAX_CANDIDATES, onClick: () => evaluation.duplicate(candidate.id) },
    { label: "Remove candidate", danger: true, disabled: state.candidates.length <= 1 || busyFor(candidate.id), onClick: () => evaluation.remove(candidate.id) },
  ] });
  const runFor = (candidate, index) => ({ label: `Run Candidate ${index + 1}`, title: batch ? "Run candidate on this document" : "Run candidate", disabled: pairBusy(state.pairs[document.key]?.[candidate.id]) || !documentRunnable(document) || !candidate.model.trim() || state.stale, onClick: () => evaluation.run([candidate.id], [document.key]) });
  const runDisabled = !state.candidates.length || !runnable.length || anyBusy || state.stale || state.candidates.some(c => !c.model.trim());
  const addCandidate = () => evaluation.duplicate(state.candidates.at(-1).id);
  const open = (kind, extra = {}) => setDialog({ kind, ...extra });
  const dialogDocument = dialog?.key && state.documents.find(d => d.key === dialog.key);
  const dialogFields = dialog?.fields || fields;
  const compatibility = document && documentCompatibility(document, fields);
  const fullyVerified = state.documents.filter(d => { const c = documentCompatibility(d, fields); return c.total && c.verified === c.total; }).length;
  const bestNames = summary?.best.map(id => labelFor(state.candidates.find(c => c.id === id))).join(", ");

  return <section className="evaluations-page" aria-label="Evaluations">
    <WorkspaceToolbar activePage="evaluations" workspaceLabel={workspaceLabel} pageTitle="Evaluations"
      pageDescription="Compare candidates on one or more documents. Runs and results are temporary and clear when you close this tab; saved documents and their answers stay in the Workspace library."
      actions={<><button type="button" className="secondary" onClick={() => open("clear")}>Clear Evaluation{unsaved ? ` · ${unsaved} unsaved` : ""}</button>
        <button type="button" disabled={runDisabled} onClick={() => evaluation.run(state.candidates.map(c => c.id))}>{`Run all${state.candidates.length ? ` ${state.candidates.length}` : ""}${batch && state.candidates.length ? ` × ${runnable.length}` : ""}`}</button></>} />
    {notice && <p role="status" className="evaluation-notice">{notice} <button type="button" className="studio-text-button" onClick={() => setNotice("")}>Dismiss</button></p>}
    {state.cacheError && <div role="alert" className="evaluation-banner bad evaluation-cache-error"><span><strong>Result details couldn’t be kept in this browser.</strong> {state.cacheError.message} New runs are paused; results already shown are kept, and missing details are left out of summaries.</span>
      <button type="button" className="studio-text-button" onClick={() => evaluation.retryCache()}>Retry storage</button><button type="button" className="studio-text-button" onClick={() => open("clear")}>Clear Evaluation</button></div>}
    {!state.candidates.length ? <EvaluationSetup state={state} templates={templates} enabled={enabled} maxSourceFileBytes={maxSourceFileBytes} suggestedModels={suggestedModels}
      error={!uploadOpen ? state.error || localError : ""} loadTemplate={loadTemplate} onSelectDocuments={selectDocuments} onRemoveDocument={evaluation.removeDocument} onPreviewDocument={setPreview} onStart={startEvaluation}
      onOpenAnswers={(d, setupFields) => open("answers", { key: d.key, fields: setupFields })} onSave={(key, setupFields) => open("save", { key, fields: setupFields })} onUpdate={key => open("update", { key })}
      onChooseLibrary={setupFields => open("picker", { fields: setupFields })} onManageLibrary={setupFields => open("manage", { fields: setupFields })} /> : <>
      {(state.error || localError) && !uploadOpen && <p role="alert" className="evaluation-page-alert">{state.error || localError}</p>}
      <div className="evaluation-contextbar">
        <div className="evaluation-context-item"><small>{batch ? "Documents" : "Document"}</small>
          <span className="evaluation-context-value" title={batch ? undefined : state.documents[0]?.name}>{batch ? `${state.documents.length} documents${state.documents.filter(d => d.kind === "upload").length ? ` · ${state.documents.filter(d => d.kind === "upload").length} not saved` : ""}` : state.documents[0]?.name || "No document"}</span>
          <span className="evaluation-context-actions">{document && <button type="button" className="studio-text-button" onClick={() => setPreview(document)}>View ↗</button>}
            <button type="button" className="studio-text-button" onClick={() => open("picker")}>Add from library</button>
            <button type="button" className="studio-text-button" onClick={() => setUploadOpen(true)}>Upload document</button>
            <button type="button" className="studio-text-button" onClick={() => open("manage")}>Manage library</button></span></div>
        <div className="evaluation-context-item"><small>Comparing</small>
          <div className="evaluation-segmented" role="group" aria-label="Comparison mode">{[["models", "Models"], ["templates", "Templates"]].map(([mode, label]) => <button key={mode} type="button" disabled={anyBusy} aria-pressed={state.mode === mode} onClick={() => evaluation.changeMode(mode)}>{label}</button>)}</div></div>
        {state.mode === "models"
          ? <div className="evaluation-context-item"><small>Shared Template</small><span className="evaluation-context-value" title={state.candidates[0].template.name}>{state.candidates[0].template.name} · {fields.length} {fields.length === 1 ? "field" : "fields"}</span>
            <span className="evaluation-context-actions"><button type="button" className="studio-text-button" onClick={() => openEditor(state.candidates[0])}>Edit shared Template</button></span></div>
          : <div className="evaluation-context-item"><small>Shared model</small><input aria-label="Shared model" value={state.candidates[0].model} onChange={event => patch({ candidates: state.candidates.map(c => ({ ...c, model: event.target.value, revision: c.revision + 1 })) })} /></div>}
        <div className="evaluation-context-item evaluation-context-progress"><small>Expected answers</small>
          {document ? <><span className="evaluation-context-value">{compatibility.verified} of {compatibility.total} verified{compatibility.review ? ` · ${compatibility.review} review` : ""}</span><Meter value={compatibility.total ? compatibility.verified / compatibility.total : 0} best /></>
            : <><span className="evaluation-context-value">{fullyVerified} of {state.documents.length} documents fully verified</span><Meter value={state.documents.length ? fullyVerified / state.documents.length : 0} best /></>}</div>
      </div>
      {batch && <div className="evaluation-toolbar-row evaluation-doc-tabs">
        <div className="evaluation-filter" role="tablist" aria-label="Documents">
          <button type="button" role="tab" aria-selected={current === "summary"} onClick={() => setView("summary")}>Batch summary</button>
          {state.documents.map(d => <button key={d.key} type="button" role="tab" aria-selected={current === d.key} onClick={() => setView(d.key)}><i className={`evaluation-dot ${documentTone(d)}`} aria-hidden="true" />{d.name}</button>)}
        </div>
        <small className="evaluation-muted">{current === "summary" ? "Each document counts equally. Open a document to verify answers and inspect fields." : "Scores for this document use its own Expected answers."}</small>
      </div>}
      {document && <DocumentBanner evaluation={evaluation} document={document} onSave={key => open("save", { key })} onUpdate={key => open("update", { key })} onNotice={setNotice} />}
      {summary ? <>
        <p className={`evaluation-summary-note ${summary.best.length ? "good" : ""}`} role="status">{summary.best.length ? `${summary.best.length > 1 ? "Tied best" : "Best"}: ${bestNames} — same documents and verified fields; ranked by field accuracy, then table cells, then time.` : summary.reason}</p>
        <div className="evaluation-body"><ScrollArea className="evaluation-comparison-scroll" tabIndex={0} role="region" aria-label="Batch summary">
          <BatchSummary evaluation={evaluation} summary={summary} fields={fields} menuFor={menuFor} onOpenDocument={setView} onAddCandidate={addCandidate} />
        </ScrollArea></div>
      </> : document ? <DocumentMatrix key={`${state.id}:${document.key}`} evaluation={evaluation} document={document} candidates={viewCandidates} batch={batch} labelFor={labelFor} menuFor={menuFor} runFor={runFor} onAddCandidate={addCandidate} />
        : <div className="evaluation-dropzone"><span className="evaluation-dropzone-icon" aria-hidden="true">▤</span><div><strong>Add a document to compare</strong><small>Choose saved documents or upload new ones. Candidates run on every document.</small></div>
          <span className="evaluation-actions"><button type="button" onClick={() => open("picker")}>Choose from library</button><button type="button" className="secondary" onClick={() => setUploadOpen(true)}>Upload new</button></span></div>}
    </>}
    {uploadOpen && <ModalDialog label="Upload evaluation document" onClose={() => { setUploadOpen(false); setLocalError(""); }}><div className="evaluation-heading"><h2>Upload documents</h2><button className="secondary" onClick={() => { setUploadOpen(false); setLocalError(""); }}>Close</button></div>
      <DocumentUploadPanel label="Document" multiple maxSourceFileBytes={maxSourceFileBytes} isDragActive={isDragActive} onSelectSourceFiles={selectDocuments} onDragOver={() => setDragActive(true)} onDragLeave={() => setDragActive(false)} onDrop={event => selectDocuments(Array.from(event.dataTransfer.files || []))} />
      {localError && <p role="alert">{localError}</p>}
    </ModalDialog>}
    {replacement && <ModalDialog label="Choose candidate Template" onClose={() => setReplacement(null)}><h2>Choose candidate Template</h2><label>Template<select value={templateId} disabled={loading} onChange={event => { setTemplateId(event.target.value); setVersion(""); }}><option value="" disabled>Choose a Template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Field version<select value={version} disabled={!templates.find(t => t.id === templateId) || loading} onChange={event => setVersion(event.target.value)}><option value="">{templates.find(t => t.id === templateId) ? `Current · v${templates.find(t => t.id === templateId).current_version}` : "Select a Template first"}</option>{Array.from({ length: Math.max(0, (templates.find(t => t.id === templateId)?.current_version || 1) - 1) }, (_, index) => <option key={index} value={index + 1}>Fields v{index + 1}</option>)}</select></label>
      <div className="actions"><button className="secondary" onClick={() => setReplacement(null)}>Cancel</button><button disabled={!templateId || loading} onClick={replaceTemplate}>{loading ? "Loading…" : "Replace candidate Template"}</button></div>{localError && <p role="alert">{localError}</p>}
    </ModalDialog>}
    {editor && <TemplateEditorModal key={`${editor.candidateId}:${editor.save}`} {...editor} title={editor.save ? "Save as new Template" : "Edit Template"} action={editor.save ? "Save new Template" : "Apply changes"} onSubmit={applyTemplate} onClose={() => setEditor(null)} />}
    {dialog?.kind === "picker" && <LibraryPicker evaluation={evaluation} fields={dialogFields} onClose={() => setDialog(null)} />}
    {dialog?.kind === "manage" && <ManageLibrary evaluation={evaluation} fields={dialogFields} onClose={() => setDialog(null)} />}
    {dialog?.kind === "clear" && <ClearDialog evaluation={evaluation} onClose={() => setDialog(null)} />}
    {dialog?.kind === "save" && dialogDocument && <SaveDialog evaluation={evaluation} document={dialogDocument} fields={dialogFields} onSaved={setNotice} onClose={() => setDialog(null)} />}
    {dialog?.kind === "update" && dialogDocument?.entry && <UpdateReview evaluation={evaluation} document={dialogDocument} onDone={setNotice} onClose={() => setDialog(null)} />}
    {dialog?.kind === "answers" && dialogDocument && <AnswersDialog evaluation={evaluation} document={dialogDocument} fields={dialogFields} onClose={() => setDialog(null)} onSave={key => open("save", { key, fields: dialogFields })} onUpdate={key => open("update", { key })} />}
    {preview && <DocumentPreview evaluation={evaluation} document={preview} onClose={() => setPreview(null)} />}
  </section>;
}
