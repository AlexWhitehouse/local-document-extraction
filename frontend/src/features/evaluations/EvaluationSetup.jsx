import React, { useEffect, useRef, useState } from "react";
import { MAX_CANDIDATES, documentRunnable } from "./useEvaluations.js";
import { SOURCE_FILE_MIME_TYPES } from "../../lib/runtimeConfiguration";
import { Chips } from "./EvaluationLibrary.jsx";
import { documentChips, kilobytes, saveUnavailableMessage, unavailableText } from "./evaluationLibrary.js";

const MODES = [
  { id: "models", title: "Models", summary: "One Template, different models", detail: "Find the most accurate or fastest model for this kind of document.", shape: ["T", ["M1", "M2", "M3"]] },
  { id: "templates", title: "Template versions", summary: "One model, different Templates", detail: "Check whether edited field instructions improve the results.", shape: ["M", ["v3", "v2", "v1"]] },
];
const mebibytes = bytes => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024));

function StepNumber({ number, complete }) {
  return <span className={complete ? "evaluation-step-complete" : undefined} title={complete ? "Complete" : "Incomplete"}>{number}<span className="evaluation-visually-hidden">{complete ? " complete" : " incomplete"}</span></span>;
}

// Setup for an empty or cleared Evaluation: everything needed for a first run on one screen.
// One document compares candidates on it; several run a Batch Evaluation with the same candidates.
export function EvaluationSetup({ state, templates, enabled, maxSourceFileBytes, suggestedModels = [], error, loadTemplate, onSelectDocuments, onRemoveDocument, onPreviewDocument, onChooseLibrary, onManageLibrary, onStart }) {
  const workspaceModel = state.setup?.model || "";
  const [mode, setMode] = useState(state.mode);
  const [templateId, setTemplateId] = useState("");
  const [version, setVersion] = useState("");
  const [versions, setVersions] = useState([]);
  const [models, setModels] = useState(() => [workspaceModel, ""]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [starting, setStarting] = useState(false);
  const input = useRef(null);
  const template = templates.find(t => t.id === templateId);
  const allVersions = template ? Array.from({ length: template.current_version || 1 }, (_, i) => (template.current_version || 1) - i) : [];
  // The Workspace model can arrive after the first render; use it as the first candidate.
  useEffect(() => { if (workspaceModel) setModels(previous => previous[0] ? previous : [workspaceModel, ...previous.slice(1)]); }, [workspaceModel]);
  useEffect(() => {
    if (!template) return undefined;
    let current = true;
    setPreview(null);
    loadTemplate(template.id, Number(version || template.current_version)).then(loaded => { if (current) setPreview(loaded); }).catch(() => { if (current) setPreview(null); });
    return () => { current = false; };
  }, [template, version, loadTemplate]);
  const chooseTemplate = id => {
    const next = templates.find(t => t.id === id);
    setTemplateId(id); setVersion("");
    setVersions(Array.from({ length: Math.min(2, next?.current_version || 1) }, (_, i) => (next?.current_version || 1) - i));
  };
  const names = models.map(model => model.trim()).filter(Boolean);
  const problems = [
    !state.setup?.configured && "Configure a model in Workspace settings",
    !template && "Choose a Template",
    mode === "models" ? names.length < 2 && "Add at least two models" : !versions.length && "Choose a version",
  ].filter(Boolean);
  const willRun = state.documents.some(documentRunnable);
  const saveUnavailable = saveUnavailableMessage(state.library);
  const suggestions = [...new Set([workspaceModel, ...suggestedModels].map(model => String(model || "").trim()).filter(Boolean))].filter(model => !names.includes(model)).slice(0, 6);
  const fields = preview?.fields || [];
  const tables = fields.filter(field => field.data_type === "array<object>").length;
  const start = async () => {
    setStarting(true);
    try { await onStart({ mode, templateId, versions: mode === "models" ? [Number(version || template.current_version)] : versions, models: names, runNow: willRun }); }
    finally { setStarting(false); }
  };
  const addSuggestion = model => {
    const empty = models.findIndex(value => !value.trim());
    setModels(empty >= 0 ? models.map((value, i) => i === empty ? model : value) : [...models, model]);
  };
  return <div className="evaluation-setup">
    <div className="evaluation-setup-main">
      <header className="evaluation-setup-head"><p className="studio-eyebrow">New Evaluation</p><h2>Compare extraction results on your documents</h2><p>Runs and results aren’t saved and clear when you close this tab. Documents you save to the Evaluation library can be reused.</p></header>
      {error && <p role="alert" className="evaluation-setup-error">{error}</p>}

      <section className="evaluation-setup-step" aria-labelledby="evaluation-step-document"><div className="evaluation-setup-label"><StepNumber number="01" complete={state.documents.length > 0} /><h3 id="evaluation-step-document">Documents</h3></div>
        <div className="evaluation-setup-body">
          {state.documents.length > 0 && <ol className="evaluation-setup-docs">{state.documents.map(document => {
            const chips = documentChips(document, fields);
            return <li key={document.key} className={`evaluation-setup-file ${documentRunnable(document) ? "" : "unrunnable"}`}>
              <button type="button" className="evaluation-setup-thumb" aria-label={`View ${document.name}`} onClick={() => onPreviewDocument(document)}><span>{(document.file?.type || document.entry?.mime_type || "").startsWith("image/") ? "IMG" : "PDF"}</span></button>
              <div className="evaluation-setup-file-info">
                <div className="evaluation-setup-file-row"><strong title={document.name}>{document.name}</strong><Chips list={chips.slice(0, 1)} /><button type="button" className="icon-action-button" aria-label={`Remove ${document.name}`} onClick={() => onRemoveDocument(document.key)}>×</button></div>
                <div className="evaluation-setup-file-row"><small title={document.file?.name || document.entry?.source_name}>{document.file?.name || document.entry?.source_name} · {kilobytes(document.file?.size ?? document.entry?.byte_size)} · {document.kind === "upload" ? "new upload" : "from library"}</small></div>
                {chips.length > 1 && <Chips list={chips.slice(1)} />}
                {!documentRunnable(document) && <p className="evaluation-bad-text">{unavailableText(document)}</p>}
              </div>
            </li>; })}</ol>}
          <div className={`evaluation-dropzone ${dragging ? "dragging" : ""} ${state.documents.length ? "compact" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); onSelectDocuments(Array.from(event.dataTransfer.files || [])); }}>
            <span className="evaluation-dropzone-icon" aria-hidden="true">▤</span>
            <div><strong>{state.documents.length ? "Add more documents" : "Choose saved documents or drop new ones here"}</strong><small>PDF, PNG, JPG or WEBP · up to {mebibytes(maxSourceFileBytes)} MiB each · several documents run a Batch Evaluation</small></div>
            <span className="evaluation-actions"><button type="button" onClick={() => onChooseLibrary(fields)}>Library</button><button type="button" className="secondary" onClick={() => input.current.click()}>Upload new</button></span>
          </div>
          <input ref={input} type="file" hidden multiple aria-label="Evaluation document" accept={SOURCE_FILE_MIME_TYPES.join(",")} onChange={event => { onSelectDocuments(Array.from(event.target.files || [])); event.target.value = ""; }} />
          {saveUnavailable && <p className="evaluation-setup-hint evaluation-warn-text">{saveUnavailable} New uploads can still be evaluated in this tab.</p>}
        </div>
      </section>

      <section className="evaluation-setup-step" aria-labelledby="evaluation-step-mode"><div className="evaluation-setup-label"><StepNumber number="02" complete={MODES.some(option => option.id === mode)} /><h3 id="evaluation-step-mode">What to compare</h3></div>
        <div className="evaluation-setup-body"><div className="evaluation-mode-cards" role="radiogroup" aria-labelledby="evaluation-step-mode">
          {MODES.map(item => <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} className="evaluation-mode-card" onClick={() => setMode(item.id)}>
            <span className="evaluation-mode-shape" aria-hidden="true"><i>{item.shape[0]}</i><b /><span>{item.shape[1].map(label => <i key={label}>{label}</i>)}</span></span>
            <span><strong>{item.title}</strong><em>{item.summary}</em><small>{item.detail}</small></span>
          </button>)}
        </div></div>
      </section>

      <section className="evaluation-setup-step" aria-labelledby="evaluation-step-template"><div className="evaluation-setup-label"><StepNumber number="03" complete={!!template} /><h3 id="evaluation-step-template">Template</h3></div>
        <div className="evaluation-setup-body">
          <div className="evaluation-setup-row">
            <label>Template<select value={templateId} onChange={event => chooseTemplate(event.target.value)}><option value="" disabled>{templates.length ? "Choose a saved Template" : "No saved Templates available"}</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            {mode === "models" && <label>Field version<select value={version} disabled={!template} onChange={event => setVersion(event.target.value)}><option value="">{template ? `Current · v${template.current_version}` : "Choose a Template first"}</option>{allVersions.slice(1).map(v => <option key={v} value={v}>Fields v{v}</option>)}</select></label>}
          </div>
          {template && <p className="evaluation-setup-hint">{preview ? `${fields.length} ${fields.length === 1 ? "field" : "fields"}${tables ? ` · ${tables} ${tables === 1 ? "table" : "tables"}` : ""}` : "Loading fields…"}{template.description ? ` · ${template.description}` : ""}</p>}
        </div>
      </section>

      <section className="evaluation-setup-step" aria-labelledby="evaluation-step-candidates"><div className="evaluation-setup-label"><StepNumber number="04" complete={mode === "models" ? names.length >= 2 : !!template && versions.length > 0} /><h3 id="evaluation-step-candidates">Candidates</h3></div>
        <div className="evaluation-setup-body">
          {mode === "models" ? <>
            <ol className="evaluation-setup-candidates">{models.map((model, index) => <li key={index}><span className="evaluation-index">{String(index + 1).padStart(2, "0")}</span>
              <input aria-label={`Candidate ${index + 1} model`} placeholder="Model name" value={model} onChange={event => setModels(models.map((value, i) => i === index ? event.target.value : value))} />
              {model.trim() && model.trim() === workspaceModel && <small className="status-chip">Workspace default</small>}
              <button type="button" className="icon-action-button" aria-label={`Remove candidate ${index + 1}`} disabled={models.length <= 1} onClick={() => setModels(models.filter((_, i) => i !== index))}>×</button></li>)}</ol>
            <div className="evaluation-setup-add"><button type="button" className="secondary" disabled={models.length >= MAX_CANDIDATES} onClick={() => setModels([...models, ""])}>+ Add model</button>
              {suggestions.length > 0 && <span className="evaluation-setup-suggest"><small>Used in this Workspace</small>{suggestions.map(model => <button key={model} type="button" className="evaluation-chip" disabled={names.length >= MAX_CANDIDATES} onClick={() => addSuggestion(model)}>+ {model}</button>)}</span>}</div>
          </> : !template ? <p className="evaluation-setup-hint">Choose a Template to pick the versions to compare.</p> : <>
            <div className="evaluation-version-list" role="group" aria-label="Template versions">{allVersions.map(v => <label key={v} className="evaluation-version"><input type="checkbox" checked={versions.includes(v)} disabled={!versions.includes(v) && versions.length >= MAX_CANDIDATES} onChange={event => setVersions(event.target.checked ? [...versions, v].sort((a, b) => b - a) : versions.filter(x => x !== v))} /><span><strong>Fields v{v}</strong><small>{v === template.current_version ? "Current" : `Version ${v}`}</small></span></label>)}</div>
            <p className="evaluation-setup-hint">{versions.length === 1 ? `Starts two copies of Fields v${versions[0]}. Edit one candidate's fields as a draft to compare the change.` : `Every version runs on the Workspace model${workspaceModel ? `, ${workspaceModel}` : ""}. You can edit a candidate's fields as a draft after starting.`}</p>
          </>}
        </div>
      </section>

      <footer className="evaluation-setup-foot">
        <div className="evaluation-setup-submit">{problems.length > 0 && <small className="evaluation-muted">{problems.join(" · ")}</small>}
          <button type="button" disabled={!enabled || problems.length > 0 || starting} onClick={start}>{starting ? "Loading…" : willRun ? "Start and run" : "Start Evaluation"}</button></div>
      </footer>
    </div>

    <aside className="evaluation-setup-aside" aria-label="How Evaluations work">
      <div className="evaluation-setup-model evaluation-library-box"><small>Evaluation library</small><p>Documents with Expected answers, shared with everyone in this Workspace.</p><button type="button" className="studio-text-button" onClick={() => onManageLibrary(fields)}>Manage library</button></div>
      {mode === "templates" && <div className="evaluation-setup-model"><small>Workspace model</small>{state.setup?.configured ? <><span><i aria-hidden="true" />{workspaceModel}</span><p>Every Template version runs on this model. Change it for all candidates after starting.</p></> : <p>No model is configured. Configure one in Workspace settings.</p>}</div>}
      <h3>How it works</h3>
      <ol className="evaluation-how">
        <li><span>1</span><div><strong>Choose documents</strong><p>Pick saved documents, upload new ones, or both. Up to {MAX_CANDIDATES} candidates run on every document.</p></div></li>
        <li><span>2</span><div><strong>Verify expected answers</strong><p>After a run, confirm the correct value for each field in the results, or use a candidate's answer. Saved documents bring their answers with them. Only verified fields are scored.</p></div></li>
        <li><span>3</span><div><strong>Compare</strong><p>See accuracy, table cells, time and tokens, one document at a time. Use Previous and Next to move between documents.</p></div></li>
      </ol>
      <p className="evaluation-setup-note">After verifying answers, choose Save to library on a new upload to reuse it in later Evaluations.</p>
    </aside>
  </div>;
}
