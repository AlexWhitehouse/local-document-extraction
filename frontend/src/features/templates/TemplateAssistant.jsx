import { isJsonObject } from "../../../../shared/json.ts";
import React, { useMemo, useRef } from "react";
import { diagnoseTemplateDraft, identityImpacts, previewRows } from "../../../../shared/templateAssistant.ts";
import { getDataTypeLabel } from "./templateFields.js";
import { pluralize } from "../../lib/text.js";
import { CloseIcon, EditIcon, MagicIcon } from "../layout/Icons.jsx";
import { ModalDialog, ModalHeader } from "../layout/ModalDialog.jsx";
import { ScrollArea } from "../layout/ScrollArea.jsx";
import "./TemplateAssistant.css";
import { Button, IconButton } from "../ui/Button.jsx";
import { Badge, CountBadge } from "../ui/Status.jsx";
import { Field, Textarea } from "../ui/Field.jsx";
import { DataTable } from "../ui/DataTable.jsx";
import { Pager } from "../ui/Pager.jsx";
import { Segmented, Tabs } from "../ui/Tabs.jsx";
import { Callout } from "../ui/Callout.jsx";

const TABS = [
  { value: "explain", label: "Explain problems" },
  { value: "edit", label: "Propose edits" },
];

const OBSERVATION_LISTS = [
  {
    kind: "observation",
    tone: "info",
    label: "Observed",
    title: "In the evidence",
  },
  {
    kind: "hypothesis",
    tone: "warning",
    label: "Hypothesis",
    title: "Possible causes",
  },
  {
    kind: "suggestion",
    tone: "neutral",
    label: "Suggestion",
    title: "Suggestions",
    hint: "Test changes with an evaluation.",
  },
];

const displayType = (value) => (value === null || value === undefined ? null : getDataTypeLabel(value));

const display = (value) =>
  value === null || value === undefined
    ? null
    : Array.isArray(value) || isJsonObject(value)
      ? JSON.stringify(value)
      : String(value);

const formatBytes = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

const truncate = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

const jobName = (job) => job.original_filename || job.job_id;

const failureCount = (evidence) => evidence.documents.reduce((sum, document) => sum + document.failures.length, 0);

/**
 * `allowJobs` hides the completed-document picker (the Evaluation editor is already a modal).
 * `applied` replaces the post-apply notice and adds actions, e.g. to test the changes on a copy.
 */
export function TemplateAssistant({
  assistant,
  draft,
  issues = [],
  isEditing = false,
  isDirty = false,
  allowJobs = true,
  applied: appliedView = null,
}) {
  if (!assistant?.isOpen) return null;
  const { action, pending, response, applied } = assistant;

  return (
    <aside className="template-assistant" aria-label="Template assistant">
      <header className="template-assistant-head">
        <div>
          <p className="studio-eyebrow">Template</p>
          <h2>Assistant</h2>
        </div>
        <IconButton label="Close assistant" icon={CloseIcon} onClick={assistant.onClose} />
      </header>
      <div className="template-assistant-tabs">
        <Tabs
          label="Assistant mode"
          idPrefix="template-assistant"
          items={TABS.map((tab) => ({
            ...tab,
            disabled: pending && action !== tab.value,
            meta: tab.value === "explain" && issues.length ? <CountBadge count={issues.length} label={`${issues.length} problems`} tone="danger" /> : undefined,
          }))}
          value={action}
          onChange={(value) => action !== value && assistant.onActionChange(value)}
        />
      </div>
      <ScrollArea
        id={`template-assistant-panel-${action}`}
        className="template-assistant-body"
        role="tabpanel"
        aria-labelledby={`template-assistant-tab-${action}`}
        tabIndex={0}
      >
        {pending ? (
          <PendingView assistant={assistant} />
        ) : response ? (
          <ResultView assistant={assistant} />
        ) : applied ? (
          <AppliedView notice={appliedView?.notice} />
        ) : (
          <ComposeView
            assistant={assistant}
            draft={draft}
            issues={issues}
            isEditing={isEditing}
            isDirty={isDirty}
            allowJobs={allowJobs}
          />
        )}
      </ScrollArea>
      <footer className="template-assistant-foot">
        <FooterActions assistant={assistant} issues={issues} appliedActions={appliedView?.actions} />
      </footer>
      {assistant.picker.isOpen ? <JobPicker picker={assistant.picker} selectedJobId={assistant.job?.job_id} /> : null}
    </aside>
  );
}

