import React, { useMemo, useRef } from "react";
import { diagnoseTemplateDraft, identityImpacts, previewRows } from "../../../../shared/templateAssistant.ts";
import { getDataTypeLabel } from "./templateFields.js";
import { MagicIcon } from "./MagicIcon.jsx";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import "./TemplateAssistant.css";

const TABS = [
  { id: "explain", label: "Explain issues" },
  { id: "edit", label: "Propose edits" },
];
const OBSERVATION_LISTS = [
  { kind: "observation", tone: "observed", label: "Observed", title: "In the evidence", hint: "What the supplied result or sample shows. Results are model output, not verified answers." },
  { kind: "hypothesis", tone: "hypothesis", label: "Hypothesis", title: "Possible causes", hint: "The model’s inferences. Not verified against the Document." },
  { kind: "suggestion", tone: "suggestion", label: "Suggestion", title: "Suggestions", hint: "Advice only. No change promises better accuracy without an Evaluation." },
];

const displayType = value => value === null || value === undefined ? null : getDataTypeLabel(value);
const display = value => value === null || value === undefined ? null : typeof value === "object" ? JSON.stringify(value) : String(value);
const formatBytes = bytes => bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
const formatDate = value => value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const truncate = (text, length) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
const jobName = job => job.original_filename || job.job_id;

export function TemplateAssistant({ assistant, draft, issues = [], isEditing = false, isDirty = false }) {
  if (!assistant?.isOpen) return null;
  const { action, pending, response, applied } = assistant;
  return <aside className="template-assistant" aria-label="Template assistant">
    <header className="template-assistant-head">
      <div><p className="studio-eyebrow">Template</p><h2>Assistant</h2></div>
      <button type="button" className="modal-close" aria-label="Close assistant" title="Close" onClick={assistant.onClose}>×</button>
    </header>
    <div className="template-assistant-tabs" role="tablist" aria-label="Assistant mode">
      {TABS.map(tab => <button key={tab.id} type="button" role="tab" id={`template-assistant-tab-${tab.id}`} aria-selected={action === tab.id}
        aria-controls="template-assistant-body" disabled={pending && action !== tab.id} onClick={() => action !== tab.id && assistant.onActionChange(tab.id)}>
        {tab.label}
        {tab.id === "explain" && issues.length ? <span className="template-assistant-count">{issues.length}</span> : null}
      </button>)}
    </div>
    <ScrollArea id="template-assistant-body" className="template-assistant-body" role="tabpanel" aria-labelledby={`template-assistant-tab-${action}`} tabIndex={0}>
      {pending ? <PendingView assistant={assistant} />
        : response ? <ResultView assistant={assistant} />
          : applied ? <AppliedView />
            : <ComposeView assistant={assistant} draft={draft} issues={issues} isEditing={isEditing} isDirty={isDirty} />}
    </ScrollArea>
    <footer className="template-assistant-foot"><FooterActions assistant={assistant} issues={issues} /></footer>
    {assistant.picker.isOpen ? <JobPicker picker={assistant.picker} selectedJobId={assistant.job?.job_id} /> : null}
  </aside>;
}

