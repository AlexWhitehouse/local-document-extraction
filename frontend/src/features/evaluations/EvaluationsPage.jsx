import { PageHeader } from "../ui/PageHeader.jsx";
import { DocumentUploadPanel } from "../documents/DocumentUploadPanel.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { EvaluationSetup } from "./EvaluationSetup.jsx";
import { DocumentMatrix, FieldFilters } from "./DocumentMatrix.jsx";
import {
  ClearDialog,
  DocumentBanner,
  DocumentPreview,
  LibraryPicker,
  ManageLibrary,
  SaveDialog,
  UpdateReview,
} from "./EvaluationLibrary.jsx";
import { Meter } from "./EvaluationParts.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pluralize } from "../../lib/text.js";
import { createNotifier, defaultToast } from "../../lib/notify";
import { describeError } from "../../lib/describeError";
import { TemplateEditorModal } from "../templates/TemplateEditorModal.jsx";
import { validateTemplateJsonPayload } from "../templates/templateFields.js";
import { templateLabel } from "./evaluationFormat.js";
import { TemplateVersionDialog } from "./TemplateVersionDialog.jsx";
import { MAX_CANDIDATES, documentRunnable, pairBusy } from "./useEvaluations.js";
import { documentCompatibility } from "./evaluationScoring.js";
import { documentDirty, saveUnavailableMessage } from "./evaluationLibrary.js";
import "./evaluations.css";
import { useUnsavedGuard } from "../../lib/unsavedChanges.js";
import { validateSourceFiles } from "../documents/sourceFileValidation.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Segmented } from "../ui/Tabs.jsx";
import { Dropzone } from "../ui/Dropzone.jsx";
import { Callout } from "../ui/Callout.jsx";
import { CloseIcon, ExternalIcon } from "../layout/Icons.jsx";

