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
import { TemplateEditorModal } from "../templates/TemplateEditorModal.jsx";
import { hydrateFieldFromTemplate, validateTemplateJsonPayload } from "../templates/templateFields.js";
import { TemplateAssistant } from "../templates/TemplateAssistant.jsx";
import { useTemplateAssistant } from "../templates/useTemplateAssistant.js";
import { diagnoseTemplateDraft } from "../../../../shared/templateAssistant.ts";
import { templateLabel } from "./evaluationFormat.js";
import { TemplateVersionDialog } from "./TemplateVersionDialog.jsx";
import { CandidateTrial } from "./CandidateTrial.jsx";
import {
  collectEvaluationEvidence,
  failingFieldNames,
  improvementRequest,
  shownRecord,
} from "./candidateImprovement.js";
import { MAX_CANDIDATES, documentRunnable, pairBusy } from "./useEvaluations.js";
import { documentCompatibility, unverifiedFields } from "./evaluationScoring.js";
import { documentDirty, saveUnavailableMessage } from "./evaluationLibrary.js";
import "./evaluations.css";
import { useUnsavedGuard } from "../../lib/unsavedChanges.js";
import { validateSourceFiles } from "../documents/sourceFileValidation.js";
import { Button, IconButton } from "../ui/Button.jsx";
import { Segmented } from "../ui/Tabs.jsx";
import { Dropzone } from "../ui/Dropzone.jsx";
import { Callout } from "../ui/Callout.jsx";
import { CloseIcon, ExternalIcon } from "../layout/Icons.jsx";
import { AcceptAnswersDialog } from "./AcceptAnswers.jsx";
import { planAcceptAnswers } from "./acceptAnswers.js";
import { extractionModelAvailability } from "./extractionModel.js";
import { confirmDialog } from "../ui/confirm.jsx";