function ComposeView({ assistant, draft, issues, isEditing, isDirty, allowJobs }) {
  const fileInput = useRef(null);
  const { action, instructions, file, job, evaluation, evaluationSample, useRetainedSource, error, stale } = assistant;

  const binary = useRetainedSource
    ? "job_source"
    : evaluationSample
      ? "evaluation_source"
      : file
        ? "upload"
        : "none";

  const binaryOptions = [
    { id: "none", label: job ? "Result only" : evaluation ? "Results only" : "No file", enabled: true },
    ...(job ? [{ id: "job_source", label: "Original", enabled: job.source_available }] : []),
    ...(evaluation?.sample
      ? [{ id: "evaluation_source", label: "Original", enabled: !assistant.sampleLoading }]
      : []),
    ...(file ? [{ id: "upload", label: "Uploaded sample", enabled: true }] : []),
  ];

  const chooseBinary = (id) => {
    if (id === "job_source") assistant.onRetainedSourceChange(true);
    else if (id === "evaluation_source") assistant.onEvaluationSampleChange(true);
    else if (id === "none") {
      assistant.onRetainedSourceChange(false);

      if (evaluationSample) assistant.onEvaluationSampleChange(false);

      if (file) assistant.onFileChange(null);
    }
  };

  return (
    <div className="template-assistant-stack template-assistant-fade-in">
      {stale ? (
        <Callout tone="warning" role="status">
          You edited the draft while this ran, so the response was discarded. Try again.
        </Callout>
      ) : null}
      {error ? (
        <Callout tone="danger" role="alert" title={error}>
          Your draft wasn’t changed.
        </Callout>
      ) : null}
      <p className="template-assistant-muted">
        {action === "explain"
          ? "Ask why something’s wrong. Your draft won’t change."
          : "Describe a change. You’ll review each edit before it’s applied."}
      </p>
      <Field
        label={action === "explain" ? "What would you like explained?" : "Describe your change"}
        hint={action === "explain" ? "Optional." : undefined}
        className="template-assistant-label"
      >
        <Textarea
          rows={3}
          value={instructions}
          placeholder={
            action === "explain"
              ? "e.g. Why is Total often empty?"
              : "e.g. Rename Invoice No to Invoice number"
          }
          onChange={(event) => assistant.onInstructionsChange(event.target.value)}
        />
      </Field>
      <SuggestionCards
        suggestions={assistant.suggestions}
        selected={instructions}
        onSend={assistant.onSuggestionSubmit}
        onEdit={assistant.onInstructionsChange}
      />

      <section className="template-assistant-section" aria-label="Evidence">
        <div className="template-assistant-section-head">
          <h3>
            Evidence <span>optional</span>
          </h3>
        </div>
        {evaluation ? <EvaluationEvidenceCard assistant={assistant} /> : null}
        {job ? (
          <div className="template-assistant-evidence-card">
            <div className="template-assistant-evidence-title">
              <div>
                <strong>{jobName(job)}</strong>
                <span>{job.job_id}</span>
              </div>
              <Button type="button" variant="danger-text" onClick={assistant.onRemoveJob}>
                Remove
              </Button>
            </div>
            <p>
              Extracted with{" "}
              <strong>
                {job.template_name || job.template_id} v{job.template_version}
              </strong>{" "}
              {job.template_id !== assistant.templateId ? (
                <Badge tone="warning">Different template</Badge>
              ) : assistant.templateVersion && job.template_version !== assistant.templateVersion ? (
                <Badge tone="warning">Older version · latest is v{assistant.templateVersion}</Badge>
              ) : (
                <Badge tone="success">Latest saved version</Badge>
              )}
            </p>
            <details className="template-assistant-details">
              <summary>Historical fields and results</summary>
              <pre>{JSON.stringify({ fields: job.fields, results: job.results }, null, 2)}</pre>
            </details>
            <p className="template-assistant-muted">
              {job.source_available ? "Original available." : "Original not kept. Only the result can be checked."}
            </p>
          </div>
        ) : allowJobs && !evaluation ? (
          <Button type="button" variant="secondary" className="template-assistant-evidence-add" onClick={assistant.picker.onOpen}>
            Choose a completed document…
          </Button>
        ) : null}

        {file ? (
          <div className="template-assistant-evidence-card">
            <div className="template-assistant-evidence-title">
              <div>
                <strong>{file.name}</strong>
                <span>
                  Sample · {formatBytes(file.size)}
                  {job ? " · not linked to the selected result" : ""}
                </span>
              </div>
              <Button
                type="button"
                variant="danger-text"
                onClick={() => assistant.onFileChange(null)}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              className="upload-input-hidden"
              tabIndex={-1}
              aria-label="Sample file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => {
                assistant.onFileChange(event.target.files?.[0] || null);
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary" className="template-assistant-evidence-add"
              onClick={() => fileInput.current?.click()}
            >
              Attach a sample (PDF, PNG, JPG or WEBP)…
            </Button>
          </>
        )}

        {job || file || evaluation?.sample ? (
          <div className="template-assistant-binary">
            <span className="template-assistant-label-text">File sent to the model</span>
            <Segmented
              label="File sent to the model"
              value={binary}
              onChange={chooseBinary}
              items={binaryOptions.map((option) => ({
                value: option.id,
                label: option.label,
                disabled: !option.enabled,
                title:
                  option.id === "evaluation_source"
                    ? evaluation.sample.name
                    : option.enabled
                      ? undefined
                      : "The original isn’t available for this document",
              }))}
            />
          </div>
        ) : null}
      </section>

      <section className="template-assistant-section template-assistant-sent" aria-label="What will be sent">
        <div className="template-assistant-section-head">
          <h3>What will be sent</h3>
        </div>
        <ul>
          <li>
            <strong>Current draft</strong> {draft.name ? `“${draft.name}”` : "(untitled)"} ·{" "}
            {pluralize(draft.fields.length, "field")} ·{" "}
            {isEditing ? (isDirty ? "unsaved changes" : "matches saved version") : "new, unsaved"}
            {issues.length ? ` · ${issues.length} problem${issues.length === 1 ? "" : "s"}` : ""}
          </li>
          <li>
            <strong>Your request</strong>{" "}
            {instructions.trim()
              ? `“${truncate(instructions.trim(), 80)}”`
              : action === "explain"
                ? "General explanation"
                : "—"}
          </li>
          {job ? (
            <li>
              <strong>Stored result</strong> {jobName(job)}, extracted with v{job.template_version}
            </li>
          ) : null}
          {evaluation ? (
            <li>
              <strong>Evaluation results</strong> {pluralize(failureCount(evaluation.evidence), "failing field")} with
              verified expected answers
            </li>
          ) : null}
          <li>
            <strong>File</strong>{" "}
            {binary === "job_source"
              ? `${jobName(job)} (the original)`
              : binary === "evaluation_source"
                ? `${evaluation.sample.name} (the original)`
                : binary === "upload"
                  ? `${file.name} (uploaded sample)`
                  : "None"}
          </li>
        </ul>
      </section>
    </div>
  );
}