function ComposeView({ assistant, draft, issues, isEditing, isDirty }) {
  const fileInput = useRef(null);
  const { action, instructions, file, job, useRetainedSource, error, stale } = assistant;
  const binary = useRetainedSource ? "job_source" : file ? "upload" : "none";
  const binaryOptions = [
    { id: "none", label: job ? "Result only" : "No file", enabled: true },
    ...(job ? [{ id: "job_source", label: "Job’s original", enabled: job.source_available }] : []),
    ...(file ? [{ id: "upload", label: "Uploaded sample", enabled: true }] : []),
  ];
  const chooseBinary = id => {
    if (id === "job_source") assistant.onRetainedSourceChange(true);
    else if (id === "none") { assistant.onRetainedSourceChange(false); if (file) assistant.onFileChange(null); }
  };
  return <div className="template-assistant-stack template-assistant-fade-in">
    {stale ? <div className="template-assistant-note warn" role="status">
      <strong>The draft changed while this was running</strong>
      <p>The response was for an earlier version of the draft, so it was set aside. Nothing was applied. Send the request again to get a proposal for the draft as it is now.</p>
    </div> : null}
    {error ? <div className="template-assistant-note bad" role="alert"><strong>{error}</strong><p>Your draft wasn’t changed.</p></div> : null}
    <p className="template-assistant-muted">
      {action === "explain"
        ? "Get a plain-language explanation of what’s wrong or why results look the way they do. Nothing in your draft changes."
        : "Describe a change. You’ll see each proposed edit before anything changes, and only the ones you pick are applied to the draft."}
    </p>
    <label className="template-assistant-label">
      {action === "explain" ? "What would you like explained? (optional)" : "Describe your change"}
      <textarea rows={3} value={instructions}
        placeholder={action === "explain" ? "Ask about a field, a problem or a result" : "Describe what to add, rename, remove or clarify"}
        onChange={event => assistant.onInstructionsChange(event.target.value)} />
    </label>
    <SuggestionCards suggestions={assistant.suggestions} selected={instructions} onPick={assistant.onInstructionsChange} />

    <section className="template-assistant-section" aria-label="Evidence">
      <div className="template-assistant-section-head"><h3>Evidence <span>optional</span></h3></div>
      {job ? <div className="template-assistant-evidence-card">
        <div className="template-assistant-evidence-title">
          <div><strong>{jobName(job)}</strong><span>{job.job_id}</span></div>
          <button type="button" className="studio-text-button studio-destructive" onClick={assistant.onRemoveJob}>Remove</button>
        </div>
        <p>
          Extracted with <strong>{job.template_name || job.template_id} v{job.template_version}</strong>{" "}
          {job.template_id !== assistant.templateId ? <span className="status-chip warn">Different Template</span>
            : assistant.templateVersion && job.template_version !== assistant.templateVersion ? <span className="status-chip warn">Older version · latest is v{assistant.templateVersion}</span>
              : <span className="status-chip good">Latest saved version</span>}
        </p>
        <p className="template-assistant-muted">
          {job.template_id !== assistant.templateId ? "This result belongs to a different Template than the current draft."
            : assistant.templateVersion && job.template_version !== assistant.templateVersion ? `Version difference: this result used version ${job.template_version}; the current editor started from version ${assistant.templateVersion}.`
              : `The editor is an unsaved draft${assistant.templateVersion ? ` based on version ${assistant.templateVersion}` : ""}; its current edits may differ from the historical snapshot.`}
        </p>
        <details className="template-assistant-details">
          <summary>Historical fields and results</summary>
          <pre>{JSON.stringify({ fields: job.fields, results: job.results }, null, 2)}</pre>
        </details>
        <p className="template-assistant-muted">
          {job.source_available ? "Original Source file retained, so it can be sent with the result."
            : job.source_limitation || "The original Source file wasn’t kept. The stored result can still be explained, but the Document itself can’t be checked."}
        </p>
      </div> : <button type="button" className="secondary template-assistant-evidence-add" onClick={assistant.picker.onOpen}>Choose a completed Extraction job…</button>}

      {file ? <div className="template-assistant-evidence-card">
        <div className="template-assistant-evidence-title">
          <div><strong>{file.name}</strong><span>Sample · {formatBytes(file.size)}{job ? " · not linked to the selected result" : ""}</span></div>
          <button type="button" className="studio-text-button studio-destructive" onClick={() => assistant.onFileChange(null)}>Remove</button>
        </div>
      </div> : <>
        <input ref={fileInput} type="file" className="upload-input-hidden" tabIndex={-1} aria-label="Sample file" accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={event => { assistant.onFileChange(event.target.files?.[0] || null); event.target.value = ""; }} />
        <button type="button" className="secondary template-assistant-evidence-add" onClick={() => fileInput.current?.click()}>Attach a sample file (PDF, PNG, JPEG, WebP)…</button>
      </>}

      {job || file ? <div className="template-assistant-binary">
        <span className="template-assistant-label-text">File sent to the model (one at most)</span>
        <div className="segmented" role="radiogroup" aria-label="File sent to the model">
          {binaryOptions.map(option => <button key={option.id} type="button" role="radio" aria-checked={binary === option.id} disabled={!option.enabled}
            title={option.enabled ? undefined : "The original isn’t available for this job"} onClick={() => chooseBinary(option.id)}>{option.label}</button>)}
        </div>
      </div> : null}
    </section>

    <section className="template-assistant-section template-assistant-sent" aria-label="What will be sent">
      <div className="template-assistant-section-head"><h3>What will be sent</h3></div>
      <ul>
        <li><strong>Current draft</strong> {draft.name ? `“${draft.name}”` : "(untitled)"} · {draft.fields.length} fields · {isEditing ? (isDirty ? "unsaved changes" : "matches saved version") : "new, unsaved"}{issues.length ? ` · ${issues.length} problem${issues.length === 1 ? "" : "s"}` : ""}</li>
        <li><strong>Your request</strong> {instructions.trim() ? `“${truncate(instructions.trim(), 80)}”` : action === "explain" ? "General explanation" : "—"}</li>
        {job ? <li><strong>Stored result</strong> {jobName(job)}, with the v{job.template_version} fields it was extracted with</li> : null}
        <li><strong>File</strong> {binary === "job_source" ? `${jobName(job)} (the job’s original)` : binary === "upload" ? `${file.name} (uploaded sample)` : "None"}</li>
      </ul>
    </section>
  </div>;
}

