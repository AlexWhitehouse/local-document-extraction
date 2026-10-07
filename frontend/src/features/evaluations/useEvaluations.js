import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { validateTemplateJsonPayload } from "../templates/templateFields.js";
import { confirmDialog } from "../ui/confirm.jsx";
import { createLibraryClient, documentDirty, emptyReferenceSet, parseReferenceSet } from "./evaluationLibrary.js";
import { createResultCache } from "./resultCache.js";

const id = () => crypto.randomUUID();

export const MAX_CANDIDATES = 8;

const BUSY = ["staged", "submitting", "queued", "running", "retrying"];

export const pairBusy = (pair) => BUSY.includes(pair?.status);

export const candidateBusy = (candidate) => BUSY.includes(candidate?.status);

export const documentRunnable = (document) => (document.availability || "ok") === "ok";

const empty = () => ({
  id: id(),
  mode: "models",
  documents: [],
  setup: null,
  library: null,
  libraryEditor: null,
  candidates: [],
  pairs: {},
  alignments: {},
  columns: {},
  error: "",
  stale: false,
  cacheError: null,
  libraryVersion: 0,
});

const makeCandidate = (template, setup) => ({
  id: id(),
  revision: 0,
  template: structuredClone(template),
  model: setup.model,
  pdf: setup.pdf,
  structured: setup.structured,
});

const uploadDocument = (file) => ({
  key: id(),
  kind: "upload",
  file,
  name: file.name,
  reference: emptyReferenceSet(),
  save: "idle",
  availability: "ok",
});

const savedDocument = ({ document, reference }) => ({
  key: id(),
  kind: "saved",
  entry: document,
  name: document.name,
  loadedRevision: document.revision,
  reference: parseReferenceSet(reference),
  base: parseReferenceSet(reference),
  save: "idle",
  availability: "ok",
});

const SOURCE_FAILURES = {
  source_missing: ["missing", "The saved original is missing, so this document can’t run."],
  source_unavailable: ["unavailable", "The saved original can’t be read right now. Retry it, then run again."],
  document_not_found: ["deleted", "Deleted from the Evaluation library."],
};

const SAVE_FAILURES = {
  operation_conflict:
    "An earlier attempt to save this document may have finished with different details. Check the library, or save it as a new entry.",
  document_deleted: "This document was saved earlier and then deleted from the library. Save it again as a new entry.",
};