export function EvaluationsPage({
  evaluation,
  templates,
  workspaceCrumb = null,
  enabled,
  maxSourceFileBytes,
  suggestedModels,
  onTemplateSaved,
  onOpenWorkspace,
  toast = defaultToast,
}) {
  const { state, patch, edit, api } = evaluation;
  const [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [autoRun, setAutoRun] = useState(null);
  const [replacement, setReplacement] = useState(null);
  const [localError, setLocalError] = useState("");
  const notify = useMemo(() => createNotifier(toast), [toast]);
  const [dialog, setDialog] = useState(null);
  const [view, setView] = useState(null);
  const [filter, setFilter] = useState("all");
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current++;
    setEditor(null);
    setReplacement(null);
    setUploadOpen(false);
    setPreview(null);
    setAutoRun(null);
    setLocalError("");
    setDialog(null);
    setView(null);
    setFilter("all");
  }, [state.id]);
  // Setup can start and run in one step; run once the new candidates are in state.
  useEffect(() => {
    if (!autoRun || !autoRun.every((id) => state.candidates.some((c) => c.id === id))) return;
    setAutoRun(null);
    evaluation.run(autoRun);
  }, [autoRun, state.candidates, evaluation]);
  const editingLibrary = !!state.libraryEditor;
  const batch = !editingLibrary && state.documents.length > 1;
  useEffect(() => {
    setFilter("all");
    setReplacement(null);
  }, [state.libraryEditor]);

  // One document at a time, as in a single-document Evaluation; Previous/Next move through the rest.
  const position = Math.max(
    0,
    state.documents.findIndex((d) => d.key === (state.libraryEditor || view)),
  );

  const document = state.documents[position];

  const step = (delta) => {
    setFilter("all");
    setView(state.documents[(position + delta + state.documents.length) % state.documents.length]?.key ?? null);
  };

  const template = editingLibrary ? document?.editingTemplate : state.candidates[0]?.template;
  const fields = template?.fields || [];

  const labelFor = (candidate) =>
    state.mode === "models"
      ? candidate.model || `Candidate ${state.candidates.indexOf(candidate) + 1}`
      : templateLabel(candidate.template);

  // The selected document's view of each candidate: its pair status plus the displayed result details.
  const shown = (pair) => pair?.result || pair?.previous || null;

  const viewCandidates = document && !editingLibrary
    ? state.candidates.map((candidate) => {
        const pair = state.pairs[document.key]?.[candidate.id],
          record = shown(pair);

        const detail = record && evaluation.detail(record.recordId);
        const unavailable = record && record === pair.result && pair.detail === "unavailable";

        return {
          ...candidate,
          status: pair?.status || "idle",
          attempt: pair?.attempt,
          message: pair?.message || "",
          cleanup: pair?.cleanup,
          previousShown: !pair?.result && !!pair?.previous,
          detailState: !record ? null : unavailable ? "unavailable" : detail ? "ready" : "loading",
          result: record && detail && !unavailable ? { ...record, raw: detail.raw, values: detail.values } : null,
        };
      })
    : [];

  const visibleKey = viewCandidates
    .flatMap((c) =>
      c.detailState && c.detailState !== "unavailable" ? [shown(state.pairs[document.key][c.id]).recordId] : [],
    )
    .join("|");

  // Only the open document's details are decrypted.
  useEffect(() => {
    if (evaluation.hydrate) evaluation.hydrate(visibleKey ? visibleKey.split("|") : []);
  }, [visibleKey, evaluation]);
  const runnable = state.documents.filter(documentRunnable);
  const busyFor = (candidateId) => Object.values(state.pairs).some((byCandidate) => pairBusy(byCandidate[candidateId]));
  const anyBusy = state.candidates.some((c) => busyFor(c.id));
  const unsaved = state.documents.filter((d) => d.kind === "upload" || documentDirty(d)).length;

  const selectDocuments = (files) => {
    if (!files.length) return;
    const { accepted, rejections } = validateSourceFiles(files, maxSourceFileBytes);
    const problem = rejections.join(" ");

    if (accepted.length) evaluation.addUploads(accepted);
    setLocalError(
      problem
        ? `${problem}${accepted.length ? ` Added ${accepted.length} other ${accepted.length === 1 ? "document" : "documents"}.` : ""}`
        : "",
    );

    if (!problem) setUploadOpen(false);
  };

  const loadTemplate = useCallback(
    async (id, fieldVersion, signal) => {
      const path = `/evaluations/templates/${encodeURIComponent(id)}${fieldVersion ? `?version=${fieldVersion}` : ""}`;
      const response = signal ? await api(path, { signal }) : await api(path);
      const template = await response.json();

      const tested = Number(fieldVersion || template.current_version);

      return { ...template, source: { id, version: tested } };
    },
    [api],
  );

  const startEvaluation = async ({ mode, templateId: id, versions, models, runNow }) => {
    const owner = lifetime.current;
    setLocalError("");

    try {
      const loaded = await Promise.all(versions.map((v) => loadTemplate(id, v)));

      if (owner !== lifetime.current) return;
      const chosen = mode === "templates" && loaded.length === 1 ? [loaded[0], loaded[0]] : loaded;

      const ids = evaluation.start(
        mode,
        mode === "models"
          ? models.map((model) => ({ template: loaded[0], model }))
          : chosen.map((template) => ({ template })),
      );

      if (runNow) setAutoRun(ids);
    } catch (error) {
      if (owner === lifetime.current) setLocalError(describeError(error, "The evaluation couldn’t be started. Try again."));
    }
  };

  const openEditor = (candidate, save = false) =>
    setEditor({
      candidateId: candidate.id,
      save,
      initial: { ...candidate.template, name: save ? `${candidate.template.name} copy` : candidate.template.name },
      notice:
        save &&
        Object.values(state.pairs).some((p) => {
          const tested = shown(p[candidate.id]);

          return tested && tested.revision !== candidate.revision;
        })
          ? "These current edits have not been tested. Saving creates a new Template."
          : save
            ? "Creates a new Template from the current draft."
            : "Changes apply to the draft. Run again to test them.",
    });

  const modifiedSource = (source) => (source ? { ...source, modified: true } : undefined);

  const applyTemplate = async (payload) => {
    const owner = lifetime.current;

    if (editor.save) {
      await api("/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      notify("evaluation.templateSave", "success", { targetName: payload.name });
      await onTemplateSaved?.();
    } else if (editor.documentKey && editor.initial.source) {
      const initial = editor.initial;
      const baseline = validateTemplateJsonPayload(initial);

      // Match the main Template editor: unchanged fields do not create a version,
      // and unchanged tags cannot undo another member's shared tag edits.
      const changes = Object.fromEntries(
        Object.entries(payload).filter(([key, value]) => JSON.stringify(baseline[key]) !== JSON.stringify(value)),
      );

      if (!Object.keys(changes).length) return;

      const response = await api(`/templates/${encodeURIComponent(initial.source.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });

      const saved = await response.json();

      if (owner !== lifetime.current) return;
      evaluation.editLibraryTemplate({
        ...initial,
        ...payload,
        fields: validateTemplateJsonPayload(payload, { includeFieldIds: true }).fields,
        current_version: saved.version,
        source: { id: initial.source.id, version: changes.fields ? saved.version : initial.source.version },
      }, editor.documentKey);
      notify("evaluation.templateSave", "success", { targetName: payload.name });
      await onTemplateSaved?.();
    } else if (editor.documentKey) {
      const next = { ...payload };

      evaluation.editLibraryTemplate(next, editor.documentKey);
    } else if (state.mode === "models") {
      patch({
        candidates: state.candidates.map((c) => ({
          ...c,
          template: { ...structuredClone(payload), source: modifiedSource(c.template.source) },
          revision: c.revision + 1,
        })),
      });
    } else
      edit(editor.candidateId, {
        template: {
          ...payload,
          source: modifiedSource(state.candidates.find((c) => c.id === editor.candidateId).template.source),
        },
      });
  };

  // In Template mode, input settings are shared by every candidate.
  const setInput = (candidate, key, value) =>
    state.mode === "models"
      ? edit(candidate.id, { [key]: value })
      : patch({ candidates: state.candidates.map((c) => ({ ...c, [key]: value, revision: c.revision + 1 })) });

  const menuFor = (candidate) => ({
    inputs: { shared: state.mode === "templates" },
    onInputChange: (key, value) => setInput(candidate, key, value),
    actions: [
      { label: "Edit Template", onClick: () => openEditor(candidate) },
      state.mode === "templates" && {
        label: "Choose another Template/version",
        onClick: () => setReplacement({ candidateId: candidate.id, source: candidate.template.source }),
      },
      { label: "Save as new Template", onClick: () => openEditor(candidate, true) },
      {
        label: "Duplicate candidate",
        disabled: state.candidates.length >= MAX_CANDIDATES,
        onClick: () => evaluation.duplicate(candidate.id),
      },
      {
        label: "Remove candidate",
        danger: true,
        disabled: state.candidates.length <= 1 || busyFor(candidate.id),
        onClick: () => evaluation.remove(candidate.id),
      },
    ],
  });

  const runFor = (candidate, index) => ({
    label: `Run Candidate ${index + 1}`,
    title: batch ? "Run candidate on this document" : "Run candidate",
    disabled:
      pairBusy(state.pairs[document.key]?.[candidate.id]) ||
      !documentRunnable(document) ||
      !candidate.model.trim() ||
      state.stale,
    onClick: () => evaluation.run([candidate.id], [document.key]),
  });

  const runDisabled =
    !state.candidates.length ||
    !runnable.length ||
    anyBusy ||
    state.stale ||
    state.candidates.some((c) => !c.model.trim());

  const addCandidate = () => evaluation.duplicate(state.candidates.at(-1).id);
  const open = (kind, extra = {}) => setDialog({ kind, ...extra });
  const dialogDocument = dialog?.key && state.documents.find((d) => d.key === dialog.key);
  const dialogFields = dialog?.fields || fields;

  // The template editor and library save dialogs hold unapplied edits.
  useUnsavedGuard(
    Boolean(editor || (dialog?.kind === "save" && dialogDocument) || (dialog?.kind === "update" && dialogDocument?.entry)),
    "Evaluation dialog",
  );
  const compatibility = document && documentCompatibility(document, fields);
  const saveUnavailable = saveUnavailableMessage(state.library);

  return (
    <section className="evaluations-page" aria-label="Evaluations">
      <PageHeader
        label="Evaluations"
        breadcrumbs={[workspaceCrumb, { label: "Evaluations" }].filter(Boolean)}
        title="Evaluations"
        description="Compare candidates on one or more documents. Runs and results are temporary and clear when you close this tab; saved documents and their answers stay in the Workspace library."
        actions={
          <>
            {editingLibrary && (
              <>
                <Button variant="secondary" onClick={() => patch({ libraryEditor: null })}>
                  Back to Evaluation
                </Button>
                <Button variant="secondary" onClick={() => open("manage")}>
                  Manage library
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={() => open("clear")}>
              Clear Evaluation{unsaved ? ` · ${unsaved} unsaved` : ""}
            </Button>
            {!editingLibrary && (
              <Button
                disabled={runDisabled}
                onClick={() => evaluation.run(state.candidates.map((c) => c.id))}
              >{`Run all${state.candidates.length ? ` (${pluralize(state.candidates.length, "candidate")}${batch ? ` × ${pluralize(runnable.length, "document")}` : ""})` : ""}`}</Button>
            )}
          </>
        }
      />
      {state.cacheError && (
        <Callout
          tone="danger"
          role="alert"
          title="Result details couldn’t be kept in this browser."
          action={
            <>
              <Button variant="text" onClick={() => evaluation.retryCache()}>
                Retry storage
              </Button>
              <Button variant="danger-text" onClick={() => open("clear")}>
                Clear Evaluation
              </Button>
            </>
          }
        >
          {state.cacheError.message} New runs are paused; results already shown are kept, and results whose details are
          missing can’t be scored.
        </Callout>
      )}
      {!state.candidates.length && !editingLibrary ? (
        <EvaluationSetup
          state={state}
          templates={templates}
          enabled={enabled}
          maxSourceFileBytes={maxSourceFileBytes}
          suggestedModels={suggestedModels}
          error={!uploadOpen ? state.error || localError : ""}
          loadTemplate={loadTemplate}
          onSelectDocuments={selectDocuments}
          onRemoveDocument={evaluation.removeDocument}
          onPreviewDocument={setPreview}
          onStart={startEvaluation}
          onChooseLibrary={(setupFields) => open("picker", { fields: setupFields })}
          onManageLibrary={(setupFields) => open("manage", { fields: setupFields })}
          onOpenWorkspace={onOpenWorkspace}
        />
      ) : (
        <>
          {((!editingLibrary && state.error) || localError) && !uploadOpen && (
            <Callout tone="danger" role="alert">
              {(!editingLibrary && state.error) || localError}
            </Callout>
          )}
          <div className="evaluation-contextbar">
            <div className="evaluation-context-item">
              <small>Document</small>
              <span className="evaluation-context-value" title={document?.name}>
                {document?.name || "No document"}
                {document?.kind === "upload"
                  ? " · not saved"
                  : document && documentDirty(document)
                    ? " · answer changes not saved"
                    : ""}
              </span>
              <span className="evaluation-context-actions">
                {document && (
                  <Button variant="text" onClick={() => setPreview(document)}>
                    View <ExternalIcon size={12} />
                  </Button>
                )}
                {document?.kind === "upload" && (
                  <Button variant="text"
                    disabled={!!saveUnavailable || document.save === "saving"}
                    title={saveUnavailable || undefined}
                    onClick={() => open("save", { key: document.key })}
                  >
                    {document.save === "saving" ? "Saving…" : "Save to library…"}
                  </Button>
                )}
                {document && documentDirty(document) && (
                  <>
                    <Button variant="text"
                      onClick={() => open("update", { key: document.key })}
                    >
                      Update saved answers…
                    </Button>
                    <Button variant="danger-text"
                      onClick={() => evaluation.discardChanges(document.key)}
                    >
                      Discard changes
                    </Button>
                  </>
                )}
                {!editingLibrary && (
                  <>
                    <Button variant="text" onClick={() => open("picker")}>
                      Add from library
                    </Button>
                    <Button variant="text" onClick={() => setUploadOpen(true)}>
                      Upload document
                    </Button>
                  </>
                )}
              </span>
            </div>
            {!editingLibrary && (
              <div className="evaluation-context-item">
                <small>Comparing</small>
                <Segmented
                  label="Comparison mode"
                  value={state.mode}
                  onChange={(mode) => void evaluation.changeMode(mode)}
                  items={[
                    { value: "models", label: "Models", disabled: anyBusy },
                    { value: "templates", label: "Templates", disabled: anyBusy },
                  ]}
                />
              </div>
            )}
            {editingLibrary ? (
              <div className="evaluation-context-item">
                <small>Template</small>
                <span className="evaluation-context-value" title={template.source ? templateLabel(template) : "Saved fields"}>
                  {template.source ? templateLabel(template) : "Saved fields"}
                  {" · "}{fields.length} {fields.length === 1 ? "field" : "fields"}
                </span>
                <span className="evaluation-context-actions">
                  <Button variant="text"
                    onClick={() => setReplacement({ documentKey: document.key, source: template.source })}
                  >
                    Choose Template/version
                  </Button>
                  <Button variant="text"
                    onClick={() =>
                      setEditor({
                        candidateId: "library-template",
                        documentKey: document.key,
                        initial: template,
                        notice: template.source
                          ? "Saves changes to the selected Workspace Template. Changed fields become its latest version and are used here immediately. Review the Expected answers, then use Update saved answers to save them."
                          : "Changes apply to this document’s draft. Choose a Template/version to edit a saved Workspace Template. Review the Expected answers, then use Update saved answers to save them.",
                      })
                    }
                  >
                    Edit Template
                  </Button>
                </span>
              </div>
            ) : state.mode === "models" ? (
              <div className="evaluation-context-item">
                <small>Shared Template</small>
                <span className="evaluation-context-value" title={templateLabel(template)}>
                  {templateLabel(template)} · {fields.length} {fields.length === 1 ? "field" : "fields"}
                </span>
                <span className="evaluation-context-actions">
                  <Button variant="text" onClick={() => openEditor(state.candidates[0])}>
                    Edit shared Template
                  </Button>
                </span>
              </div>
            ) : (
              <div className="evaluation-context-item">
                <small>Shared model</small>
                <input
                  aria-label="Shared model"
                  value={state.candidates[0].model}
                  onChange={(event) =>
                    patch({
                      candidates: state.candidates.map((c) => ({
                        ...c,
                        model: event.target.value,
                        revision: c.revision + 1,
                      })),
                    })
                  }
                />
              </div>
            )}
            <div className="evaluation-context-item evaluation-context-progress">
              <small>Expected answers</small>
              {document ? (
                <>
                  <span className="evaluation-context-value">
                    {compatibility.verified} of {compatibility.total} verified
                    {compatibility.review ? `, ${compatibility.review} to review` : ""}
                  </span>
                  <Meter value={compatibility.total ? compatibility.verified / compatibility.total : 0} best />
                </>
              ) : (
                <span className="evaluation-context-value">—</span>
              )}
            </div>
          </div>
          {document && <DocumentBanner evaluation={evaluation} document={document} notify={notify} />}
          {document && (
            <div className="evaluation-toolbar-row">
              <FieldFilters value={filter} onChange={setFilter} editing={editingLibrary} />
              {batch && (
                <nav className="evaluation-doc-nav" aria-label="Documents in this Evaluation">
                  <Button variant="secondary" onClick={() => step(-1)}>
                    Previous
                  </Button>
                  <span className="evaluation-muted">
                    Document {position + 1} of {state.documents.length}
                  </span>
                  <Button variant="secondary" onClick={() => step(1)}>
                    Next
                  </Button>
                </nav>
              )}
            </div>
          )}
          {document ? (
            <DocumentMatrix
              key={`${state.id}:${document.key}:${editingLibrary}`}
              evaluation={evaluation}
              document={document}
              candidates={viewCandidates}
              template={editingLibrary ? template : undefined}
              batch={batch}
              labelFor={labelFor}
              menuFor={menuFor}
              runFor={runFor}
              onAddCandidate={addCandidate}
              filter={filter}
              onFilterChange={setFilter}
            />
          ) : (
            <Dropzone
              label="Evaluation document"
              className="evaluation-dropzone"
              onFiles={selectDocuments}
              renderContent={() => (
                <>
                <span className="evaluation-dropzone-icon" aria-hidden="true">
                  ▤
                </span>
                <div>
                  <strong>Add a document to compare</strong>
                  <small>Choose saved documents or upload new ones. Candidates run on every document.</small>
                </div>
                <span className="evaluation-actions">
                  <Button onClick={() => open("picker")}>Library</Button>
                  <Button variant="secondary" onClick={() => setUploadOpen(true)}>
                    Upload new
                  </Button>
                </span>
                </>
              )}
            />
          )}
        </>
      )}
      {uploadOpen && (
        <ModalDialog
          label="Upload evaluation document"
          onClose={() => {
            setUploadOpen(false);
            setLocalError("");
          }}
        >
          <div className="evaluation-heading">
            <h2>Upload documents</h2>
            <IconButton size="sm" label="Close" icon={CloseIcon} className="modal-close" onClick={() => {
                setUploadOpen(false);
                setLocalError("");
              }} />
          </div>
          <DocumentUploadPanel
            label="Document"
            multiple
            maxSourceFileBytes={maxSourceFileBytes}
            onSelectSourceFiles={selectDocuments}
          />
          {localError && (
            <p role="alert" className="form-error">
              {localError}
            </p>
          )}
        </ModalDialog>
      )}
      {replacement && (
        <TemplateVersionDialog
          key={`${state.id}:${replacement.documentKey || replacement.candidateId}`}
          templates={templates}
          source={replacement.source}
          title={replacement.documentKey ? "Choose Template/version" : "Choose candidate Template"}
          description={
            replacement.documentKey
              ? "Load fields into this document’s draft and review changes against its Expected answers. Use Update saved answers to save your reviewed answers to the library."
              : undefined
          }
          action={replacement.documentKey ? "Use Template version" : "Replace candidate Template"}
          loadTemplate={loadTemplate}
          onSelect={(selected) => {
            if (replacement.documentKey) {
              evaluation.editLibraryTemplate(selected);
              setFilter("all");
            } else edit(replacement.candidateId, { template: selected });
          }}
          onClose={() => setReplacement(null)}
        />
      )}
      {editor && (
        <TemplateEditorModal
          key={`${editor.candidateId}:${editor.save}`}
          {...editor}
          title={editor.save ? "Save as new Template" : "Edit Template"}
          action={editor.save ? "Save new Template" : editor.documentKey && editor.initial.source ? "Save Template" : "Apply changes"}
          onSubmit={applyTemplate}
          onClose={() => setEditor(null)}
        />
      )}
      {dialog?.kind === "picker" && (
        <LibraryPicker evaluation={evaluation} fields={dialogFields} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "manage" && (
        <ManageLibrary evaluation={evaluation} fields={dialogFields} onClose={() => setDialog(null)} notify={notify} />
      )}
      {dialog?.kind === "clear" && <ClearDialog evaluation={evaluation} onClose={() => setDialog(null)} />}
      {dialog?.kind === "save" && dialogDocument && (
        <SaveDialog
          evaluation={evaluation}
          document={dialogDocument}
          fields={dialogFields}
          onSaved={(name) => notify("library.save", "success", { targetName: name })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "update" && dialogDocument?.entry && (
        <UpdateReview
          evaluation={evaluation}
          document={dialogDocument}
          onDone={(action) => notify(action, "success", { targetName: dialogDocument.name })}
          onClose={() => setDialog(null)}
        />
      )}
      {preview && <DocumentPreview evaluation={evaluation} document={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