function SuggestionCards({ suggestions, selected, onPick }) {
  const { status, source, items, notice } = suggestions;
  const isLoading = status !== "ready";
  return <section className="template-assistant-suggestions" aria-label="Suggestions" aria-busy={isLoading}>
    <div className="template-assistant-suggestions-head">
      <span className="template-assistant-label-text">Suggested for this Template</span>
      {!isLoading && source ? <span className={source === "model" ? "template-assistant-tag observed" : "template-assistant-tag"}>{source === "model" ? "From the model" : "From the app’s checks"}</span> : null}
    </div>
    {isLoading ? <div className="template-assistant-suggestion-skeletons" role="status" aria-label="Generating suggestions">
      {[0, 1, 2].map(index => <span key={index} className="template-assistant-skeleton" style={{ width: `${88 - index * 14}%` }} />)}
    </div> : <>
      {notice ? <p className="template-assistant-muted">{notice}</p> : null}
      {items.length ? <div className="template-assistant-suggestion-list">
        {items.map(suggestion => <button key={suggestion.id} type="button"
          className={selected === suggestion.request ? "template-assistant-suggestion selected" : "template-assistant-suggestion"}
          onClick={() => onPick(suggestion.request)}>
          <strong>{suggestion.label}</strong><span>{suggestion.reason}</span>
        </button>)}
      </div> : <p className="template-assistant-muted">No suggestions for this draft. Describe what you need above.</p>}
    </>}
  </section>;
}

function PendingView({ assistant }) {
  return <div className="template-assistant-stack template-assistant-fade-in">
    <RequestRecap assistant={assistant} />
    <div className="template-generation-progress" role="status">
      <span className="template-generation-spinner" aria-hidden="true" />
      <div>
        <strong>{assistant.action === "explain" ? "Reading your draft…" : "Drafting focused edits…"}</strong>
        <p>Analyzing draft revision {assistant.revision}. If you edit the draft before this finishes, the response will be set aside instead of applied.</p>
      </div>
    </div>
  </div>;
}

