import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SEARCH_LIMITS, validateCommandInterpretation } from "../../../../shared/documentSearch.ts";
import { describeError } from "../../lib/describeError";
import { pluralize } from "../../lib/text";
import { SearchIcon } from "../layout/Icons.jsx";
import { ModalDialog } from "../layout/ModalDialog.jsx";
import { Button } from "../ui/Button.jsx";
import { Callout } from "../ui/Callout.jsx";
import { Skeleton } from "../ui/States.jsx";
import { askLooksLikeQuestion, describeFilter, interpretLocally, lexCommand, mergeInterpretations } from "./commandParser.js";
import { FLOW_REGISTRY } from "./flows/index.js";
import { PalettePills, PillLegend } from "./PalettePills.jsx";
import { DocumentResults, InterpretationNotes, OptionList, TemplateResults } from "./PaletteResults.jsx";
import {
  appPageFor,
  documentItem,
  fetchDocumentMatches,
  interpretRequest,
  localMatches,
  RESULT_PAGE_SIZE,
  searchDocuments,
  searchTargets,
  templateItem,
} from "./paletteSearch.js";
import {
  applyAlternative,
  documentsListFilters,
  documentsSignature,
  EMPTY_CATALOG,
  NO_MODEL_MESSAGE,
  optionId,
  paletteShortcutLabel,
  pillLabels,
  templatesSignature,
} from "./paletteState.js";
import "./CommandPalette.css";

const DOCUMENT_MATCH_DELAY_MS = 200;

const REFRESH_DELAY_MS = 400;

const IDLE_RESULTS = Object.freeze({
  status: "idle",
  jobs: [],
  total: 0,
  totalCapped: false,
  nextCursor: null,
  hasMore: false,
  targets: null,
  error: null,
  loadingMore: false,
  loadMoreError: null,
  key: "",
});

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);

    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Runs `POST /v1/jobs/search` for the current filter, with the IDs of every match for the bulk
 * actions. A new `refreshKey` runs the same search again and keeps the rows until it answers.
 */
