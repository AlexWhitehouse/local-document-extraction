import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diagnoseTemplateDraft, evaluateSelection, validateAssistantOutput } from "../../../../shared/templateAssistant.ts";
import { SOURCE_FILE_MIME_TYPES } from "../../lib/runtimeConfiguration";
import { suggestTemplateRequests } from "./templateAssistantSuggestions.js";

const SUGGESTION_DELAY_MS = 400;
// Include extraction guidance; the assistant's request text is separate and never triggers a refetch.
const suggestionContext = draft => [draft?.name, draft?.description, (Array.isArray(draft?.fields) ? draft.fields : []).map(field => [field?.name, field?.description, field?.data_type,
  (Array.isArray(field?.object_schema?.columns) ? field.object_schema.columns : []).map(column => [column?.heading, column?.description, column?.data_type])]),
  diagnoseTemplateDraft(draft)];

/** Private, proposal-only state. Every asynchronous acceptance checks monotonic lifetimes. */
export function useTemplateAssistant({ request, workspaceId, sessionId, activePage, templateId, templateVersion, hasApiAccess,
  draft, revision, getRevision, onApply, maxSourceFileBytes = 10 * 1024 * 1024 }) {
  const [isOpen, setOpen] = useState(false);
  const [action, setAction] = useState("edit");
  const [instructions, setInstructions] = useState("");
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [useRetainedSource, setRetainedSource] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [stale, setStale] = useState(false);
  const [applied, setApplied] = useState(false);
  const [picker, setPicker] = useState({ isOpen: false, jobs: [], cursors: [null], page: 0, nextCursor: null, loading: false, error: "" });
  const editorId = useRef(null);
  if (!editorId.current) editorId.current = crypto.randomUUID();
  const scope = JSON.stringify([workspaceId, sessionId, activePage, templateId, hasApiAccess]);
  const lifetime = useRef({ scope, generation: 0, requestId: 0, controller: null, evidenceController: null, open: false, consumed: false, hasWork: false });
  const live = lifetime.current;
  if (live.scope !== scope) {
    live.scope = scope; live.generation += 1; live.requestId += 1; live.open = false;
    live.controller?.abort(); live.evidenceController?.abort();
  }
  const context = useRef(null);
  context.current = { draft, revision, getRevision, onApply, request, scope };

  const cancel = useCallback(() => {
    const state = lifetime.current;
    state.requestId += 1; state.generation += 1; state.open = false; state.hasWork = false;
    state.controller?.abort(); state.evidenceController?.abort(); state.controller = null;
    setOpen(false); setPending(false); setResponse(null); setSelectedIds(new Set());
    setInstructions(""); setFile(null); setJob(null); setRetainedSource(false); setError("");
    setStale(false); setApplied(false);
    setPicker({ isOpen: false, jobs: [], cursors: [null], page: 0, nextCursor: null, loading: false, error: "" });
  }, []);
  useEffect(() => {
    const state = lifetime.current; cancel();
    return () => { state.controller?.abort(); state.evidenceController?.abort(); state.open = false; state.generation += 1; };
  }, [scope, cancel]);

  const invalidate = useCallback(() => {
    const state = lifetime.current;
    state.requestId += 1; state.controller?.abort(); state.controller = null;
    setPending(false); setApplied(false);
    setStale(state.hasWork);
  }, []);
  useEffect(() => {
    if (response && response.base.revision !== revision) {
      lifetime.current.controller?.abort(); setPending(false); setStale(true);
    }
  }, [revision, response]);

  function revise(change) {
    invalidate(); lifetime.current.hasWork = false; setResponse(null); setSelectedIds(new Set()); setStale(false); setError(""); change();
  }
  function open() {
    cancel(); lifetime.current.open = true; setOpen(true);
    setAction(diagnoseTemplateDraft(context.current.draft).length ? "explain" : "edit");
  }
  function isCurrent(captured) {
    const state = lifetime.current;
    return state.open && state.generation === captured.scopeGeneration && state.requestId === captured.requestId &&
      context.current.scope === captured.scope && context.current.getRevision() === captured.revision &&
      (!captured.draftSnapshot || JSON.stringify(context.current.draft) === captured.draftSnapshot);
  }
  async function submit() {
    if (!lifetime.current.open || !hasApiAccess || lifetime.current.controller) return;
    if (action === "edit" && !instructions.trim()) { setError("Describe the change you want to make."); return; }
    if (new TextEncoder().encode(instructions).length > 4096) { setError("Keep your request within 4 KiB."); return; }
    if (file && (!SOURCE_FILE_MIME_TYPES.includes(file.type) || !file.size || file.size > maxSourceFileBytes)) {
      setError(`Choose one nonempty PDF, PNG, JPEG, or WebP up to ${maxSourceFileBytes / 1024 / 1024} MiB.`); return;
    }
    lifetime.current.controller?.abort();
    const controller = new AbortController();
    lifetime.current.controller = controller; lifetime.current.hasWork = true;
    const base = { editorId: editorId.current, revision: context.current.getRevision(), requestId: ++lifetime.current.requestId,
      scopeGeneration: lifetime.current.generation, templateId };
    const baseDraft = structuredClone(context.current.draft);
    const captured = { ...base, scope, draftSnapshot: JSON.stringify(baseDraft) };
    setPending(true); setResponse(null); setSelectedIds(new Set()); setError(""); setStale(false); setApplied(false);
    try {
      const body = new FormData();
      body.append("payload", JSON.stringify({ draft: baseDraft, action, instructions, base, ...(job ? { jobId: job.job_id, useRetainedSource } : {}) }));
      if (file) body.append("document", file);
      const answer = await request("/templates/assist", { method: "POST", body, signal: controller.signal });
      if (!isCurrent(captured) || controller.signal.aborted) return;
      if (!answer || JSON.stringify(answer.base) !== JSON.stringify(base)) throw new Error("The response belongs to a different draft. Please regenerate it.");
      if (answer.evidence && ((job && answer.evidence.job?.job_id !== job.job_id) ||
          (file && answer.evidence.source !== "separate_uploaded_sample") ||
          (useRetainedSource && answer.evidence.source !== "retained_source_of_selected_job"))) {
        throw new Error("The response did not use the evidence you selected. Please retry or explicitly change the evidence.");
      }
      // Validate the model contract again before exposing or applying its operations.
      const output = { explanation: answer.explanation, observations: answer.observations, groups: answer.groups };
      const evidence = answer.evidence?.job || job;
      validateAssistantOutput(output, baseDraft, action, { resultFields: evidence?.fields, result: Array.isArray(evidence?.results) ? Object.fromEntries(evidence.results.map(row => [row.field_id, row.answer])) : evidence?.results, sampleSupplied: Boolean(file || useRetainedSource) });
      lifetime.current.consumed = false;
      setResponse({ ...output, base, captured, baseDraft, evidence: answer.evidence || job });
      setSelectedIds(new Set(output.groups.map(group => group.id)));
    } catch (failure) {
      if (isCurrent(captured) && !controller.signal.aborted) setError(failure.message || "Assistance failed. Your draft is unchanged; please retry.");
    } finally {
      if (isCurrent(captured)) { lifetime.current.controller = null; setPending(false); }
    }
  }
  // Suggested requests come from the model while composing; the app's checks stand in when it is unavailable.
  const [suggestions, setSuggestions] = useState({ status: "idle", source: null, items: [], notice: "" });
  const isComposing = isOpen && !pending && !response && !applied;
  const suggestionKey = isComposing ? JSON.stringify([scope, action, job?.job_id ?? null, file ? [file.name, file.size] : null, suggestionContext(draft)]) : null;
  useEffect(() => {
    if (!suggestionKey) return undefined;
    const { draft: current, request: send } = context.current;
    const fallback = notice => setSuggestions({ status: "ready", source: "rules", notice,
      items: suggestTemplateRequests({ draft: current, issues: diagnoseTemplateDraft(current), action, job, file }) });
    if (!hasApiAccess) { fallback(""); return undefined; }
    const controller = new AbortController();
    setSuggestions(previous => ({ ...previous, status: "loading" }));
    const timer = setTimeout(async () => {
      try {
        const data = await send("/templates/assist/suggestions", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
          body: JSON.stringify({ draft: current, action, ...(job ? { jobId: job.job_id } : {}), ...(file ? { sampleName: file.name } : {}) }) });
        if (controller.signal.aborted) return;
        if (!Array.isArray(data?.suggestions)) throw new Error("Unsupported suggestions response");
        setSuggestions({ status: "ready", source: "model", items: data.suggestions, notice: "" });
      } catch (failure) {
        if (controller.signal.aborted) return;
        fallback(failure?.code === "workspace_model_not_configured"
          ? "No model is configured for this Workspace, so these come from the app’s checks."
          : "Suggestions couldn’t be generated just now, so these come from the app’s checks.");
      }
    }, SUGGESTION_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // The key captures the draft structure and guidance, evidence, tab and scope that suggestions depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionKey]);

  const selection = useMemo(() => response ? evaluateSelection(response.baseDraft, response.groups, selectedIds) : null, [response, selectedIds]);
  function apply() {
    if (!response || stale || lifetime.current.consumed || !isCurrent(response.captured)) { setStale(true); return; }
    const checked = evaluateSelection(response.baseDraft, response.groups, selectedIds);
    if (!checked.canApply) return;
    lifetime.current.consumed = true; lifetime.current.hasWork = false; lifetime.current.requestId += 1;
    context.current.onApply(checked.result);
    setResponse(null); setSelectedIds(new Set()); setApplied(true); setStale(false);
  }
  async function loadEvidencePage(cursor = null, page = 0, cursors = [null]) {
    const state = lifetime.current;
    state.evidenceController?.abort();
    const controller = new AbortController(); state.evidenceController = controller;
    const generation = state.generation;
    setPicker(previous => ({ ...previous, isOpen: true, loading: true, error: "" }));
    try {
      const data = await request(`/templates/assist/evidence?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET", signal: controller.signal });
      if (!state.open || controller.signal.aborted || generation !== state.generation) return;
      setPicker({ isOpen: true, jobs: data.jobs || [], nextCursor: data.next_cursor || null, cursors, page, loading: false, error: "" });
    } catch (failure) {
      if (state.open && !controller.signal.aborted && generation === state.generation) setPicker(previous => ({ ...previous, loading: false, error: failure.message }));
    }
  }
  async function chooseJob(jobId) {
    const state = lifetime.current;
    state.evidenceController?.abort();
    const controller = new AbortController(); state.evidenceController = controller;
    const generation = state.generation;
    setPicker(previous => ({ ...previous, loading: true, error: "" }));
    try {
      const detail = await request(`/templates/assist/evidence/${encodeURIComponent(jobId)}`, { method: "GET", signal: controller.signal });
      if (!state.open || controller.signal.aborted || generation !== state.generation) return;
      revise(() => { setJob(detail); setRetainedSource(false); });
      setPicker(previous => ({ ...previous, isOpen: false, loading: false }));
    } catch (failure) {
      if (state.open && !controller.signal.aborted && generation === state.generation) setPicker(previous => ({ ...previous, loading: false, error: failure.message }));
    }
  }
  return { open, cancel, invalidate, panel: {
    isOpen, action, instructions, file, job, templateId, suggestions, templateVersion, useRetainedSource, pending, error, response, selectedIds, selection, stale, applied, revision,
    onActionChange: value => revise(() => setAction(value)), onInstructionsChange: value => revise(() => setInstructions(value)),
    onFileChange: value => revise(() => { setFile(value); if (value) setRetainedSource(false); }),
    onRetainedSourceChange: value => revise(() => { setRetainedSource(value); if (value) setFile(null); }),
    onRemoveJob: () => revise(() => { setJob(null); setRetainedSource(false); }),
    onToggleGroup: id => setSelectedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    onSubmit: submit, onApply: apply, onClose: cancel,
    onCancelRequest: () => { invalidate(); setError("Request cancelled. Your draft is unchanged."); },
    picker: { ...picker, onOpen: () => loadEvidencePage(), onChoose: chooseJob,
      onClose: () => { lifetime.current.evidenceController?.abort(); setPicker(previous => ({ ...previous, isOpen: false, loading: false })); },
      onNext: () => loadEvidencePage(picker.nextCursor, picker.page + 1, [...picker.cursors.slice(0, picker.page + 1), picker.nextCursor]),
      onPrevious: () => loadEvidencePage(picker.cursors[picker.page - 1], picker.page - 1, picker.cursors),
    },
  } };
}