function ResultView({ assistant }) {
  const { response, stale, selectedIds, selection } = assistant;
  const checked = useMemo(() => diagnoseTemplateDraft(response.baseDraft), [response.baseDraft]);
  return <div className="template-assistant-stack template-assistant-fade-in">
    {stale ? <div className="template-assistant-note warn" role="alert">
      <strong>This proposal is out of date</strong>
      <p>You changed the draft after asking. The proposal below is read-only and can’t be applied, because it might overwrite your newer edits. Regenerate it from the current draft.</p>
      <div className="template-assistant-note-actions"><button type="button" onClick={assistant.onSubmit}>Regenerate</button></div>
    </div> : null}
    {assistant.error ? <p className="template-assistant-note bad" role="alert">{assistant.error}</p> : null}
    <RequestRecap assistant={assistant} onRevise={() => assistant.onInstructionsChange(assistant.instructions)} />

    <section className="template-assistant-section" aria-label="Explanation">
      <p className="template-assistant-summary">{response.explanation}</p>
      {checked.length ? <EvidenceList tone="checked" label="Checked" title="Checked by the app" hint="Validation rules for the draft you sent. These are certain."
        items={checked.map(issue => ({ text: `${issue.title}. ${issue.remedy}` }))} /> : null}
      {OBSERVATION_LISTS.map(list => {
        const items = response.observations.filter(observation => observation.kind === list.kind);
        return items.length ? <EvidenceList key={list.kind} {...list} items={items} /> : null;
      })}
    </section>

    {response.groups.length ? <section className={stale ? "template-assistant-section template-assistant-is-stale" : "template-assistant-section"} aria-label="Proposed changes">
      <div className="template-assistant-section-head"><h3>Proposed changes <span>{response.groups.length}</span></h3></div>
      <p className="template-assistant-muted">Pick the changes you want. Changes inside one card are applied together.</p>
      <div className="template-assistant-groups">
        {response.groups.map(group => <ChangeGroup key={group.id} base={response.baseDraft} group={group} groups={response.groups} disabled={stale}
          selected={selectedIds.has(group.id)} isConflicting={selection?.conflicting?.some(entry => entry.id === group.id)}
          onToggle={() => assistant.onToggleGroup(group.id)} />)}
      </div>
      {!stale && selection ? <SelectionCheck selection={selection} baseHadIssues={checked.length > 0} /> : null}
    </section> : null}
  </div>;
}

function EvidenceList({ tone, label, title, hint, items }) {
  return <div className={`template-assistant-evidence-list ${tone}`}>
    <div className="template-assistant-evidence-list-head"><span className={`template-assistant-tag ${tone}`}>{label}</span><strong>{title}</strong></div>
    <p className="template-assistant-muted">{hint}</p>
    <ul>{items.map((item, index) => <li key={index}>{item.text}</li>)}</ul>
  </div>;
}

function ChangeGroup({ base, group, groups, selected, disabled, isConflicting, onToggle }) {
  const rows = previewRows(base, group);
  const impacts = identityImpacts(base, group);
  const id = `template-assistant-group-${group.id}`;
  const requires = group.dependsOn.map(dependency => groups.find(entry => entry.id === dependency)?.title || dependency);
  return <article className={`template-assistant-group${selected ? " selected" : ""}${isConflicting ? " conflicting" : ""}`} aria-labelledby={id}>
    <label className="template-assistant-group-head">
      <input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} />
      <span>
        <strong id={id}>{group.title}</strong>
        <span className="template-assistant-group-tags">
          {group.operations.length > 1 ? <span className="status-chip">{group.operations.length} changes · applied together</span> : null}
          {impacts.some(impact => impact.kind !== "added") ? <span className="status-chip warn">Changes output keys</span> : null}
        </span>
      </span>
    </label>
    <p className="template-assistant-rationale">{group.rationale}</p>
    <table className="template-assistant-diff">
      <thead><tr><th scope="col">Where</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>{rows.map((row, index) => {
        const format = row.property === "Type" ? displayType : display;
        const before = format(row.before);
        const after = format(row.after);
        return <tr key={index} className={`template-assistant-diff-row ${row.kind}`}>
          <th scope="row"><span>{row.target}</span><em>{row.property}</em></th>
          <td className="before">{before === null ? <span className="template-assistant-empty">—</span> : <del>{before}</del>}</td>
          <td className="after">{after === null ? <span className="template-assistant-empty">Removed</span> : <ins>{after}</ins>}</td>
        </tr>;
      })}</tbody>
    </table>
    {impacts.length ? <IdentityImpacts impacts={impacts} /> : null}
    {requires.length ? <p className="template-assistant-dependency">Requires “{requires.join("”, “")}”.</p> : null}
    {isConflicting ? <p className="template-assistant-conflict">Conflicts with another selected change. Only one can be applied.</p> : null}
  </article>;
}

