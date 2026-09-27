import { useCallback, useEffect, useRef, useState } from "react";
import { validateTemplateJsonPayload } from "../templates/templateFields.js";

const id = () => crypto.randomUUID();
export const candidateBusy = candidate => ["submitting", "queued", "running", "retrying"].includes(candidate.status);
const empty = () => ({ id: id(), mode: "models", document: null, setup: null, candidates: [], references: {}, definitions: {}, alignments: {}, columns: {}, error: "", stale: false });
const makeCandidate = (template, setup) => ({ id: id(), revision: 0, template: structuredClone(template), model: setup.model, pdf: setup.pdf, structured: setup.structured, status: "idle", result: null });

export function useEvaluations({ workspaceId, sessionId, enabled, active, onForbidden }) {
  const [state, setState] = useState(empty);
  const stateRef = useRef(state);
  stateRef.current = state;
  const generation = useRef(0), requests = useRef(new Set()), pending = useRef(new Map());
  const scope = `${workspaceId}:${sessionId}:${enabled}`;
  const scopeRef = useRef(scope);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    generation.current++;
    for (const controller of requests.current) controller.abort();
    requests.current.clear(); pending.current.clear();
  }
  const clear = useCallback(() => {
    generation.current++;
    for (const controller of requests.current) controller.abort();
    requests.current.clear(); pending.current.clear();
    setState(empty());
  }, []);
  useEffect(() => { clear(); }, [scope, clear]);
  useEffect(() => {
    const controllers = requests.current;
    return () => { for (const controller of controllers) controller.abort(); };
  }, []);
  const api = useCallback(async (path, options = {}) => {
    const ownerGeneration = generation.current;
    const response = await fetch(`/v1${path}`, { credentials: "same-origin", ...options, headers: { "x-workspace-id": workspaceId, ...options.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      if ((response.status === 401 || response.status === 403) && ownerGeneration === generation.current) { clear(); onForbidden?.(); }
      const failure = new Error(body?.error?.message || "Request failed. Try again.");
      failure.code = body?.error?.code;
      throw failure;
    }
    return response;
  }, [workspaceId, clear, onForbidden]);
  const apiRef = useRef(api); apiRef.current = api;
  useEffect(() => {
    if (!active || !enabled || state.setup) return;
    const current = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    apiRef.current("/evaluations/setup", { signal: controller.signal }).then(r => r.json()).then(setup => {
      if (current === generation.current) setState(previous => ({ ...previous, setup, error: setup.configured ? "" : "Configure a model in Workspace settings to run Evaluations." }));
    }).catch(error => { if (current === generation.current && error.name !== "AbortError") setState(previous => ({ ...previous, error: error.message })); })
      .finally(() => requests.current.delete(controller));
    return () => controller.abort();
  }, [active, enabled, scope, state.setup]);
  const patch = update => setState(previous => ({ ...previous, ...update }));
  const edit = (candidateId, update) => setState(previous => ({ ...previous, candidates: previous.candidates.map(candidate => candidate.id === candidateId ? { ...candidate, ...update, revision: candidate.revision + 1 } : candidate) }));
  const start = template => {
    const validated = { ...validateTemplateJsonPayload(template), source: template.source };
    if (!state.setup?.configured) throw new Error("Configure the Workspace model first.");
    patch({ candidates: [makeCandidate(validated, state.setup), makeCandidate(validated, state.setup)], references: {}, definitions: {}, alignments: {}, columns: {}, error: "" });
  };
  const run = async candidateIds => {
    const before = stateRef.current;
    if (!enabled || !before.document || before.stale) return;
    const selected = before.candidates.filter(c => candidateIds.includes(c.id) && !pending.current.has(c.id) && !candidateBusy(c));
    if (!selected.length) return;
    const submissionId = id(), current = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    for (const c of selected) pending.current.set(c.id, submissionId);
    const candidates = selected.map(c => ({ id: c.id, revision: c.revision, model: c.model, pdf: c.pdf, structured: c.structured, fields: validateTemplateJsonPayload(c.template).fields }));
    setState(previous => ({ ...previous, error: "", candidates: previous.candidates.map(c => candidateIds.includes(c.id) && selected.some(s => s.id === c.id) ? { ...c, status: "submitting", message: "", submissionId } : c) }));
    const apply = update => { if (generation.current === current) setState(previous => ({ ...previous, candidates: previous.candidates.map(c => c.submissionId === submissionId ? update(c) : c) })); };
    try {
      const form = new FormData(); form.append("document", before.document);
      form.append("evaluation", JSON.stringify({ id: submissionId, evaluationId: before.id, revision: before.setup.revision, mode: before.mode, candidates }));
      const response = await apiRef.current("/evaluations/run", { method: "POST", body: form, signal: controller.signal, headers: { "x-evaluation-submission": submissionId } });
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 5 * 1024 * 1024) throw new Error("Evaluation result exceeded the delivery limit.");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
          if (event.submissionId !== submissionId || generation.current !== current) continue;
          if (event.type === "cleanup") setState(previous => ({ ...previous, candidates: previous.candidates.map(c => c.result?.submissionId === submissionId ? { ...c, cleanup: event.status } : c) }));
          else if (event.type === "interrupted") apply(c => candidateBusy(c) ? { ...c, status: "interrupted", message: event.message } : c);
          else if (event.candidateId && candidates.some(c => c.id === event.candidateId && c.revision === event.revision)) {
            if (["success", "failure"].includes(event.type) && pending.current.get(event.candidateId) === submissionId) pending.current.delete(event.candidateId);
            apply(c => c.id !== event.candidateId ? c : { ...c, status: event.type, attempt: event.attempt, message: event.message || "", ...(event.type === "success" ? { result: { ...event.result, submissionId, revision: event.revision, templateName: selected.find(s => s.id === c.id).template.name, source: selected.find(s => s.id === c.id).template.source }, cleanup: "unconfirmed" } : {}) });
          }
        }
      }
    } catch (error) {
      if (generation.current === current) {
        if (error.code === "configuration_changed") patch({ stale: true, error: error.message });
        apply(c => candidateBusy(c) ? { ...c, status: "interrupted", message: error.message || "Connection lost. Run again manually." } : c);
      }
    } finally {
      if (generation.current === current) {
        apply(c => candidateBusy(c) ? { ...c, status: "interrupted", message: "Connection ended before this run finished. Run again manually." } : c);
        for (const c of selected) if (pending.current.get(c.id) === submissionId) pending.current.delete(c.id);
      }
      requests.current.delete(controller);
    }
  };
  return { state, patch, edit, start, run, clear, api,
    duplicate(candidateId) { const candidate = state.candidates.find(c => c.id === candidateId); if (candidate && state.candidates.length < 8) { const copy = makeCandidate(candidate.template, candidate); patch({ candidates: [...state.candidates, copy] }); return copy.id; } },
    changeMode(mode) { if (state.candidates.some(candidateBusy) || mode === state.mode) return; if (state.candidates.length && !window.confirm("Change mode and discard candidate drafts, results and expected answers? The document will be kept.")) return; patch({ mode, candidates: [], references: {}, definitions: {}, alignments: {}, columns: {} }); },
    confirmDiscard() { return !stateRef.current.document && !stateRef.current.candidates.length || window.confirm("Discard this temporary Evaluation and switch Workspace?"); },
  };
}