function useDocumentSearch(request, queryKey, refreshKey) {
  const [state, setState] = useState(IDLE_RESULTS);
  const [attempt, setAttempt] = useState(0);
  const shownKey = useRef("");
  // Each search or refresh is a new generation; a page loaded for an older one is dropped.
  const generation = useRef(0);
  const moreAbort = useRef(null);

  useEffect(() => {
    generation.current += 1;
    moreAbort.current?.abort();

    if (!queryKey) {
      shownKey.current = "";
      setState(IDLE_RESULTS);

      return undefined;
    }

    const { filter, limit } = JSON.parse(queryKey);
    const controller = new AbortController();
    const signal = controller.signal;

    if (shownKey.current !== queryKey) setState({ ...IDLE_RESULTS, status: "loading" });

    Promise.all([
      searchDocuments(request, { filter, limit: limit || RESULT_PAGE_SIZE, signal }),
      // The bulk actions are offered only once the IDs are known; a failure here leaves them off.
      searchTargets(request, filter, { limit: Math.min(limit || SEARCH_LIMITS.idsPageSize, SEARCH_LIMITS.idsPageSize), signal }).catch(
        () => null,
      ),
    ])
      .then(([page, targets]) => {
        if (signal.aborted) return;
        shownKey.current = queryKey;
        setState({ ...IDLE_RESULTS, ...page, status: "ready", targets, key: queryKey });
      })
      .catch((error) => {
        if (signal.aborted) return;
        shownKey.current = "";
        setState({ ...IDLE_RESULTS, status: "error", error });
      });

    return () => {
      controller.abort();
      moreAbort.current?.abort();
    };
  }, [request, queryKey, refreshKey, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const loadMore = useCallback(async () => {
    if (!queryKey || state.key !== queryKey || !state.nextCursor || state.loadingMore) return;
    const { filter } = JSON.parse(queryKey);
    const requested = generation.current;
    const controller = new AbortController();
    moreAbort.current = controller;
    setState((current) => ({ ...current, loadingMore: true, loadMoreError: null }));

    try {
      const page = await searchDocuments(request, { filter, cursor: state.nextCursor, signal: controller.signal });

      if (controller.signal.aborted || requested !== generation.current) return;

      setState((current) => {
        if (current.key !== queryKey) return current;
        const seen = new Set(current.jobs.map((job) => job.job_id));

        return {
          ...current,
          jobs: current.jobs.concat(page.jobs.filter((job) => !seen.has(job.job_id))),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loadingMore: false,
        };
      });
    } catch (error) {
      if (controller.signal.aborted || requested !== generation.current) return;
      setState((current) => ({ ...current, loadingMore: false, loadMoreError: error }));
    }
  }, [request, queryKey, state.key, state.nextCursor, state.loadingMore]);

  return { ...state, retry, loadMore };
}

function findWorkspace(workspaces, name) {
  const wanted = String(name || "").trim().toLowerCase();

  if (!wanted) return null;
  const exact = workspaces.find((workspace) => workspace.name.toLowerCase() === wanted);

  if (exact) return exact;
  const partial = workspaces.filter((workspace) => workspace.name.toLowerCase().includes(wanted));

  return partial.length === 1 ? partial[0] : null;
}

// Templates named by the request, through the filter or the action's own Template.
function matchingTemplates(templates, interpretation) {
  const filter = interpretation?.filter;
  const text = String(filter?.text || "").toLowerCase();

  const named = [...(filter?.template_ids ?? []), ...(interpretation?.args?.template_id ? [interpretation.args.template_id] : [])];

  return templates.filter(
    (template) =>
      (!named.length || named.includes(template.id)) &&
      (!text || String(template.name || "").toLowerCase().includes(text)),
  );
}

// The parser's reading wins for what it recognised; a merge the catalogue rejects falls back to the model's.
function mergedInterpretation(local, answered, segments, catalog) {
  try {
    return validateCommandInterpretation(mergeInterpretations(local, answered, segments), catalog);
  } catch {
    return answered;
  }
}

/**
 * The command palette: a centred spotlight over the dimmed page. Typing shows instant local
 * matches; Enter turns the sentence into pills, interprets it (locally when it can, otherwise with
 * one model call) and shows results or continues the chosen action inside the palette.
 */
export function CommandPalette({ context, onClose, flows = FLOW_REGISTRY }) {
  const catalog = context.catalog || EMPTY_CATALOG;
  // Until the catalogue arrives, Ask is offered; it explains itself once the catalogue says no model.
  const interpretationAvailable = context.catalog ? catalog.interpretation?.available === true : true;

  // The Templates list has no fields, so field counts come from the catalogue.
  const templates = useMemo(() => {
    const fields = new Map(catalog.templates.map((template) => [template.id, template.fields]));

    return (context.templateController?.templates || catalog.templates).map((template) =>
      Array.isArray(template.fields) || !fields.has(template.id) ? template : { ...template, fields: fields.get(template.id) },
    );
  }, [context.templateController?.templates, catalog.templates]);

  const workspaces = useMemo(() => context.workspaces || [], [context.workspaces]);
  const shortcut = paletteShortcutLabel();
  const listboxId = useId();
  const hintId = useId();

  const [text, setText] = useState("");
  const [mode, setMode] = useState("edit");
  const [ask, setAsk] = useState(null);
  const [flow, setFlow] = useState(null);
  const [highlight, setHighlight] = useState(0);
  const [documentMatches, setDocumentMatches] = useState({ query: "", jobs: [] });

  const inputRef = useRef(null);
  const pillsRef = useRef(null);
  const flowRef = useRef(null);
  const backRef = useRef(null);
  const runRef = useRef(0);
  const interpretAbort = useRef(null);
  const mounted = useRef(true);
  const flowToken = useRef(0);
  // True while a flow's action (a delete, export or retry) is running: the palette stays open.
  const [flowBusy, setFlowBusy] = useState(false);

  const trimmed = text.trim();

  // What the local parser makes of the text so far: whether Ask goes first, and whether it could
  // run without the model.
  const preview = useMemo(() => {
    if (!trimmed) return null;
    const segments = lexCommand(trimmed, catalog, { workspaces });

    return {
      askFirst: askLooksLikeQuestion(trimmed, segments),
      complete: interpretLocally(segments, catalog, { today: context.today, workspaces }).complete,
    };
  }, [trimmed, catalog, context.today, workspaces]);

  // Documents whose name matches, debounced; the other groups don't wait for it.
  useEffect(() => {
    if (mode !== "edit" || flow || trimmed.length < 2) return undefined;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      fetchDocumentMatches(context.request, trimmed, controller.signal)
        .then((jobs) => {
          if (!controller.signal.aborted) setDocumentMatches({ query: trimmed, jobs });
        })
        .catch(() => {
          // Name matches are a convenience; the rest of the list still works without them.
        });
    }, DOCUMENT_MATCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [context.request, mode, flow, trimmed]);

  const documentController = context.documentController;

  const editItems = useMemo(() => {
    const items = localMatches(text, {
      role: context.role,
      templates,
      workspaces,
      workspaceId: context.workspaceId,
      recentDocuments: documentController?.contextList?.documents || [],
      documentMatches: documentMatches.query === trimmed ? documentMatches.jobs : [],
      failedCount: documentController?.statusCounts?.failed || 0,
      interpretationAvailable,
      localComplete: Boolean(preview?.complete),
      askFirst: Boolean(preview?.askFirst),
    });

    return items.map((item) => (item.kind === "ask" ? { ...item, shortcut: shortcut.ask } : item));
  }, [
    text,
    trimmed,
    context.role,
    context.workspaceId,
    templates,
    workspaces,
    documentController,
    documentMatches,
    interpretationAvailable,
    preview,
    shortcut.ask,
  ]);

  // Results refresh when documents or templates change while they're shown.
  const templatesKey = templatesSignature(templates);
  const refreshKey = useDebounced(`${documentsSignature(documentController)}#${templatesKey}`, REFRESH_DELAY_MS);
  const refreshCatalog = context.refreshCatalog;
  const firstTemplatesKey = useRef(templatesKey);

  useEffect(() => {
    if (templatesKey !== firstTemplatesKey.current) refreshCatalog?.();
  }, [templatesKey, refreshCatalog]);

  const interpretation = ask?.interpretation || null;
  const action = ask && !ask.pending ? interpretation?.action : null;

  const searchKey =
    action === "find_documents"
      ? JSON.stringify({ filter: interpretation.filter || {}, limit: interpretation.args?.limit || 0 })
      : "";

  const results = useDocumentSearch(context.request, searchKey, refreshKey);

  const templateNames = useMemo(() => new Map(catalog.templates.map((template) => [template.id, template.name])), [catalog.templates]);

  const summary = interpretation?.filter ? describeFilter(interpretation.filter, catalog, { today: context.today }) : "";

  const resultItems = useMemo(() => {
    if (mode !== "pills" || !ask || ask.pending) return [];

    if (action === "find_documents")
      return results.jobs.map((job) => documentItem(job, { templateNames, group: "" }));

    if (action === "find_templates")
      return matchingTemplates(templates, interpretation).map((template) => templateItem(template, ""));

    if (action && flows[action])
      return [
        {
          id: "start",
          group: "",
          kind: "start",
          label: flows[action].title,
          sub: summary || "Continue in the palette",
        },
      ];

    return [];
  }, [mode, ask, action, results.jobs, templateNames, templates, interpretation, flows, summary]);

  const items = flow ? [] : mode === "pills" ? resultItems : editItems;
  const active = items.length ? Math.min(highlight, items.length - 1) : -1;
  const activeItem = active >= 0 ? items[active] : null;

  // Quantity pills report how many documents were found.
  const labels = useMemo(() => {
    if (!ask) return [];

    return ask.segments.map((segment, index) =>
      segment.type === "quantity" && action === "find_documents" && results.status === "ready"
        ? `${results.total}${results.totalCapped ? "+" : ""} found`
        : ask.labels[index] ?? null,
    );
  }, [ask, action, results.status, results.total, results.totalCapped]);

  useEffect(() => {
    if (activeItem) document.getElementById(optionId(listboxId, activeItem))?.scrollIntoView?.({ block: "nearest" });
  }, [activeItem, listboxId]);

  // Focus follows the step: the text box, the pills, or the open flow.
  useEffect(() => {
    if (flow) {
      if (!flowRef.current?.contains(document.activeElement)) {
        const target = flowRef.current?.querySelector(
          "input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)",
        );

        (target || flowRef.current)?.focus();
      }

      return;
    }

    if (mode === "pills") pillsRef.current?.focus();
    else inputRef.current?.focus();
  }, [mode, flow]);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      interpretAbort.current?.abort();
    };
  }, []);

  // A flow that changes step can unmount the focused control; focus then returns to the flow so
  // Esc and Tab keep working inside the palette.
  useEffect(() => {
    const node = flowRef.current;

    if (!flow || !node) return undefined;

    const observer = new MutationObserver(() => {
      const focused = document.activeElement;

      if (!focused || focused === document.body || !focused.isConnected) node.focus();
    });

    observer.observe(node, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [flow]);

  const close = (effect) => {
    onClose();
    effect?.();
  };

  const navigateTo = (target) => context.navigate(context.appPath({ workspaceId: context.workspaceId, ...target }));

  const goTo = (page) => {
    const appPage = appPageFor(page);

    if (appPage) close(() => navigateTo({ page: appPage }));
  };

  const switchTo = (workspace) =>
    close(() => {
      if (workspace.id !== context.workspaceId) context.navigate(context.appPath({ workspaceId: workspace.id }));
    });

  const openInDocuments = (filter) =>
    close(() => {
      const listFilters = documentsListFilters(filter);

      if (listFilters) documentController?.contextList?.onFiltersChange?.(listFilters);

      navigateTo({ page: "documents" });
    });

  const openFlow = (flowAction, flowInterpretation, targets, from) => {
    const entry = flows[flowAction];

    if (!entry?.Component) return;
    backRef.current = null;
    flowToken.current += 1;
    setFlowBusy(false);
    setFlow({ action: flowAction, title: entry.title, interpretation: flowInterpretation, targets, from });
  };

  // Acts on an interpretation: searches show results, pages and workspaces open straight away,
  // and other actions continue in their flow. An incomplete reading waits for the user to choose.
  const proceed = (next, complete) => {
    if (next.action === "find_documents" || next.action === "find_templates") return;

    if (!complete) return;

    if (next.action === "go_to") {
      if (next.args.page) goTo(next.args.page);

      return;
    }

    if (next.action === "switch_workspace") {
      const workspace = findWorkspace(workspaces, next.args.workspace);

      if (workspace) switchTo(workspace);
      else openFlow("switch_workspace", next, null, "pills");

      return;
    }

    openFlow(next.action, next, null, "pills");
  };

  const toEdit = (nextText) => {
    runRef.current += 1;
    interpretAbort.current?.abort();
    backRef.current = null;
    setAsk(null);
    flowToken.current += 1;
    setFlow(null);
    setMode("edit");
    setHighlight(0);
    setText(nextText);
  };

  async function submit(raw) {
    const value = raw.trim();

    if (!value) return;
    interpretAbort.current?.abort();
    const run = ++runRef.current;
    let activeCatalog = catalog;

    // Pills need the catalogue; on a fast Enter right after opening, wait for it to arrive.
    if (context.catalogStatus === "loading" && context.refreshCatalog) {
      activeCatalog = (await context.refreshCatalog()) || catalog;

      if (run !== runRef.current) return;
    }

    const segments = lexCommand(value, activeCatalog, { workspaces });
    const local = interpretLocally(segments, activeCatalog, { today: context.today, workspaces });
    const base = { text: value, segments, localResolved: local.resolved, error: null, noModel: false };

    backRef.current = null;
    setText(value);
    flowToken.current += 1;
    setFlow(null);
    setMode("pills");
    setHighlight(0);

    if (local.complete || activeCatalog.interpretation?.available !== true) {
      setAsk({
        ...base,
        interpretation: local.interpretation,
        labels: local.resolved,
        unused: local.unused,
        pending: false,
        noModel: !local.complete && activeCatalog !== EMPTY_CATALOG,
      });
      proceed(local.interpretation, local.complete);

      return;
    }

    setAsk({ ...base, interpretation: null, labels: [], unused: [], pending: true });
    const controller = new AbortController();
    interpretAbort.current = controller;

    try {
      const answer = await interpretRequest(context.request, {
        text: value,
        segments,
        today: context.today,
        signal: controller.signal,
      });

      const answered = validateCommandInterpretation(answer, activeCatalog);
      const checked = mergedInterpretation(local.interpretation, answered, segments, activeCatalog);

      if (run !== runRef.current) return;

      setAsk({
        ...base,
        interpretation: checked,
        labels: pillLabels(segments, local.resolved, checked, activeCatalog),
        unused: checked.unrecognised,
        pending: false,
      });
      proceed(checked, true);
    } catch (error) {
      if (run !== runRef.current || controller.signal.aborted) return;

      setAsk({
        ...base,
        interpretation: local.interpretation,
        labels: local.resolved,
        unused: local.unused,
        pending: false,
        error,
      });
      proceed(local.interpretation, false);
    }
  }

  function activate(item) {
    if (!item || item.disabled) return;

    if (item.kind === "ask") void submit(text);
    else if (item.kind === "example") void submit(item.label);
    else if (item.kind === "action") {
      if (item.action === "find_documents") {
        setText("Find ");
        setHighlight(0);
        inputRef.current?.focus();
      } else openFlow(item.action, null, null, "edit");
    } else if (item.kind === "document") close(() => navigateTo({ page: "documents", documentId: item.job.job_id }));
    else if (item.kind === "template") close(() => navigateTo({ page: "templates", templateId: item.template.id }));
    else if (item.kind === "page") goTo(item.page);
    else if (item.kind === "workspace") switchTo(item.workspace);
    else if (item.kind === "start" && interpretation) proceed(interpretation, true);
  }

  const leaveFlow = () => {
    if (flowBusy) return;
    backRef.current = null;
    flowToken.current += 1;
    setFlow(null);
  };

  // A flow finishes once its toast is shown. A finish from a flow that is no longer open (or from
  // a palette that has closed) is ignored, so it can't close a palette opened since.
  const finishFlow = (token) => () => {
    if (!mounted.current || token !== flowToken.current) return;
    onClose();
  };

  const onBusyChange = useCallback((busy) => {
    if (mounted.current) setFlowBusy(Boolean(busy));
  }, []);

  // Esc steps back once: flow, then pills, then text, then close.
  const stepBack = () => {
    if (flowBusy) return;

    if (flow) {
      if (backRef.current?.()) return;
      leaveFlow();

      return;
    }

    if (mode === "pills") toEdit(text);
    else if (text) setText("");
    else onClose();
  };

  const registerBack = useCallback((handler) => {
    backRef.current = handler;
  }, []);

  const moveHighlight = (event) => {
    const last = items.length - 1;

    const moves = {
      ArrowDown: active >= last ? 0 : active + 1,
      ArrowUp: active <= 0 ? last : active - 1,
      Home: 0,
      End: last,
    };

    if (!(event.key in moves) || last < 0) return false;
    event.preventDefault();
    setHighlight(moves[event.key]);

    return true;
  };

  const onInputKeyDown = (event) => {
    if (moveHighlight(event)) return;

    if (event.key !== "Enter" || event.nativeEvent?.isComposing) return;
    event.preventDefault();

    if (event.metaKey || event.ctrlKey) void submit(text);
    else if (activeItem) activate(activeItem);
    else if (trimmed) void submit(text);
  };

  const onPillsKeyDown = (event) => {
    if (ask?.pending && event.key === "Enter") return;

    if (moveHighlight(event)) return;

    if (event.key === "Enter") {
      event.preventDefault();

      if (event.metaKey || event.ctrlKey) void submit(text);
      else activate(activeItem);

      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      toEdit(text);

      return;
    }

    // Typing again turns the pills back into editable text.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      toEdit(`${text}${event.key}`);
    }
  };

  // Captured on the dialog card, before ModalDialog's own Escape (which closes everything) and
  // wherever focus is inside the card.
  const onPaletteKeyDown = (event) => {
    if (event.key !== "Escape" || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    stepBack();
  };

  const chooseAlternative = (alternative) =>
    setAsk((current) => {
      const next = current && applyAlternative(current.interpretation, alternative, catalog);

      if (!next) return current;

      return { ...current, interpretation: next, labels: pillLabels(current.segments, current.localResolved, next, catalog) };
    });

  const onBulk = (kind) => {
    if (!interpretation) return;

    if (kind === "open") openInDocuments(interpretation.filter);
    else openFlow(kind, { ...interpretation, action: kind }, results.targets, "pills");
  };

  const FlowComponent = flow ? flows[flow.action]?.Component : null;
  const listboxShown = !flow && (mode === "edit" || (ask && !ask.pending));
  const activeDescendant = listboxShown && activeItem ? optionId(listboxId, activeItem) : undefined;

  const statusMessage = ask?.pending
    ? "Understanding your request…"
    : action === "find_documents" && results.status === "ready"
      ? pluralize(results.total, "document")
      : "";

  const optionProps = {
    items,
    listboxId,
    highlightIndex: active,
    onActivate: activate,
    onHighlight: setHighlight,
  };

  return (
    <ModalDialog
      label="Search and actions"
      className="command-palette"
      initialFocus=".command-palette-input"
      data-command-palette=""
      data-command-palette-busy={flowBusy ? "true" : undefined}
      closeDisabled={flowBusy}
      onKeyDownCapture={onPaletteKeyDown}
      onClose={onClose}
    >
      <div className="command-palette-frame">
        <div className="command-palette-bar">
          <span className="command-palette-bar-icon" aria-hidden="true">
            <SearchIcon />
          </span>
          {mode === "pills" && ask ? (
            <div
              ref={pillsRef}
              className="command-palette-pills"
              role="combobox"
              tabIndex={flow ? -1 : 0}
              aria-label="Your request"
              aria-describedby={hintId}
              aria-expanded={Boolean(listboxShown && items.length)}
              aria-controls={listboxId}
              aria-activedescendant={activeDescendant}
              aria-busy={ask.pending || undefined}
              title="Type to edit"
              onKeyDown={flow ? undefined : onPillsKeyDown}
              onClick={flow ? undefined : () => toEdit(text)}
            >
              <PalettePills segments={ask.segments} labels={labels} unused={ask.unused} pending={ask.pending} />
              <span id={hintId} className="sr-only">
                Type to edit.
              </span>
            </div>
          ) : (
            <>
              {flow ? <span className="palette-pill palette-pill-action command-palette-crumb">{flow.title}</span> : null}
              <input
                ref={inputRef}
                className="command-palette-input"
                role="combobox"
                aria-label="Search or ask"
                aria-autocomplete="list"
                aria-expanded={Boolean(listboxShown && items.length)}
                aria-controls={listboxId}
                aria-activedescendant={activeDescendant}
                autoComplete="off"
                spellCheck={false}
                maxLength={SEARCH_LIMITS.interpretationTextCharacters}
                placeholder="Search, ask or run an action…"
                value={text}
                readOnly={Boolean(flow)}
                tabIndex={flow ? -1 : 0}
                onChange={(event) => {
                  setText(event.target.value);
                  setHighlight(0);
                }}
                onKeyDown={flow ? undefined : onInputKeyDown}
              />
            </>
          )}
          <kbd className="command-palette-esc" aria-hidden="true">
            Esc
          </kbd>
        </div>

        <div className="command-palette-body">
          {context.catalogStatus === "error" && !flow ? (
            <Callout
              tone="warning"
              className="command-palette-callout"
              action={
                <Button variant="text" size="sm" onClick={() => refreshCatalog?.()}>
                  Try again
                </Button>
              }
            >
              Couldn&apos;t load your templates and fields. Search by name still works.
            </Callout>
          ) : null}

          {ask?.error && !flow ? (
            <Callout tone="warning" className="command-palette-callout" title="Couldn't interpret the whole request">
              {describeError(ask.error, "Showing what could be read without the model.")}
            </Callout>
          ) : null}

          {ask?.noModel && !flow ? (
            <Callout tone="info" className="command-palette-callout">
              Some words weren&apos;t used. {NO_MODEL_MESSAGE}.
            </Callout>
          ) : null}

          {flow && FlowComponent ? (
            <div ref={flowRef} className="command-palette-flow" tabIndex={-1} aria-label={flow.title} role="region">
              <FlowComponent
                interpretation={flow.interpretation}
                targets={flow.targets}
                context={context}
                onFinish={finishFlow(flowToken.current)}
                onBack={leaveFlow}
                registerBack={registerBack}
                onBusyChange={onBusyChange}
              />
            </div>
          ) : null}

          {!flow && mode === "pills" && ask?.pending ? (
            <div className="command-palette-thinking">
              <span>Understanding your request…</span>
              <Skeleton rows={2} height={10} label="Understanding your request…" />
            </div>
          ) : null}

          {listboxShown && mode === "edit" ? <OptionList {...optionProps} /> : null}

          {listboxShown && mode === "pills" ? (
            <>
              <InterpretationNotes interpretation={interpretation} catalog={catalog} onUseAlternative={chooseAlternative} />
              {action === "find_documents" ? (
                <DocumentResults
                  {...optionProps}
                  results={results}
                  summary={summary}
                  limit={interpretation.args?.limit || 0}
                  filter={interpretation.filter}
                  onBulk={onBulk}
                />
              ) : action === "find_templates" ? (
                <TemplateResults {...optionProps} />
              ) : (
                <OptionList {...optionProps} />
              )}
            </>
          ) : null}
        </div>

        <div className="command-palette-foot">
          {mode === "pills" && ask && !ask.pending && !flow ? (
            <PillLegend segments={ask.segments} />
          ) : (
            <span className="command-palette-keys">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> to move
              </span>
              <span>
                <kbd>↵</kbd> to open
              </span>
              <span>
                {shortcut.ask.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}{" "}
                to ask
              </span>
            </span>
          )}
          <span className="command-palette-foot-end">
            {flow ? (
              <span>
                <kbd>Esc</kbd> back
              </span>
            ) : mode === "pills" ? (
              <span>Type to edit</span>
            ) : (
              <span>
                <kbd>{shortcut.text}</kbd> anywhere
              </span>
            )}
          </span>
        </div>
        <div className="sr-only" role="status">
          {statusMessage}
        </div>
      </div>
    </ModalDialog>
  );
}