function IdentityImpacts({ impacts }) {
  const breaking = impacts.filter(impact => impact.kind !== "added");
  return <div className={breaking.length ? "template-assistant-identity warn" : "template-assistant-identity"}>
    <strong>Output keys</strong>
    <ul>{impacts.map((impact, index) => <li key={index}>
      {impact.kind === "added" ? <>New key <code className="ins">{impact.after}</code></> : null}
      {impact.kind === "removed" ? <>No longer extracted <code className="del">{impact.before}</code></> : null}
      {impact.kind === "renamed" ? <>Renamed <code className="del">{impact.before}</code> → <code className="ins">{impact.after}</code></> : null}
      {impact.kind === "retyped" ? <><code>{impact.before}</code> becomes {displayType(impact.to)} (was {displayType(impact.from)})</> : null}
    </li>)}</ul>
    {breaking.length
      ? <p>Future results use the new keys. Results already extracted are unchanged, and Evaluation Expected answers saved under the old keys won’t be relinked.</p>
      : <p>Future results gain these keys. Earlier results won’t have them.</p>}
  </div>;
}

function SelectionCheck({ selection, baseHadIssues }) {
  if (selection.dependencyErrors?.length) {
    return <div className="template-assistant-check bad" role="alert"><ul>{selection.dependencyErrors.map((message, index) => <li key={index}>{message}</li>)}</ul></div>;
  }
  if (!selection.selected.length) {
    return <p className="template-assistant-check neutral">Nothing selected.{baseHadIssues ? " Your draft still has problems that stop it saving." : ""}</p>;
  }
  if (selection.conflicting?.length) {
    return <p className="template-assistant-check bad" role="alert">Two selected changes edit the same thing. Unselect one to continue.</p>;
  }
  if (selection.errors.length) {
    return <div className="template-assistant-check bad" role="alert">
      <strong>With this selection the draft still wouldn’t save:</strong>
      <ul>{selection.errors.slice(0, 4).map(issue => <li key={issue.id}>{issue.title}</li>)}</ul>
      {selection.errors.length > 4 ? <span>and {selection.errors.length - 4} more</span> : null}
    </div>;
  }
  return <p className="template-assistant-check good">The result passes the same checks as Save.</p>;
}

function AppliedView() {
  return <div className="template-assistant-stack template-assistant-fade-in">
    <div className="template-assistant-note good" role="status">
      <strong>Applied to your draft</strong>
      <p>Nothing has been saved. Review the draft, then use Save when you’re ready. This proposal is used up and can’t be applied again.</p>
    </div>
  </div>;
}

function FooterActions({ assistant, issues }) {
  const { action, pending, response, applied, stale, selection } = assistant;
  const revise = () => assistant.onInstructionsChange(assistant.instructions);
  let actions;
  if (pending) {
    actions = <button type="button" className="secondary" onClick={assistant.onCancelRequest}>Cancel request</button>;
  } else if (response) {
    const count = selection?.selected.length || 0;
    actions = response.groups.length ? <>
      <button type="button" className="secondary" onClick={revise}>Revise request</button>
      <button type="button" className="secondary" onClick={assistant.onClose}>Discard</button>
      <button type="button" disabled={stale || !selection?.canApply} onClick={assistant.onApply}>
        {count ? `Apply ${count} change${count === 1 ? "" : "s"} to draft` : "Apply to draft"}
      </button>
    </> : <>
      <button type="button" className="secondary" onClick={revise}>Ask something else</button>
      {action === "explain" && issues.length ? <button type="button" className="studio-generate-button" onClick={() => { assistant.onActionChange("edit"); assistant.onInstructionsChange("Fix the draft’s problems so the Template can save"); }}><MagicIcon />Propose fixes</button> : null}
    </>;
  } else if (applied) {
    actions = <>
      <button type="button" className="secondary" onClick={assistant.onClose}>Close</button>
      <button type="button" onClick={() => assistant.onInstructionsChange("")}>New request</button>
    </>;
  } else {
    const canSend = action === "explain" || assistant.instructions.trim();
    actions = <>
      <button type="button" className="secondary" onClick={assistant.onClose}>Cancel</button>
      <button type="button" className="studio-generate-button" disabled={!canSend} onClick={assistant.onSubmit}>
        <MagicIcon />{assistant.error || stale ? "Try again" : action === "explain" ? "Explain" : "Propose edits"}
      </button>
    </>;
  }
  return <>
    <div className="template-assistant-foot-actions">{actions}</div>
    {response?.groups.length ? <p className="template-assistant-foot-hint">Applies to the draft only. Saving stays a separate step.</p> : null}
  </>;
}