function EvaluationEvidenceCard({ assistant }) {
  const { evidence } = assistant.evaluation;
  const failures = failureCount(evidence);
  const omitted = evidence.omitted.failures;

  return (
    <div className="template-assistant-evidence-card">
      <div className="template-assistant-evidence-title">
        <div>
          <strong>Evaluation results</strong>
          <span>{evidence.candidate.label}</span>
        </div>
        <Button type="button" variant="danger-text" onClick={assistant.onRemoveEvaluation}>
          Remove
        </Button>
      </div>
      <p>
        {evidence.accuracy.matched} of {evidence.accuracy.total} fields correct ·{" "}
        {pluralize(failures, "failing field")} in {pluralize(evidence.documents.length, "document")}
      </p>
      {omitted ? (
        <p className="template-assistant-muted">
          {pluralize(omitted, "more failing field")} left out to keep the request small.
        </p>
      ) : null}
      <details className="template-assistant-details">
        <summary>Failing fields and expected answers</summary>
        <pre>{JSON.stringify(evidence.documents, null, 2)}</pre>
      </details>
      <p className="template-assistant-muted">Only verified expected answers are sent.</p>
    </div>
  );
}

function SuggestionCards({ suggestions, selected, onSend, onEdit }) {
  const { status, source, items, notice } = suggestions;
  const isLoading = status !== "ready";

  return (
    <section className="template-assistant-suggestions" aria-label="Suggestions" aria-busy={isLoading}>
      <div className="template-assistant-suggestions-head">
        <span className="template-assistant-label-text">Suggested for this template</span>
        {!isLoading && source ? (
          <Badge tone={source === "model" ? "info" : "neutral"} className="template-assistant-tag">
            {source === "model" ? "From the model" : "From the app’s checks"}
          </Badge>
        ) : null}
      </div>
      {isLoading ? (
        <div className="template-assistant-suggestion-skeletons" role="status" aria-label="Generating suggestions">
          {[0, 1, 2].map((index) => (
            <span key={index} className="template-assistant-skeleton" style={{ width: `${88 - index * 14}%` }} />
          ))}
        </div>
      ) : (
        <>
          {notice ? <p className="template-assistant-muted">{notice}</p> : null}
          {items.length ? (
            <div className="template-assistant-suggestion-list">
              {items.map((suggestion) => (
                <div key={suggestion.id} className="template-assistant-suggestion-row">
                  <button
                    type="button"
                    className={
                      selected === suggestion.request
                        ? "template-assistant-suggestion selected"
                        : "template-assistant-suggestion"
                    }
                    onClick={() => onSend(suggestion.request)}
                  >
                    <strong>{suggestion.label}</strong>
                    <span>{suggestion.reason}</span>
                  </button>
                  <IconButton
                    size="sm"
                    label={`Edit “${truncate(suggestion.label, 40)}” before sending`}
                    icon={EditIcon}
                    onClick={() => onEdit(suggestion.request)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="template-assistant-muted">No suggestions for this draft. Describe what you need above.</p>
          )}
        </>
      )}
    </section>
  );
}

function PendingView({ assistant }) {
  return (
    <div className="template-assistant-stack template-assistant-fade-in">
      <RequestRecap assistant={assistant} />
      <div className="template-generation-progress" role="status">
        <span className="template-generation-spinner" aria-hidden="true" />
        <div>
          <strong>Analysing the draft…</strong>
          <p>Editing the draft now will discard this response.</p>
        </div>
      </div>
    </div>
  );
}

function ResultView({ assistant }) {
  const { response, stale, selectedIds, selection } = assistant;
  const checked = useMemo(() => diagnoseTemplateDraft(response.baseDraft), [response.baseDraft]);

  return (
    <div className="template-assistant-stack template-assistant-fade-in">
      {stale ? (
        <Callout
          tone="warning"
          role="alert"
          title="This proposal is out of date"
          action={
            <Button type="button" onClick={assistant.onSubmit}>
              Regenerate
            </Button>
          }
        >
          You edited the draft after asking, so this proposal can’t be applied.
        </Callout>
      ) : null}
      {assistant.error ? (
        <Callout tone="danger" role="alert">
          {assistant.error}
        </Callout>
      ) : null}
      <RequestRecap assistant={assistant} onRevise={() => assistant.onInstructionsChange(assistant.instructions)} />

      <section className="template-assistant-section" aria-label="Explanation">
        <p className="template-assistant-summary">{response.explanation}</p>
        <Badge tone="warning" className="template-assistant-tag">
          Not verified
        </Badge>
        {checked.length ? (
          <EvidenceList
            kind="checked"
            tone="neutral"
            label="Checked"
            title="Checked by the app"
            items={checked.map((issue) => ({ text: `${issue.title}. ${issue.remedy}` }))}
          />
        ) : null}
        {OBSERVATION_LISTS.map((list) => {
          const items = response.observations.filter((observation) => observation.kind === list.kind);

          return items.length ? <EvidenceList key={list.kind} {...list} items={items} /> : null;
        })}
      </section>

      {response.groups.length ? (
        <section
          className={stale ? "template-assistant-section template-assistant-is-stale" : "template-assistant-section"}
          aria-label="Proposed changes"
        >
          <div className="template-assistant-section-head">
            <h3>
              Proposed changes <span>{response.groups.length}</span>
            </h3>
          </div>
          <p className="template-assistant-muted">Changes in one card apply together.</p>
          <div className="template-assistant-groups">
            {response.groups.map((group) => (
              <ChangeGroup
                key={group.id}
                base={response.baseDraft}
                group={group}
                groups={response.groups}
                disabled={stale}
                selected={selectedIds.has(group.id)}
                isConflicting={selection?.conflicting?.some((entry) => entry.id === group.id)}
                onToggle={() => assistant.onToggleGroup(group.id)}
              />
            ))}
          </div>
          {!stale && selection ? <SelectionCheck selection={selection} baseHadIssues={checked.length > 0} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function EvidenceList({ kind, tone, label, title, hint, items }) {
  return (
    <div className={`template-assistant-evidence-list ${kind}`}>
      <div className="template-assistant-evidence-list-head">
        <Badge tone={tone} className="template-assistant-tag">
          {label}
        </Badge>
        <strong>{title}</strong>
      </div>
      {hint ? <p className="template-assistant-muted">{hint}</p> : null}
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}

function ChangeGroup({ base, group, groups, selected, disabled, isConflicting, onToggle }) {
  const rows = previewRows(base, group);
  const impacts = identityImpacts(base, group);
  const id = `template-assistant-group-${group.id}`;

  const requires = group.dependsOn.map(
    (dependency) => groups.find((entry) => entry.id === dependency)?.title || dependency,
  );

  return (
    <article
      className={`template-assistant-group${selected ? " selected" : ""}${isConflicting ? " conflicting" : ""}`}
      aria-labelledby={id}
    >
      <label className="template-assistant-group-head">
        <input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} />
        <span>
          <strong id={id}>{group.title}</strong>
          <span className="template-assistant-group-tags">
            {group.operations.length > 1 ? (
              <Badge>{group.operations.length} changes · applied together</Badge>
            ) : null}
            {impacts.some((impact) => impact.kind !== "added") ? (
              <Badge tone="warning">Changes output keys</Badge>
            ) : null}
          </span>
        </span>
      </label>
      <p className="template-assistant-rationale">{group.rationale}</p>
      <DataTable className="template-assistant-diff">
        <thead>
          <tr>
            <th scope="col">Where</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const format = row.property === "Type" ? displayType : display;
            const before = format(row.before);
            const after = format(row.after);

            return (
              <tr key={index} className={`template-assistant-diff-row ${row.kind}`}>
                <th scope="row">
                  <span>{row.target}</span>
                  <em>{row.property}</em>
                </th>
                <td className="before">
                  {before === null ? <span className="template-assistant-empty">—</span> : <del>{before}</del>}
                </td>
                <td className="after">
                  {after === null ? <span className="template-assistant-empty">Removed</span> : <ins>{after}</ins>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {impacts.length ? <IdentityImpacts impacts={impacts} /> : null}
      {requires.length ? <p className="template-assistant-dependency">Requires “{requires.join("”, “")}”.</p> : null}
      {isConflicting ? (
        <p className="template-assistant-conflict">Conflicts with another selected change. Only one can be applied.</p>
      ) : null}
    </article>
  );
}

function IdentityImpacts({ impacts }) {
  const breaking = impacts.filter((impact) => impact.kind !== "added");

  return (
    <div className={breaking.length ? "template-assistant-identity warn" : "template-assistant-identity"}>
      <strong>Output keys</strong>
      <ul>
        {impacts.map((impact, index) => (
          <li key={index}>
            {impact.kind === "added" ? (
              <>
                New key <code className="ins">{impact.after}</code>
              </>
            ) : null}
            {impact.kind === "removed" ? (
              <>
                No longer extracted <code className="del">{impact.before}</code>
              </>
            ) : null}
            {impact.kind === "renamed" ? (
              <>
                Renamed <code className="del">{impact.before}</code> → <code className="ins">{impact.after}</code>
              </>
            ) : null}
            {impact.kind === "retyped" ? (
              <>
                <code>{impact.before}</code> becomes {displayType(impact.to)} (was {displayType(impact.from)})
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {breaking.length ? (
        <p>
          Future results use the new keys. Earlier results are unchanged, and expected answers saved under the old keys
          won’t be relinked.
        </p>
      ) : (
        <p>Future results gain these keys. Earlier results won’t have them.</p>
      )}
    </div>
  );
}

function SelectionCheck({ selection, baseHadIssues }) {
  if (selection.dependencyErrors?.length) {
    return (
      <div className="template-assistant-check bad" role="alert">
        <ul>
          {selection.dependencyErrors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (!selection.selected.length) {
    return (
      <p className="template-assistant-check neutral">
        Nothing selected.{baseHadIssues ? " Your draft still has problems that stop it saving." : ""}
      </p>
    );
  }

  if (selection.conflicting?.length) {
    return (
      <p className="template-assistant-check bad" role="alert">
        Two selected changes edit the same thing. Unselect one to continue.
      </p>
    );
  }

  if (selection.errors.length) {
    return (
      <div className="template-assistant-check bad" role="alert">
        <strong>With this selection the draft still wouldn’t save:</strong>
        <ul>
          {selection.errors.slice(0, 4).map((issue) => (
            <li key={issue.id}>{issue.title}</li>
          ))}
        </ul>
        {selection.errors.length > 4 ? <span>and {selection.errors.length - 4} more</span> : null}
      </div>
    );
  }

  return <p className="template-assistant-check good">The result passes the same checks as Save.</p>;
}

function AppliedView({ notice = "Applied. Save the template to keep these changes." }) {
  return (
    <div className="template-assistant-stack template-assistant-fade-in">
      <Callout tone="success" role="status">
        {notice}
      </Callout>
    </div>
  );
}

function FooterActions({ assistant, issues, appliedActions }) {
  const { action, pending, response, applied, stale, selection } = assistant;
  const revise = () => assistant.onInstructionsChange(assistant.instructions);
  let actions;

  if (pending) {
    actions = (
      <Button type="button" variant="secondary" onClick={assistant.onCancelRequest}>
        Cancel request
      </Button>
    );
  } else if (response) {
    const count = selection?.selected.length || 0;
    actions = response.groups.length ? (
      <>
        <Button type="button" variant="secondary" onClick={revise}>
          Revise request
        </Button>
        <Button type="button" variant="secondary" onClick={assistant.onClose}>
          Discard
        </Button>
        <Button type="button" disabled={stale || !selection?.canApply} onClick={assistant.onApply}>
          {count ? `Apply ${count} change${count === 1 ? "" : "s"} to draft` : "Apply to draft"}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" variant="secondary" onClick={revise}>
          Ask something else
        </Button>
        {action === "explain" && issues.length ? (
          <Button
            type="button"

            onClick={() => {
              assistant.onActionChange("edit");
              assistant.onInstructionsChange("Fix the draft’s problems so the template can save");
            }}
          >
            <MagicIcon />
            Propose fixes
          </Button>
        ) : null}
      </>
    );
  } else if (applied) {
    actions = (
      <>
        <Button type="button" variant="secondary" onClick={assistant.onClose}>
          Close
        </Button>
        <Button
          type="button"
          variant={appliedActions ? "secondary" : "primary"}
          onClick={() => assistant.onInstructionsChange("")}
        >
          New request
        </Button>
        {appliedActions}
      </>
    );
  } else {
    const canSend = action === "explain" || assistant.instructions.trim();
    actions = (
      <>
        <Button type="button" variant="secondary" onClick={assistant.onClose}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSend} onClick={assistant.onSubmit}>
          <MagicIcon />
          {assistant.error || stale ? "Try again" : action === "explain" ? "Explain" : "Propose edits"}
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="template-assistant-foot-actions">{actions}</div>
    </>
  );
}

function RequestRecap({ assistant, onRevise }) {
  const { action, instructions, job, file, evaluation, evaluationSample, useRetainedSource, templateVersion } =
    assistant;

  const versionNote =
    job && templateVersion && job.template_id === assistant.templateId && job.template_version !== templateVersion
      ? `; this draft started from v${templateVersion}`
      : "";

  const evidence = [
    job ? `Result: ${jobName(job)} (v${job.template_version}${versionNote})` : null,
    evaluation ? `Evaluation: ${pluralize(failureCount(evaluation.evidence), "failing field")}` : null,
    useRetainedSource || evaluationSample
      ? "File: original"
      : file
        ? `File: ${file.name}`
        : job || evaluation
          ? "No file sent"
          : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="template-assistant-recap">
      <div>
        <span className="template-assistant-label-text">
          {action === "explain" ? "You asked for an explanation" : "You asked for edits"}
        </span>
        <p>
          {instructions.trim()
            ? `“${instructions.trim()}”`
            : action === "explain"
              ? "General explanation of the draft"
              : "Fix the draft’s problems"}
        </p>
        <p className="template-assistant-muted">{evidence || "No evidence attached"}</p>
      </div>
      {onRevise ? (
        <Button type="button" variant="text" onClick={onRevise}>
          Revise
        </Button>
      ) : null}
    </div>
  );
}

function JobPicker({ picker, selectedJobId }) {
  return (
    <ModalDialog
      label="Choose a completed document"
      className="template-assistant-picker"
      onClose={picker.onClose}
    >
      <ModalHeader
        title="Choose a completed document"
        description="The result and its template version are sent with your request."
        onClose={picker.onClose}
        closeLabel="Close document picker"
      />
      {picker.error ? (
        <p role="alert" className="form-error">
          {picker.error}
        </p>
      ) : null}
      <div
        className={picker.loading ? "template-assistant-job-table is-loading" : "template-assistant-job-table"}
        aria-busy={picker.loading}
      >
        <DataTable>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Completed</th>
              <th scope="col">Template used</th>
              <th scope="col">Source</th>
              <th scope="col">
                <span className="upload-input-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {picker.jobs.map((job) => (
              <tr key={job.job_id} className={job.job_id === selectedJobId ? "selected" : undefined}>
                <th scope="row">
                  <strong>{jobName(job)}</strong>
                  <span>{job.job_id}</span>
                </th>
                <td>{formatDate(job.completed_at)}</td>
                <td>
                  {job.template_name || job.template_id}{" "}
                  <Badge>v{job.template_version}</Badge>
                </td>
                <td>
                  <Badge tone={job.source_available ? "success" : "neutral"}>
                    {job.source_available ? "Original kept" : "Results only"}
                  </Badge>
                </td>
                <td>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={picker.loading}
                    onClick={() => picker.onChoose(job.job_id)}
                  >
                    {job.job_id === selectedJobId ? "Selected" : "Use"}
                  </Button>
                </td>
              </tr>
            ))}
            {!picker.loading && !picker.jobs.length ? (
              <tr>
                <td colSpan="5" className="template-assistant-muted">
                  No completed documents on this page.
                </td>
              </tr>
            ) : null}
          </tbody>
        </DataTable>
      </div>
      <Pager
        label={picker.loading ? "Loading…" : `Page ${picker.page + 1}`}
        hasPrevious={picker.page > 0}
        hasNext={Boolean(picker.nextCursor)}
        onPrevious={picker.onPrevious}
        onNext={picker.onNext}
        disabled={picker.loading}
      />
    </ModalDialog>
  );
}