export function useEvaluations({
  workspaceId,
  sessionId,
  enabled,
  active,
  onForbidden,
  createCache = createResultCache,
}) {
  const [state, setState] = useState(empty);
  const [, setDetailVersion] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Browser-side guards live outside React state so double clicks can't race a render.
  const generation = useRef(0),
    requests = useRef(new Set()),
    owners = useRef(new Map());

  const staging = useRef({ queue: [], open: 0, paused: false });
  const cacheFactory = useRef(createCache);
  cacheFactory.current = createCache;
  const cacheRef = useRef(null);

  if (!cacheRef.current) cacheRef.current = createCache();

  // Run actions hold captured model settings on the server; release them when their lifetime ends.
  const liveActions = useRef(new Set()),
    actionWorkspace = useRef(workspaceId);

  // Ends the live Evaluation: late events, staged work and decrypted details all belong to the old lifetime.
  const retire = useCallback(() => {
    const workspace = actionWorkspace.current;

    for (const action of liveActions.current)
      action.ready
        .then(
          (id) =>
            id &&
            fetch(`/v1/evaluations/actions/${encodeURIComponent(id)}`, {
              method: "DELETE",
              credentials: "same-origin",
              headers: { "x-workspace-id": workspace },
            }),
        )
        .catch(() => {});
    liveActions.current.clear();
    generation.current++;

    for (const controller of requests.current) controller.abort();
    requests.current.clear();
    owners.current.clear();
    staging.current = { queue: [], open: 0, paused: false };
    cacheRef.current.invalidate();
    cacheRef.current = cacheFactory.current();
  }, []);

  const scope = `${workspaceId}:${sessionId}:${enabled}`;
  const scopeRef = useRef(scope);

  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    retire();
  }

  actionWorkspace.current = workspaceId;

  const clear = useCallback(() => {
    retire();
    setState(empty());
  }, [retire]);

  useEffect(() => {
    clear();
  }, [scope, clear]);
  useEffect(() => {
    const controllers = requests.current;
    // Leaving the document (including into the back/forward cache) discards; a restored page starts empty.
    const hide = () => flushSync(() => clear());

    const show = (event) => {
      if (event.persisted) clear();
    };

    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);

    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);

      for (const controller of controllers) controller.abort();
      cacheRef.current.invalidate();
    };
  }, [clear]);

  const api = useCallback(
    async (path, options = {}) => {
      const ownerGeneration = generation.current;

      const response = await fetch(`/v1${path}`, {
        credentials: "same-origin",
        ...options,
        headers: { "x-workspace-id": workspaceId, ...options.headers },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);

        if (
          (response.status === 401 || (response.status === 403 && body?.error?.code !== "save_unavailable")) &&
          ownerGeneration === generation.current
        ) {
          clear();
          onForbidden?.();
        }

        const failure = new Error(body?.error?.message || "Request failed. Try again.");
        failure.code = body?.error?.code || response.headers.get("x-error-code") || undefined;
        failure.status = response.status;
        failure.body = body;
        throw failure;
      }

      return response;
    },
    [workspaceId, clear, onForbidden],
  );

  const apiRef = useRef(api);
  apiRef.current = api;
  const library = useMemo(() => createLibraryClient((...args) => apiRef.current(...args)), []);
  useEffect(() => {
    if (!active || !enabled || state.setup) return;
    const current = generation.current;
    const controller = new AbortController();
    requests.current.add(controller);
    apiRef
      .current("/evaluations/setup", { signal: controller.signal })
      .then((r) => r.json())
      .then((setup) => {
        if (current === generation.current)
          setState((previous) => ({
            ...previous,
            setup,
            error: setup.configured ? "" : "Configure a model in Workspace settings to run Evaluations.",
          }));
      })
      .catch((error) => {
        if (current === generation.current && error.name !== "AbortError")
          setState((previous) => ({ ...previous, error: error.message }));
      })
      .finally(() => requests.current.delete(controller));
    library
      .status()
      .then((status) => {
        if (current === generation.current) setState((previous) => ({ ...previous, library: status }));
      })
      .catch(() => {
        if (current === generation.current)
          setState((previous) => ({ ...previous, library: { save_available: false, reason: null } }));
      });

    return () => controller.abort();
  }, [active, enabled, scope, state.setup, library]);

  const patch = (update) => setState((previous) => ({ ...previous, ...update }));

  const updateDocument = (key, update) =>
    setState((previous) => ({
      ...previous,
      documents: previous.documents.map((d) => (d.key === key ? { ...d, ...update(d) } : d)),
    }));

  const patchDocument = (key, update) => updateDocument(key, () => update);

  // Applies an update to pairs still owned by one staged operation, so late or foreign events are ignored.
  const updatePairs = (docKey, owner, update, only) =>
    setState((previous) => {
      const pairs = previous.pairs[docKey];

      if (!pairs) return previous;
      let changed = false;

      const next = Object.fromEntries(
        Object.entries(pairs).map(([candidateId, pair]) => {
          if (pair.owner !== owner || (only && !only.includes(candidateId))) return [candidateId, pair];
          changed = true;

          return [candidateId, { ...pair, ...update(pair, candidateId) }];
        }),
      );

      return changed ? { ...previous, pairs: { ...previous.pairs, [docKey]: next } } : previous;
    });

  const release = (docKey, candidateId, owner) => {
    const key = `${docKey}|${candidateId}`;

    if (owners.current.get(key) === owner) owners.current.delete(key);
  };

  // ---------- Result details that could not be kept ----------
  const markUnavailable = (docKey, candidateId, recordId, error) =>
    setState((previous) => {
      const pair = previous.pairs[docKey]?.[candidateId];

      if (!pair) return previous;

      const next =
        pair.result?.recordId === recordId
          ? { ...pair, detail: "unavailable" }
          : pair.previous?.recordId === recordId
            ? { ...pair, previous: null }
            : pair;

      return {
        ...previous,
        cacheError: previous.cacheError || { message: error.message, code: error.code },
        pairs: { ...previous.pairs, [docKey]: { ...previous.pairs[docKey], [candidateId]: next } },
      };
    });

  const pauseStaging = (error) => {
    staging.current.paused = true;
    patch({ cacheError: { message: error.message, code: error.code } });
  };

  // ---------- Staged execution ----------
  const createAction = async (evaluationId, revision) => {
    try {
      return (
        await (
          await apiRef.current("/evaluations/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ evaluation_id: evaluationId, revision }),
          })
        ).json()
      ).action_id;
    } catch (error) {
      if (error.code === "not_found") return null;
      throw error;
    }
  };

  const settleAction = (action) => {
    if (--action.remaining > 0) return;
    liveActions.current.delete(action);

    if (!action.id) return;
    apiRef.current(`/evaluations/actions/${encodeURIComponent(action.id)}`, { method: "DELETE" }).catch(() => {});
  };

  const pump = () => {
    const work = staging.current;

    while (
      !work.paused &&
      work.queue.length &&
      work.open < Math.max(1, stateRef.current.setup?.staging?.document_concurrency || 1)
    ) {
      // Pending encrypted writes are bounded in bytes; wait for them before opening more documents.
      if (!cacheRef.current.hasCapacity()) {
        const current = generation.current;
        cacheRef.current.drained().then(() => {
          if (current === generation.current) pump();
        });

        return;
      }

      const operation = work.queue.shift();

      if (operation.generation !== generation.current) continue;
      work.open++;
      runOperation(operation).finally(() => {
        if (operation.generation !== generation.current) return;
        work.open--;
        settleAction(operation.action);
        pump();
      });
    }
  };

  const acceptResult = (operation, snapshot, event) => {
    const { raw, values, fields, ...meta } = event.result || {};

    const docKey = operation.document.key,
      recordId = id(),
      cache = cacheRef.current,
      current = generation.current;

    const result = {
      ...meta,
      fields: fields || snapshot.fields,
      recordId,
      submissionId: event.submissionId,
      revision: event.revision,
      templateName: snapshot.templateName,
      source: snapshot.source,
    };

    const detail = { raw: raw || [], values: values || null };
    const superseded = stateRef.current.pairs[docKey]?.[snapshot.id]?.previous?.recordId;
    setState((previous) => {
      const pair = previous.pairs[docKey]?.[snapshot.id];

      if (!pair || pair.owner !== operation.owner) return previous;

      // A successful current attempt replaces the previous result: current plus one previous at most.
      return {
        ...previous,
        pairs: {
          ...previous.pairs,
          [docKey]: {
            ...previous.pairs[docKey],
            [snapshot.id]: {
              ...pair,
              status: "success",
              attempt: event.attempt,
              message: "",
              result,
              previous: null,
              detail: "pending",
              cleanup: "unconfirmed",
            },
          },
        },
      };
    });

    if (superseded) cache.remove(superseded);
    cache
      .put(recordId, detail)
      .then(() => {
        if (current === generation.current)
          setState((previous) => {
            const pair = previous.pairs[docKey]?.[snapshot.id];

            return pair?.result?.recordId === recordId
              ? {
                  ...previous,
                  pairs: {
                    ...previous.pairs,
                    [docKey]: { ...previous.pairs[docKey], [snapshot.id]: { ...pair, detail: "retained" } },
                  },
                }
              : previous;
          });
      })
      .catch((error) => {
        if (current === generation.current && error.code !== "invalidated") {
          markUnavailable(docKey, snapshot.id, recordId, error);
          pauseStaging(error);
        }
      });
  };

  const send = async (operation, submissionId, actionId, signal) => {
    const { document, candidates, evaluation } = operation;

    const body = {
      id: submissionId,
      evaluationId: evaluation.id,
      revision: evaluation.revision,
      mode: evaluation.mode,
      document_instance_id: document.key,
      candidates: candidates.map(({ id: candidateId, revision, model, pdf, structured, fields }) => ({
        id: candidateId,
        revision,
        model,
        pdf,
        structured,
        fields,
      })),
    };

    if (actionId) body.action_id = actionId;

    const headers = { "x-evaluation-submission": submissionId };

    if (document.kind === "saved")
      return apiRef.current("/evaluations/run", {
        method: "POST",
        signal,
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ ...body, document: { kind: "saved", id: document.entryId } }),
      });
    const form = new FormData();
    form.append("document", document.file);
    form.append("evaluation", JSON.stringify(body));

    return apiRef.current("/evaluations/run", { method: "POST", signal, headers, body: form });
  };

  const runOperation = async (operation) => {
    const { document, candidates, owner, action } = operation;

    const current = operation.generation,
      docKey = document.key;

    const apply = (update, only) => {
      if (generation.current === current) updatePairs(docKey, owner, update, only);
    };

    const controller = new AbortController();
    requests.current.add(controller);
    let submissionId = id();

    try {
      let actionId = await action.ready;

      if (generation.current !== current) return;
      apply(() => ({ status: "submitting", submissionId }));
      let response;

      for (let attempt = 0; ; attempt++) {
        try {
          response = await send(operation, submissionId, actionId, controller.signal);
          break;
        } catch (error) {
          // A released or restarted action is replaced once; the new action captures current configuration.
          if (error.code !== "action_expired" || attempt > 0 || generation.current !== current) throw error;

          if (action.id === actionId) {
            action.ready = createAction(operation.evaluation.id, operation.evaluation.revision).then((next) => {
              action.id = next;

              return next;
            });
          }

          actionId = await action.ready;
          submissionId = id();
          apply(() => ({ submissionId }));
        }
      }

      const reader = response.body.getReader(),
        decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        if (buffer.length > 5 * 1024 * 1024) throw new Error("Evaluation result exceeded the delivery limit.");
        let newline;

        while ((newline = buffer.indexOf("\n")) >= 0) {
          const event = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);

          if (
            event.submissionId !== submissionId ||
            generation.current !== current ||
            (event.document_instance_id && event.document_instance_id !== docKey)
          )
            continue;

          if (event.type === "cleanup")
            setState((previous) => {
              const pairs = previous.pairs[docKey];

              if (!pairs) return previous;

              return {
                ...previous,
                pairs: {
                  ...previous.pairs,
                  [docKey]: Object.fromEntries(
                    Object.entries(pairs).map(([key, pair]) => [
                      key,
                      pair.result?.submissionId === submissionId ? { ...pair, cleanup: event.status } : pair,
                    ]),
                  ),
                },
              };
            });
          else if (event.type === "interrupted")
            apply((pair) => (pairBusy(pair) ? { status: "interrupted", message: event.message } : {}));
          else {
            const snapshot =
              event.candidateId && candidates.find((c) => c.id === event.candidateId && c.revision === event.revision);

            if (!snapshot || !["queued", "running", "retrying", "success", "failure"].includes(event.type)) continue;

            if (event.type === "success") acceptResult(operation, snapshot, event);
            else
              apply(
                () => ({ status: event.type, attempt: event.attempt, message: event.message || "" }),
                [snapshot.id],
              );

            if (event.type === "failure" && event.code === "document_deleted")
              patchDocument(docKey, { availability: "deleted" });

            if (["success", "failure"].includes(event.type)) release(docKey, snapshot.id, owner);
          }
        }
      }
    } catch (error) {
      if (generation.current === current) {
        const source = SOURCE_FAILURES[error.code];

        if (source) {
          patchDocument(docKey, { availability: source[0] });
          apply((pair) => (pairBusy(pair) ? { status: "failure", message: source[1] } : {}));
        } else {
          if (error.code === "configuration_changed") patch({ stale: true, error: error.message });
          apply((pair) =>
            pairBusy(pair)
              ? { status: "interrupted", message: error.message || "Connection lost. Run again manually." }
              : {},
          );
        }
      }
    } finally {
      if (generation.current === current) {
        apply((pair) =>
          pairBusy(pair)
            ? { status: "interrupted", message: "Connection ended before this run finished. Run again manually." }
            : {},
        );

        for (const candidate of candidates) release(docKey, candidate.id, owner);
      }

      requests.current.delete(controller);
    }
  };

  // One Run click is one action: its targets, candidate snapshots and configuration are fixed now.
  const run = (candidateIds, docKeys) => {
    const before = stateRef.current;

    if (!enabled || before.stale || !before.setup?.configured) return;

    const snapshot = (c) => ({
      id: c.id,
      revision: c.revision,
      model: c.model,
      pdf: c.pdf,
      structured: c.structured,
      fields: validateTemplateJsonPayload(c.template).fields,
      templateName: c.template.name,
      source: c.template.source,
    });

    const candidates = before.candidates.filter((c) => candidateIds.includes(c.id) && c.model.trim());
    const operations = [];

    for (const document of before.documents) {
      if ((docKeys && !docKeys.includes(document.key)) || !documentRunnable(document)) continue;

      const idle = candidates.filter(
        (c) => !owners.current.has(`${document.key}|${c.id}`) && !pairBusy(before.pairs[document.key]?.[c.id]),
      );

      if (idle.length)
        operations.push({
          owner: id(),
          generation: generation.current,
          evaluation: { id: before.id, revision: before.setup.revision, mode: before.mode },
          document: { key: document.key, kind: document.kind, file: document.file, entryId: document.entry?.id },
          candidates: idle.map(snapshot),
        });
    }

    if (!operations.length) return;

    for (const operation of operations)
      for (const c of operation.candidates) owners.current.set(`${operation.document.key}|${c.id}`, operation.owner);

    // The last successful output stays visible as Previous result while the new attempt runs.
    const staged = (pair) =>
      pair?.result ? (pair.detail !== "unavailable" ? pair.result : null) : pair?.previous || null;

    for (const { document, candidates: targets } of operations)
      for (const c of targets) {
        const pair = before.pairs[document.key]?.[c.id];

        for (const record of [pair?.result, pair?.previous])
          if (record && record !== staged(pair)) cacheRef.current.remove(record.recordId);
      }

    setState((previous) => {
      const pairs = { ...previous.pairs };

      for (const { document, candidates: targets, owner } of operations) {
        pairs[document.key] = { ...pairs[document.key] };

        for (const c of targets) {
          const pair = pairs[document.key][c.id];
          pairs[document.key][c.id] = {
            status: "staged",
            attempt: 0,
            message: "",
            owner,
            submissionId: null,
            result: null,
            previous: staged(pair),
            detail: null,
            cleanup: pair?.cleanup,
          };
        }
      }

      return { ...previous, error: "", pairs };
    });
    const action = { id: null, remaining: operations.length };
    action.ready = createAction(before.id, before.setup.revision).then((actionId) => {
      action.id = actionId;

      return actionId;
    });
    action.ready.catch(() => {});
    liveActions.current.add(action);

    for (const operation of operations) {
      operation.action = action;
      staging.current.queue.push(operation);
    }

    pump();
  };

  // ---------- Documents, working copies and the shared library ----------
  const dropPairs = (previous, keep) => {
    for (const [docKey, byCandidate] of Object.entries(previous.pairs))
      for (const [candidateId, pair] of Object.entries(byCandidate)) {
        if (keep(docKey, candidateId)) continue;

        for (const record of [pair.result, pair.previous]) if (record) cacheRef.current.remove(record.recordId);
      }
  };

  const anyBusy = (docKey, candidateId) =>
    Object.entries(stateRef.current.pairs).some(
      ([key, byCandidate]) =>
        (!docKey || key === docKey) &&
        Object.entries(byCandidate).some(([cid, pair]) => (!candidateId || cid === candidateId) && pairBusy(pair)),
    );

  const stopStaged = (docKeys, message) => {
    const work = staging.current;
    const stopped = work.queue.filter((operation) => docKeys.includes(operation.document.key));
    work.queue = work.queue.filter((operation) => !docKeys.includes(operation.document.key));

    for (const operation of stopped) {
      updatePairs(operation.document.key, operation.owner, (pair) =>
        pairBusy(pair) ? { status: "failure", message } : {},
      );

      for (const c of operation.candidates) release(operation.document.key, c.id, operation.owner);
      settleAction(operation.action);
    }
  };

  const entryDeleted = (entryId) => {
    const keys = stateRef.current.documents.flatMap((document) =>
      document.entry?.id === entryId ? [document.key] : [],
    );

    // Staged work stops; calls already sent may settle. Results already shown stay visible.
    stopStaged(keys, "Deleted from the Evaluation library.");
    setState((previous) => ({
      ...previous,
      libraryVersion: previous.libraryVersion + 1,
      documents: previous.documents.map((d) => (keys.includes(d.key) ? { ...d, availability: "deleted" } : d)),
    }));
  };

  const applyEntry = (key, { document, reference }) => {
    patchDocument(key, {
      entry: document,
      name: document.name,
      loadedRevision: document.revision,
      newerRevision: undefined,
      reference: parseReferenceSet(reference),
      base: parseReferenceSet(reference),
    });
  };

  return {
    state,
    patch,
    run,
    clear,
    api,
    library,
    detail: (recordId) => cacheRef.current.peek(recordId),
    // Loads only the requested (visible) details, keeping them pinned while they are on screen.
    hydrate(recordIds) {
      const cache = cacheRef.current,
        current = generation.current;

      cache.pin(recordIds);

      for (const recordId of recordIds) {
        if (cache.peek(recordId)) continue;
        cache
          .load(recordId)
          .then(() => {
            if (current === generation.current) setDetailVersion((v) => v + 1);
          })
          .catch((error) => {
            if (current !== generation.current || error.code === "invalidated") return;

            const owner = Object.entries(stateRef.current.pairs)
              .flatMap(([docKey, byCandidate]) =>
                Object.entries(byCandidate).map(([candidateId, pair]) => [docKey, candidateId, pair]),
              )
              .find(([, , pair]) => pair.result?.recordId === recordId || pair.previous?.recordId === recordId);

            if (owner) markUnavailable(owner[0], owner[1], recordId, error);
            pauseStaging(error);
          });
      }
    },
    async retryCache() {
      const current = generation.current;

      try {
        await cacheRef.current.probe();
      } catch (error) {
        if (current === generation.current) patch({ cacheError: { message: error.message, code: error.code } });

        return false;
      }

      if (current !== generation.current) return false;
      staging.current.paused = false;
      patch({ cacheError: null });
      pump();

      return true;
    },
    edit(candidateId, update) {
      setState((previous) => ({
        ...previous,
        candidates: previous.candidates.map((candidate) =>
          candidate.id === candidateId ? { ...candidate, ...update, revision: candidate.revision + 1 } : candidate,
        ),
      }));
    },
    // Each entry is one candidate: a loaded Template, plus a model name when comparing models.
    start(mode, entries) {
      if (!state.setup?.configured) throw new Error("Configure the Workspace model first.");

      const candidates = entries
        .slice(0, MAX_CANDIDATES)
        .map(({ template, model }) =>
          makeCandidate(
            { ...validateTemplateJsonPayload(template), source: template.source },
            { ...state.setup, model: model ?? state.setup.model },
          ),
        );

      dropPairs(stateRef.current, () => false);
      patch({ mode, candidates, pairs: {}, alignments: {}, columns: {}, error: "" });

      return candidates.map((candidate) => candidate.id);
    },
    duplicate(candidateId) {
      const candidate = state.candidates.find((c) => c.id === candidateId);

      if (candidate && state.candidates.length < MAX_CANDIDATES) {
        const copy = makeCandidate(candidate.template, candidate);
        patch({ candidates: [...state.candidates, copy] });

        return copy.id;
      }
    },
    remove(candidateId) {
      if (anyBusy(null, candidateId) || state.candidates.length <= 1) return;
      dropPairs(stateRef.current, (_, cid) => cid !== candidateId);
      setState((previous) => ({
        ...previous,
        candidates: previous.candidates.filter((c) => c.id !== candidateId),
        pairs: Object.fromEntries(
          Object.entries(previous.pairs).map(([key, byCandidate]) => [
            key,
            Object.fromEntries(Object.entries(byCandidate).filter(([cid]) => cid !== candidateId)),
          ]),
        ),
      }));
    },
    setColumns(candidateId, columns) {
      setState((previous) => ({ ...previous, columns: { ...previous.columns, [candidateId]: columns } }));
    },
    // Mode changes discard candidates, results and unsaved answer edits; the selected documents stay,
    // with saved documents back at the answers they were loaded with.
    async changeMode(mode) {
      const requested = stateRef.current;

      if (anyBusy() || mode === requested.mode) return;

      if (
        requested.candidates.length &&
        !(await confirmDialog({
          title: "Change mode?",
          body: "Candidates, results and unsaved answer changes are discarded. Documents are kept.",
          confirmLabel: "Change mode",
          tone: "default",
        }))
      )
        return;
      // Re-read after the prompt so edits made before it answered are not lost.
      const current = stateRef.current;

      dropPairs(current, () => false);
      patch({
        mode,
        candidates: [],
        pairs: {},
        alignments: {},
        columns: {},
        documents: current.documents.map((d) => ({
          ...d,
          links: {},
          reference: d.kind === "saved" && d.base ? structuredClone(d.base) : emptyReferenceSet(),
        })),
      });
    },
    confirmDiscard() {
      const current = stateRef.current;

      if (!current.documents.length && !current.candidates.length) return true;
      const unsaved = current.documents.filter((d) => d.kind === "upload" || documentDirty(d)).length;

      return confirmDialog({
        title: "Discard this evaluation?",
        body: unsaved
          ? `${unsaved} ${unsaved === 1 ? "document has" : "documents have"} unsaved uploads or answer changes. This can't be undone.`
          : "Its documents, candidates and results are discarded. This can't be undone.",
        confirmLabel: "Discard",
        cancelLabel: "Keep evaluation",
        tone: "default",
      });
    },
    addUploads(files) {
      const added = files.map(uploadDocument);
      setState((previous) => ({ ...previous, documents: [...previous.documents, ...added] }));

      return added.map((d) => d.key);
    },
    async editSaved(entry, signal) {
      const current = generation.current;
      const existing = stateRef.current.documents.find((d) => d.entry?.id === entry.id);
      const loaded = existing || savedDocument(await library.read(entry.id));

      if (current !== generation.current || signal?.aborted) return false;
      setState((previous) => {
        const document = previous.documents.find((d) => d.entry?.id === entry.id) || loaded;

        const editingTemplate = document.editingTemplate || {
          name: document.name,
          description: "",
          fields: structuredClone(Object.values(document.reference.definitions)),
        };

        const edited = { ...document, editingTemplate };

        return {
          ...previous,
          libraryEditor: document.key,
          documents: previous.documents.some((d) => d.key === document.key)
            ? previous.documents.map((d) => (d.key === document.key ? edited : d))
            : [...previous.documents, edited],
        };
      });

      return true;
    },
    editLibraryTemplate(template, documentKey = stateRef.current.libraryEditor) {
      patchDocument(documentKey, { editingTemplate: structuredClone(template) });
    },
    // Bounded per-entry reads: each selected entry brings a private working copy of its answers.
    async addSaved(entries, onProgress) {
      const current = generation.current,
        failed = [];

      const pending = entries.filter((entry) => !stateRef.current.documents.some((d) => d.entry?.id === entry.id));

      let next = 0,
        done = 0;

      const worker = async () => {
        while (next < pending.length) {
          const entry = pending[next++];

          try {
            const loaded = await library.read(entry.id);

            if (current !== generation.current) return;
            setState((previous) =>
              previous.documents.some((d) => d.entry?.id === entry.id)
                ? previous
                : { ...previous, documents: [...previous.documents, savedDocument(loaded)] },
            );
          } catch (error) {
            failed.push({ entry, message: error.message });
          }

          onProgress?.(++done, pending.length);
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));

      return { failed };
    },
    removeDocument(key) {
      if (anyBusy(key)) return;
      dropPairs(stateRef.current, (docKey) => docKey !== key);
      setState((previous) => {
        const pairs = { ...previous.pairs };
        delete pairs[key];

        return { ...previous, pairs, documents: previous.documents.filter((d) => d.key !== key) };
      });
    },
    setReference(docKey, identity, value, definition) {
      updateDocument(docKey, (d) => ({
        reference: {
          references: { ...d.reference.references, [identity]: value },
          definitions: { ...d.reference.definitions, [identity]: definition },
        },
      }));
    },
    removeReference(docKey, identity) {
      updateDocument(docKey, (d) => {
        const references = { ...d.reference.references },
          definitions = { ...d.reference.definitions };

        delete references[identity];
        delete definitions[identity];

        return { reference: { references, definitions } };
      });
    },
    // Replaces a saved answer of an older field type with one reviewed for the current type.
    reviewReference(docKey, fromIdentity, identity, value, definition) {
      updateDocument(docKey, (d) => {
        const references = { ...d.reference.references },
          definitions = { ...d.reference.definitions };

        if (fromIdentity !== identity) {
          delete references[fromIdentity];
          delete definitions[fromIdentity];
        }

        return {
          reference: {
            references: { ...references, [identity]: value },
            definitions: { ...definitions, [identity]: definition },
          },
        };
      });
    },
    // Links a renamed Template field to one of this document's saved answers of the same type, or unlinks it.
    // Links are temporary comparison settings: they are never saved with the answer set.
    linkField(docKey, fieldIdentityValue, savedIdentity) {
      const document = stateRef.current.documents.find((d) => d.key === docKey);

      if (!document) return;
      const definition = savedIdentity && document.reference.definitions[savedIdentity];

      if (
        savedIdentity &&
        (!definition ||
          !document.reference.references[savedIdentity]?.verified ||
          fieldIdentityValue.slice(fieldIdentityValue.lastIndexOf(":") + 1) !== definition.data_type)
      )
        return;
      updateDocument(docKey, (d) => {
        const links = { ...d.links };

        if (savedIdentity) links[fieldIdentityValue] = savedIdentity;
        else delete links[fieldIdentityValue];

        return { links };
      });
    },
    discardChanges(docKey) {
      updateDocument(docKey, (d) => (d.base ? { reference: structuredClone(d.base) } : {}));
    },
    useSavedVersion: applyEntry,
    async loadLatest(docKey) {
      const document = stateRef.current.documents.find((d) => d.key === docKey),
        current = generation.current;

      if (!document?.entry) return;

      try {
        const loaded = await library.read(document.entry.id);

        if (current === generation.current) applyEntry(docKey, loaded);
      } catch (error) {
        if (current === generation.current && error.code === "document_not_found") entryDeleted(document.entry.id);
        throw error;
      }
    },
    // Explicit save. One operation id per save, reused on retry so a lost response can't duplicate the entry.
    async saveDocument(docKey, name, { fresh = false } = {}) {
      const document = stateRef.current.documents.find((d) => d.key === docKey),
        current = generation.current;

      if (!document || document.kind !== "upload" || document.save === "saving") return false;
      const operationId = (!fresh && document.saveOperationId) || id();
      patchDocument(docKey, { save: "saving", saveOperationId: operationId, saveError: "", saveConflict: false });

      try {
        const saved = await library.save({ file: document.file, name, reference: document.reference, operationId });

        if (current !== generation.current) return false;
        patchDocument(docKey, {
          kind: "saved",
          entry: saved.document,
          name: saved.document.name,
          loadedRevision: saved.document.revision,
          base: parseReferenceSet(saved.reference),
          save: "saved",
          saveOperationId: undefined,
          saveError: "",
        });
        setState((previous) => ({ ...previous, libraryVersion: previous.libraryVersion + 1 }));

        return true;
      } catch (error) {
        if (current !== generation.current) return false;

        if (error.code === "save_unavailable")
          setState((previous) => ({
            ...previous,
            library: { save_available: false, reason: error.body?.error?.reason ?? error.body?.reason ?? null },
          }));
        patchDocument(docKey, {
          save: "failed",
          saveConflict: !!SAVE_FAILURES[error.code],
          saveError:
            SAVE_FAILURES[error.code] ||
            (error.code === "save_unavailable"
              ? error.message
              : "Couldn’t save. Nothing was added to the library; your document and answers are still in this tab. Try again."),
        });

        return false;
      }
    },
    // Conditional update of the shared set. A stale revision returns the current saved set for review.
    async updateSaved(docKey, expectedRevision) {
      const document = stateRef.current.documents.find((d) => d.key === docKey),
        current = generation.current;

      if (!document?.entry) return { error: "This document isn’t saved in the library." };

      try {
        const updated = await library.update(document.entry.id, {
          expectedRevision: expectedRevision ?? document.loadedRevision,
          reference: document.reference,
        });

        if (current !== generation.current) return {};
        patchDocument(docKey, {
          entry: updated.document,
          loadedRevision: updated.document.revision,
          newerRevision: undefined,
          base: parseReferenceSet(updated.reference),
        });

        return { ok: true };
      } catch (error) {
        if (current !== generation.current) return {};

        if (error.code === "revision_conflict" && error.body?.current) {
          patchDocument(docKey, { newerRevision: error.body.current.document.revision });

          return { conflict: error.body.current };
        }

        if (error.code === "document_not_found") entryDeleted(document.entry.id);

        return { error: error.message };
      }
    },
    // A rename never touches answers, so a working copy loaded at the renamed revision stays current.
    entryChanged(document, expectedRevision) {
      setState((previous) => ({
        ...previous,
        libraryVersion: previous.libraryVersion + 1,
        documents: previous.documents.map((current) => {
          if (current.entry?.id !== document.id) return current;
          const next = { ...current, entry: document, name: document.name };

          if (current.loadedRevision === expectedRevision) next.loadedRevision = document.revision;

          return next;
        }),
      }));
    },
    entryDeleted,
    // Live library changes are only a freshness hint; a working copy is never replaced automatically.
    documentChanged(event) {
      if (!event?.document_id) return;

      if (event.deleted) {
        if (stateRef.current.documents.some((d) => d.entry?.id === event.document_id)) entryDeleted(event.document_id);
        else patch({ libraryVersion: stateRef.current.libraryVersion + 1 });

        return;
      }

      setState((previous) => ({
        ...previous,
        libraryVersion: previous.libraryVersion + 1,
        documents: previous.documents.map((d) =>
          d.entry?.id === event.document_id && Number(event.revision) > (d.loadedRevision ?? 0)
            ? { ...d, newerRevision: Number(event.revision) }
            : d,
        ),
      }));
    },
    async retrySource(docKey) {
      const document = stateRef.current.documents.find((d) => d.key === docKey),
        current = generation.current;

      if (!document?.entry) return;

      try {
        await library.checkSource(document.entry.id);

        if (current === generation.current) patchDocument(docKey, { availability: "ok" });
      } catch (error) {
        if (current === generation.current && SOURCE_FAILURES[error.code])
          patchDocument(docKey, { availability: SOURCE_FAILURES[error.code][0] });
        throw error;
      }
    },
  };
}