function RequestRecap({ assistant, onRevise }) {
  const { action, instructions, job, file, useRetainedSource, templateVersion } = assistant;
  const versionNote = job && templateVersion && job.template_id === assistant.templateId && job.template_version !== templateVersion ? `; this draft started from v${templateVersion}` : "";
  const evidence = [
    job ? `Result: ${jobName(job)} (v${job.template_version}${versionNote})` : null,
    useRetainedSource ? "File: job’s original" : file ? `File: ${file.name}` : job ? "No file sent" : null,
  ].filter(Boolean).join(" · ");
  return <div className="template-assistant-recap">
    <div>
      <span className="template-assistant-label-text">{action === "explain" ? "You asked for an explanation" : "You asked for edits"}</span>
      <p>{instructions.trim() ? `“${instructions.trim()}”` : action === "explain" ? "General explanation of the draft" : "Fix the draft’s problems"}</p>
      <p className="template-assistant-muted">{evidence || "No evidence attached"}</p>
    </div>
    {onRevise ? <button type="button" className="studio-text-button" onClick={onRevise}>Revise</button> : null}
  </div>;
}

function JobPicker({ picker, selectedJobId }) {
  return <ModalDialog label="Choose a completed Extraction job" className="template-assistant-picker" onClose={picker.onClose}>
    <ModalHeader title="Choose a completed Extraction job"
      description="Its stored result, and the Template version it was extracted with, are sent as evidence. All completed jobs in this Workspace are listed."
      onClose={picker.onClose} closeLabel="Close job picker" />
    {picker.error ? <p role="alert" className="form-error">{picker.error}</p> : null}
    <div className={picker.loading ? "template-assistant-job-table is-loading" : "template-assistant-job-table"} aria-busy={picker.loading}>
      <table>
        <thead><tr><th scope="col">Document</th><th scope="col">Completed</th><th scope="col">Template used</th><th scope="col">Source</th><th scope="col"><span className="upload-input-hidden">Action</span></th></tr></thead>
        <tbody>
          {picker.jobs.map(job => <tr key={job.job_id} className={job.job_id === selectedJobId ? "selected" : undefined}>
            <th scope="row"><strong>{jobName(job)}</strong><span>{job.job_id}</span></th>
            <td>{formatDate(job.completed_at)}</td>
            <td>{job.template_name || job.template_id} <span className="template-assistant-version">v{job.template_version}</span></td>
            <td><span className={job.source_available ? "status-chip good" : "status-chip"}>{job.source_available ? "Original kept" : "Results only"}</span></td>
            <td><button type="button" className="secondary" disabled={picker.loading} onClick={() => picker.onChoose(job.job_id)}>{job.job_id === selectedJobId ? "Selected" : "Use"}</button></td>
          </tr>)}
          {!picker.loading && !picker.jobs.length ? <tr><td colSpan="5" className="template-assistant-muted">No completed Extraction jobs on this page.</td></tr> : null}
        </tbody>
      </table>
    </div>
    <div className="template-assistant-pager">
      <span>{picker.loading ? "Loading…" : `Page ${picker.page + 1}`}</span>
      <div className="actions compact">
        <button type="button" className="secondary" disabled={picker.loading || picker.page === 0} onClick={picker.onPrevious}>Previous</button>
        <button type="button" className="secondary" disabled={picker.loading || !picker.nextCursor} onClick={picker.onNext}>Next</button>
      </div>
    </div>
  </ModalDialog>;
}