export function EvaluationsPage({
  evaluation,
  templates,
  workspaceCrumb = null,
  enabled,
  maxSourceFileBytes,
  suggestedModels,
  onTemplateSaved,
  onOpenWorkspace,
  modelConfiguration = null,
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
  // The document whose unverified fields are flagged after a blocked save.
  const [missingFor, setMissingFor] = useState(null);
  // The open "Accept all answers" confirmation: the candidate and one plan per document.
  const [accepting, setAccepting] = useState(null);
  // "Test changes": an edited copy of a candidate, run on the original's documents and compared with it.
  const [trial, setTrial] = useState(null);
  // The candidate the assistant panel works on, and the request it opens with.
  const [assistantFor, setAssistantFor] = useState(null);
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current++;
    setTrial(null);
    setAssistantFor(null);
    setEditor(null);
    setReplacement(null);
    setUploadOpen(false);
    setPreview(null);
    setAutoRun(null);
    setLocalError("");
    setDialog(null);
    setView(null);
    setFilter("all");
    setAccepting(null);
  }, [state.id]);
  // Setup can start and run in one step; run once the new candidates are in state.
  useEffect(() => {
    if (!autoRun || !autoRun.every((id) => state.candidates.some((c) => c.id === id))) return;
    setAutoRun(null);
    evaluation.run(autoRun);
  }, [autoRun, state.candidates, evaluation]);
  // The tested copy runs through the normal run path once it is in state.
  useEffect(() => {
    if (!trial) return;
    const present = state.candidates.some((c) => c.id === trial.copyId);

    // A copy removed from its column menu ends the comparison too.
    if (!trial.pending && !present) setTrial(null);

    if (!trial.pending || !present) return;
    setTrial({ ...trial, pending: false });
    evaluation.run([trial.copyId], trial.documentKeys);
  }, [trial, state.candidates, evaluation]);
  const editingLibrary = !!state.libraryEditor;
  const batch = !editingLibrary && state.documents.length > 1;
  useEffect(() => {
    setFilter("all");
    setReplacement(null);
    setAssistantFor(null);
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

  const startEvaluation = async (options) => {
    const { mode, templateId: id, versions, models, runNow } = options;
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
      if (owner === lifetime.current)
        notify("evaluation.start", "failure", { error, retry: () => void startEvaluation(options) });
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
          ? "These edits haven’t been run yet. Saving creates a new template."
          : save
            ? "Creates a new template from the current draft."
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
    } else applyToCandidate(editor.candidateId, payload);
  };

  // A model comparison shares one template, so its edits reach every candidate.
  const applyToCandidate = (candidateId, payload) => {
    if (state.mode === "models")
      patch({
        candidates: state.candidates.map((c) => ({
          ...c,
          template: { ...structuredClone(payload), source: modifiedSource(c.template.source) },
          revision: c.revision + 1,
        })),
      });
    else
      edit(candidateId, {
        template: {
          ...payload,
          source: modifiedSource(state.candidates.find((c) => c.id === candidateId).template.source),
        },
      });
  };

  // Assistant requests share the Evaluation's Workspace request path.
  const assistRequest = useCallback(async (path, options) => (await api(path, options)).json(), [api]);
  const candidateNumber = (candidate) => state.candidates.findIndex((c) => c.id === candidate.id) + 1;

  const assistantCandidate = assistantFor ? state.candidates.find((c) => c.id === assistantFor.candidateId) || null : null;
  const assistantTemplate = assistantCandidate?.template;

  // The assistant works on a hydrated copy of the candidate's template, as the template editor does.
  const assistantDraft = useMemo(
    () =>
      assistantTemplate
        ? {
            name: assistantTemplate.name,
            description: assistantTemplate.description || "",
            fields: assistantTemplate.fields.map(hydrateFieldFromTemplate),
          }
        : { name: "", description: "", fields: [] },
    [assistantTemplate],
  );

  const assistantIssues = useMemo(() => diagnoseTemplateDraft(assistantDraft), [assistantDraft]);
  const assistantRevision = assistantCandidate?.revision ?? 0;
  const assistantRevisionRef = useRef(assistantRevision);
  assistantRevisionRef.current = assistantRevision;
  // Applied edits wait here until the user tests them on a copy or applies them to the candidate.
  const [assistantResult, setAssistantResult] = useState(null);

  const assistant = useTemplateAssistant({
    request: assistRequest,
    workspaceId: state.id,
    sessionId: String(assistantFor?.opened ?? 0),
    activePage: "evaluations",
    templateId: assistantFor?.candidateId ?? "",
    templateVersion: null,
    hasApiAccess: Boolean(enabled && assistantCandidate),
    draft: assistantDraft,
    revision: assistantRevision,
    getRevision: () => assistantRevisionRef.current,
    maxSourceFileBytes,
    onApply: setAssistantResult,
    showActionToast: notify,
  });

  const openAssistantWith = assistant.openWith;
  useEffect(() => {
    if (assistantFor) openAssistantWith(assistantFor.intent);
    // Opens once per request to open it; later renders keep the panel's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantFor?.opened]);

  const cancelAssistant = assistant.cancel;

  // A removed candidate closes the panel that was working on it.
  useEffect(() => {
    if (assistantFor && !assistantCandidate) {
      cancelAssistant();
      setAssistantFor(null);
      setAssistantResult(null);
    }
  }, [assistantFor, assistantCandidate, cancelAssistant]);

  const openAssistant = (candidate, intent = {}) => {
    setAssistantResult(null);
    setAssistantFor({ candidateId: candidate.id, intent, opened: (assistantFor?.opened ?? 0) + 1 });
  };

  const closeAssistant = () => {
    assistant.cancel();
    setAssistantFor(null);
    setAssistantResult(null);
  };

  const assistantOpen = Boolean(assistantCandidate && assistant.panel.isOpen);

  // Applied edits are tested on a copy, or applied to the candidate (or, comparing models, the shared template).
  const finishAssistant = (action) => {
    if (!assistantResult || !assistantCandidate) return;
    const target = `Candidate ${candidateNumber(assistantCandidate)}`;

    try {
      action(assistantCandidate.id, validateTemplateJsonPayload(assistantResult));
    } catch (error) {
      notify("evaluation.applyAssistant", "failure", { error });

      return;
    }

    if (action === applyToCandidate) notify("evaluation.applyAssistant", "success", { targetName: target });
    closeAssistant();
  };

  const testLimit =
    state.candidates.length >= MAX_CANDIDATES
      ? `You can compare up to ${MAX_CANDIDATES} candidates. Remove one to test these changes on a copy.`
      : "";

  const assistantApplied =
    state.mode === "templates"
      ? {
          notice:
            testLimit ||
            "Ready to test. Test the changes on a copy and compare the results, or apply them to this candidate.",
          actions: (
            <>
              <Button variant="secondary" onClick={() => finishAssistant(applyToCandidate)}>
                Apply to candidate
              </Button>
              <Button disabled={Boolean(testLimit)} onClick={() => finishAssistant(testChanges)}>
                Test changes
              </Button>
            </>
          ),
        }
      : {
          notice: "Ready. Every candidate shares this template, so the changes apply to all of them. Run again to test.",
          actions: <Button onClick={() => finishAssistant(applyToCandidate)}>Apply to template</Button>,
        };

  // Opens the assistant on the candidate's template with its failing fields and their verified expected answers.
  const improveFailingFields = async (candidate) => {
    const owner = lifetime.current;

    try {
      const collected = await collectEvaluationEvidence(
        evaluation,
        candidate,
        `Candidate ${candidateNumber(candidate)}: ${labelFor(candidate)}`,
        document?.key,
      );

      if (owner !== lifetime.current || !collected) return;
      openAssistant(candidate, {
        instructions: improvementRequest(collected.fieldNames),
        evaluation: { evidence: collected.evidence, sample: collected.sample },
      });
    } catch (error) {
      if (owner === lifetime.current)
        notify("evaluation.improve", "failure", { error, retry: () => improveFailingFields(candidate) });
    }
  };

  // Copies the candidate with the edited template and runs the copy on the documents the original ran on.
  const testChanges = (candidateId, payload) => {
    const original = state.candidates.find((c) => c.id === candidateId);
    const copyId = original && evaluation.branch(original.id, { ...payload, source: modifiedSource(original.template.source) });

    if (!copyId) throw new Error("The copy couldn’t be created.");

    const tested = state.documents.flatMap((d) =>
      documentRunnable(d) && shownRecord(state.pairs[d.key]?.[original.id]) ? [d.key] : [],
    );

    setTrial({
      originalId: original.id,
      copyId,
      documentKeys: tested.length ? tested : runnable.map((d) => d.key),
      pending: true,
    });
    notify("evaluation.testChanges", "success", { targetName: `Candidate ${candidateNumber(original) + 1}` });
  };

  const removeTrialCopy = async () => {
    const copy = state.candidates.find((c) => c.id === trial.copyId);
    setTrial(null);

    if (copy) await removeCandidate(copy);
  };

  // In Template mode, input settings are shared by every candidate.
  const setInput = (candidate, key, value) =>
    state.mode === "models"
      ? edit(candidate.id, { [key]: value })
      : patch({ candidates: state.candidates.map((c) => ({ ...c, [key]: value, revision: c.revision + 1 })) });

  // Removes at once; the toast's Undo restores the candidate with its results.
  const removeCandidate = async (candidate) => {
    const undo = await evaluation.remove(candidate.id);

    if (undo)
      notify("evaluation.removeCandidate", "success", {
        targetName: candidate.model || candidate.template?.name,
        undo,
      });
  };

  const discardChanges = (document) => {
    const undo = evaluation.discardChanges(document.key);

    if (undo) notify("evaluation.discardChanges", "success", { undo });
  };

  // Plans "Accept all answers" for the open document, or for every document with a result from the candidate.
  const openAcceptAnswers = async (candidate, everyDocument) => {
    const owner = lifetime.current;

    if (!everyDocument) {
      const plan = planAcceptAnswers({ document, candidate, candidates: viewCandidates, alignments: state.alignments });

      setAccepting({ candidate, everyDocument, plans: [{ document, plan }] });

      return;
    }

    const plans = [];

    for (const current of state.documents) {
      const pairs = state.pairs[current.key] || {};
      const record = shown(pairs[candidate.id]);

      if (!record || (record === pairs[candidate.id].result && pairs[candidate.id].detail === "unavailable")) continue;
      let detail;

      try {
        detail = await evaluation.loadDetail(record.recordId);
      } catch {
        continue;
      }

      if (!detail) continue;
      const candidates = state.candidates.map((c) => ({ ...c, result: shown(pairs[c.id]) }));

      plans.push({
        document: current,
        plan: planAcceptAnswers({
          document: current,
          candidate: { ...candidate, result: { ...record, raw: detail.raw } },
          candidates,
          alignments: state.alignments,
        }),
      });
    }

    if (owner === lifetime.current) setAccepting({ candidate, everyDocument, plans });
  };

  const acceptAnswers = (candidate, changes) => {
    const undo = evaluation.acceptReferences(changes);

    if (undo)
      notify("evaluation.acceptAnswers", "success", { count: changes.length, targetName: labelFor(candidate), undo });
  };

  // Promotes a model candidate to the workspace extraction model. Only owners and admins see it.
  const extractionFor = (candidate) => {
    if (state.mode !== "models" || !modelConfiguration?.canManage) return null;
    const results = Object.values(state.pairs).map((byCandidate) => byCandidate[candidate.id]?.result);
    const { reason, model } = extractionModelAvailability(modelConfiguration, candidate, results);

    return { disabled: !!reason, reason, onClick: () => void promoteModel(model) };
  };

  const promoteModel = async (model) => {
    const record = modelConfiguration.record;
    const flag = (on) => (on ? "on" : "off");

    // Task roles without their own model follow the extraction model.
    const shared =
      !record.assistant_model && !record.classification_model
        ? " The Template assistant and document classification use it too."
        : !record.assistant_model
          ? " The Template assistant uses it too."
          : !record.classification_model
            ? " Document classification uses it too."
            : "";

    const changed = await confirmDialog({
      title: `Use “${model.model_name}” for extraction?`,
      body: `Extraction model: ${record.model_name} → ${model.model_name}, with Direct PDF input ${flag(model.supports_pdf_input)} and Structured output ${flag(model.supports_structured_output)}.${shared} To run candidates again afterwards, start a new evaluation.`,
      confirmLabel: "Change extraction model",
      pendingLabel: "Saving…",
      tone: "default",
      action: () => modelConfiguration.setExtractionModel(model),
    });

    if (changed)
      notify("workspace.extractionModel", "success", {
        targetName: model.model_name,
        link: onOpenWorkspace && { label: "Open model settings", onClick: onOpenWorkspace },
      });
  };

  // The candidate menu entry for "Use for extraction", with the reason when it's unavailable.
  const extractionAction = (candidate) => {
    const extraction = extractionFor(candidate);

    return (
      extraction && {
        label: "Use for extraction…",
        disabled: extraction.disabled,
        hint: extraction.reason,
        onClick: extraction.onClick,
      }
    );
  };

  const menuFor = (candidate) => ({
    inputs: { shared: state.mode === "templates" },
    onInputChange: (key, value) => setInput(candidate, key, value),
    // Shown as its own button beside the menu while the candidate fails verified fields.
    improve:
      enabled && failingFieldNames(state, document, candidate).length > 0
        ? () => void improveFailingFields(candidate)
        : null,
    actions: [
      { label: "Edit template", onClick: () => openEditor(candidate) },
      enabled && { label: "Ask assistant", onClick: () => openAssistant(candidate) },
      state.mode === "templates" && {
        label: "Choose another template version",
        onClick: () => setReplacement({ candidateId: candidate.id, source: candidate.template.source }),
      },
      { label: "Save as new template", onClick: () => openEditor(candidate, true) },
      {
        label: "Accept all answers…",
        disabled: !candidate.result,
        hint: candidate.result ? undefined : "Run this candidate on this document first.",
        onClick: () => void openAcceptAnswers(candidate, false),
      },
      batch && {
        label: "Accept answers for every document…",
        disabled: !Object.values(state.pairs).some((byCandidate) => shown(byCandidate[candidate.id])),
        onClick: () => void openAcceptAnswers(candidate, true),
      },
      extractionAction(candidate),
      {
        label: "Duplicate candidate",
        disabled: state.candidates.length >= MAX_CANDIDATES,
        onClick: () => evaluation.duplicate(candidate.id),
      },
      {
        label: "Remove candidate",
        danger: true,
        disabled: state.candidates.length <= 1 || busyFor(candidate.id),
        onClick: () => removeCandidate(candidate),
      },
    ],
  });

  const runFor = (candidate, index) => ({
    label: `Run candidate ${index + 1}`,
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

  // The library save dialogs hold unapplied edits. The template editor guards its own
  // edits once they differ from the opening draft.
  useUnsavedGuard(
    Boolean((dialog?.kind === "save" && dialogDocument) || (dialog?.kind === "update" && dialogDocument?.entry)),
    "Evaluation dialog",
  );
  const compatibility = document && documentCompatibility(document, fields);
  const saveUnavailable = saveUnavailableMessage(state.library);

  // Saved answers must cover every field that can be verified.
  const openSave = (kind) => {
    if (unverifiedFields(compatibility).length) {
      setMissingFor(document.key);
      notify(kind === "save" ? "library.save" : "library.updateSaved", "validation", { reason: "unverified" });

      return;
    }

    setMissingFor(null);
    open(kind, { key: document.key });
  };

  return (
    <div className={`evaluations-workspace${assistantOpen ? " has-assistant" : ""}`}>
    <section className="evaluations-page" aria-label="Evaluations">
      <PageHeader
        label="Evaluations"
        breadcrumbs={[workspaceCrumb, { label: "Evaluations" }].filter(Boolean)}
        title="Evaluations"
        description="Compare models or template versions on your documents."
        actions={
          <>
            {editingLibrary && (
              <>
                <Button variant="secondary" onClick={() => patch({ libraryEditor: null })}>
                  Back to evaluation
                </Button>
                <Button variant="secondary" onClick={() => open("manage")}>
                  Manage library
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={() => open("clear")}>
              Clear evaluation{unsaved ? ` · ${unsaved} unsaved` : ""}
            </Button>
            {!editingLibrary && (
              <Button
                disabled={runDisabled}
                onClick={() => evaluation.run(state.candidates.map((c) => c.id))}
              >{`Run all${state.candidates.length ? ` (${pluralize(state.candidates.length, "candidate")}${batch ? `, ${pluralize(runnable.length, "document")}` : ""})` : ""}`}</Button>
            )}
          </>
        }
      />
      {state.cacheError && (
        <Callout
          tone="danger"
          role="alert"
          title="Results can’t be saved in this browser."
          action={
            <>
              <Button variant="text" onClick={() => evaluation.retryCache()}>
                Try again
              </Button>
              <Button variant="danger-text" onClick={() => open("clear")}>
                Clear evaluation
              </Button>
            </>
          }
        >
          Runs are paused. Results already shown are kept.
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
          showActionToast={notify}
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
                    onClick={() => openSave("save")}
                  >
                    {document.save === "saving" ? "Saving…" : "Save to library…"}
                  </Button>
                )}
                {document && documentDirty(document) && (
                  <>
                    <Button variant="text"
                      onClick={() => openSave("update")}
                    >
                      Update saved answers…
                    </Button>
                    <Button variant="danger-text" onClick={() => discardChanges(document)}>
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
                    Choose template version
                  </Button>
                  <Button variant="text"
                    onClick={() =>
                      setEditor({
                        candidateId: "library-template",
                        documentKey: document.key,
                        initial: template,
                        notice: template.source
                          ? "Saves a new version of this template."
                          : "Changes apply to this document’s draft. Choose a template version to edit a saved template.",
                      })
                    }
                  >
                    Edit template
                  </Button>
                </span>
              </div>
            ) : state.mode === "models" ? (
              <div className="evaluation-context-item">
                <small>Shared template</small>
                <span className="evaluation-context-value" title={templateLabel(template)}>
                  {templateLabel(template)} · {fields.length} {fields.length === 1 ? "field" : "fields"}
                </span>
                <span className="evaluation-context-actions">
                  <Button variant="text" onClick={() => openEditor(state.candidates[0])}>
                    Edit shared template
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
          {trial && !editingLibrary && (
            <CandidateTrial
              evaluation={evaluation}
              trial={trial}
              labelFor={(candidate) => `Candidate ${candidateNumber(candidate)} (${labelFor(candidate)})`}
              onKeep={() => setTrial(null)}
              onRemove={() => void removeTrialCopy()}
              onRun={() => evaluation.run([trial.copyId], trial.documentKeys)}
            />
          )}
          {document && (
            <div className="evaluation-toolbar-row">
              <FieldFilters value={filter} onChange={setFilter} editing={editingLibrary} />
              {batch && (
                <nav className="evaluation-doc-nav" aria-label="Documents in this evaluation">
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
              showMissing={missingFor === document.key}
              extractionFor={extractionFor}
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
          title={replacement.documentKey ? "Choose template version" : "Choose candidate template"}
          action={replacement.documentKey ? "Use template version" : "Replace candidate template"}
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
          title={editor.save ? "Save as new template" : "Edit template"}
          action={editor.save ? "Save new template" : editor.documentKey && editor.initial.source ? "Save template" : "Apply changes"}
          onSubmit={applyTemplate}
          onClose={() => setEditor(null)}
          showActionToast={notify}
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
      {accepting && (
        <AcceptAnswersDialog
          candidateLabel={labelFor(accepting.candidate)}
          plans={accepting.plans}
          everyDocument={accepting.everyDocument}
          onAccept={(changes) => acceptAnswers(accepting.candidate, changes)}
          onClose={() => setAccepting(null)}
        />
      )}
      {preview && <DocumentPreview evaluation={evaluation} document={preview} onClose={() => setPreview(null)} />}
    </section>
      {assistantCandidate ? (
        <TemplateAssistant
          assistant={{ ...assistant.panel, onClose: closeAssistant }}
          draft={assistantDraft}
          issues={assistantIssues}
          allowJobs={false}
          eyebrow={`Candidate ${candidateNumber(assistantCandidate)}`}
          draftStatus={assistantCandidate.template.source?.modified ? "edited in this evaluation" : "as chosen for this evaluation"}
          applied={assistantApplied}
        />
      ) : null}
    </div>
  );
}
