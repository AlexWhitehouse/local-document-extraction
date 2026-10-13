import { useCallback, useEffect, useRef, useState } from "react";
import { checkCondition, findCatalogField, normalizeSearchText } from "../../../../shared/documentSearch.ts";
import { isJsonArray, isJsonObject, isString } from "../../../../shared/json.ts";
import { isCostPhrase, PROCESSING_COST_LABEL } from "./commandParser.js";

// Pure helpers and small hooks shared by the command palette shell, its results and its bulk flows.

export const PILL_TYPE_LABELS = {
  action: "Action",
  quantity: "Quantity",
  subject: "Subject",
  template: "Template",
  field: "Field",
  condition: "Condition",
  value: "Value",
  date: "Date",
  status: "Status",
  person: "Person",
  role: "Role",
  format: "Format",
  page: "Page",
  workspace: "Workspace",
  instruction: "Instruction",
};

// Several pill types share a colour family (see the --pill-* tokens in styles.css).
const PILL_FAMILIES = {
  template: "subject",
  page: "subject",
  workspace: "subject",
  value: "condition",
  person: "quantity",
  role: "quantity",
  format: "quantity",
};

export function pillFamily(type) {
  return PILL_FAMILIES[type] || type;
}

export const NO_MODEL_MESSAGE = "Set up a model in workspace settings to ask in plain language";

export const EMPTY_CATALOG = Object.freeze({
  templates: [],
  models: [],
  interpretation: { available: false, reason: "model_unavailable" },
  capabilities: { cost: false },
});

function isApplePlatform() {
  const platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || "";

  return /mac|iphone|ipad/i.test(platform);
}

// The platform's command key as shown in shortcut lists: "⌘" or "Ctrl".
export function commandKeyLabel() {
  return isApplePlatform() ? "⌘" : "Ctrl";
}

// The shortcut as shown ("⌘K" or "Ctrl K") and in aria-keyshortcuts form.
export function paletteShortcutLabel() {
  return isApplePlatform()
    ? { text: "⌘K", keys: ["⌘", "K"], aria: "Meta+K", ask: ["⌘", "↵"] }
    : { text: "Ctrl K", keys: ["Ctrl", "K"], aria: "Control+K", ask: ["Ctrl", "↵"] };
}

export function isPaletteShortcut(event) {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    String(event.key || "").toLowerCase() === "k"
  );
}

// ⌘K / Ctrl+K toggles the palette from anywhere, including fields. It is ignored while another
// dialog is open, so it never stacks over a pending decision.
export function usePaletteShortcut({ enabled, onToggle }) {
  const latest = useRef(onToggle);
  latest.current = onToggle;

  useEffect(() => {
    if (!enabled) return undefined;

    function toggleOnShortcut(event) {
      if (!isPaletteShortcut(event)) return;

      // Another dialog (a modal, a confirmation or the onboarding tour, which makes the page inert)
      // keeps the shortcut off, and so does a palette action that is still running.
      const otherDialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')].some(
        (dialog) => !dialog.closest("[data-command-palette]"),
      );

      if (otherDialog || document.querySelector('[data-command-palette-busy="true"]')) return;

      event.preventDefault();
      latest.current();
    }

    window.addEventListener("keydown", toggleOnShortcut, true);

    return () => window.removeEventListener("keydown", toggleOnShortcut, true);
  }, [enabled]);
}

// Today as a UTC day (YYYY-MM-DD). Upload dates are compared as UTC days, like the Documents filters.
export function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Changes whenever a document is added, removed or changes status, so open results can refresh.
export function documentsSignature(documentController) {
  const counts = documentController?.statusCounts || {};
  const total = documentController?.toolbar?.documentCount ?? "";
  const rows = documentController?.contextList?.documents || [];

  return [
    total,
    ...Object.keys(counts)
      .sort()
      .map((status) => `${status}:${counts[status]}`),
    ...rows.map((row) => `${row.job_id}:${row.status}:${row.updated_at || ""}`),
  ].join("|");
}

export function templatesSignature(templates) {
  return (templates || [])
    .map((template) => `${template.id}:${template.current_version ?? ""}:${template.name ?? ""}`)
    .join("|");
}

const fieldKey = (name) => normalizeSearchText(String(name || "").replace(/^the\s+/i, ""));

/**
 * What each pill matched, once an interpretation is known. The local parser's labels are kept,
 * and field pills name the Template the interpretation chose for them.
 */
export function pillLabels(segments, localResolved, interpretation, catalog) {
  const conditions = interpretation?.filter?.conditions || [];

  return segments.map((segment, index) => {
    if (segment.type === "field") {
      const key = fieldKey(segment.text);

      // "cost over $0.03" is the processing cost unless a condition uses a field of that name.
      if (interpretation?.filter?.cost && isCostPhrase(segment.text)) {
        const named = conditions.some(
          (candidate) => fieldKey(findCatalogField(catalog, candidate.template_id, candidate.field_id)?.field.name) === key,
        );

        if (!named) return PROCESSING_COST_LABEL;
      }

      const condition = conditions.find((candidate) => {
        const match = findCatalogField(catalog, candidate.template_id, candidate.field_id);

        return match && (fieldKey(match.field.name) === key || key.includes(fieldKey(match.field.name)));
      });

      const match = condition && findCatalogField(catalog, condition.template_id, condition.field_id);

      if (match) return match.template.name;
    }

    return localResolved?.[index] ?? null;
  });
}

/**
 * Swaps an ambiguous field for one of its alternatives: the condition that uses the same field
 * name on another Template moves to the alternative's Template and field. Returns null when the
 * alternative can't take the condition (for example a number condition on a text field).
 */
export function applyAlternative(interpretation, alternative, catalog) {
  const filter = interpretation?.filter;
  const target = findCatalogField(catalog, alternative.template_id, alternative.field_id);

  if (!filter?.conditions || !target) return null;
  const name = fieldKey(target.field.name);

  const index = filter.conditions.findIndex((condition) => {
    const match = findCatalogField(catalog, condition.template_id, condition.field_id);

    return match && condition.template_id !== alternative.template_id && fieldKey(match.field.name) === name;
  });

  if (index < 0) return null;
  const previous = filter.conditions[index];
  let swapped;

  try {
    swapped = checkCondition(
      { ...previous, template_id: alternative.template_id, field_id: alternative.field_id },
      target.field.type,
    );
  } catch {
    return null;
  }

  const nextFilter = {
    ...filter,
    conditions: filter.conditions.map((condition, position) => (position === index ? swapped : condition)),
  };

  if (filter.template_ids) {
    nextFilter.template_ids = [
      ...new Set(filter.template_ids.map((id) => (id === previous.template_id ? alternative.template_id : id))),
    ];
  }

  const notes = interpretation.notes.map((note) => {
    if (note.kind !== "ambiguous_field" || !note.alternatives.includes(alternative)) return note;

    const alternatives = [
      { template_id: previous.template_id, field_id: previous.field_id },
      ...note.alternatives.filter((candidate) => candidate !== alternative),
    ];

    const templateNames = [target.template.name, ...alternatives.map((candidate) => templateName(catalog, candidate.template_id))];

    return {
      kind: "ambiguous_field",
      text: `“${target.field.name}” is on ${listNames(templateNames)}. Using ${target.template.name}.`,
      alternatives,
    };
  });

  return { ...interpretation, filter: nextFilter, notes };
}

export function templateName(catalog, templateId) {
  return catalog.templates.find((template) => template.id === templateId)?.name || "";
}

function listNames(names) {
  const unique = [...new Set(names.filter(Boolean))];

  if (unique.length <= 1) return unique.join("");

  return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/** Whether an alternative can take the ambiguous condition, so its button is only offered when it works. */
export function canUseAlternative(interpretation, alternative, catalog) {
  return applyAlternative(interpretation, alternative, catalog) !== null;
}

/**
 * Splits a matched value into plain and highlighted parts. Text conditions highlight the part
 * they matched; plain-word searches highlight the words. Everything else is shown unmarked.
 */
export function highlightParts(display, { condition, text } = {}) {
  const value = String(display ?? "");
  const lower = value.toLowerCase();
  let start = -1;
  let length = 0;
  const needle = String(condition?.value ?? text ?? "").toLowerCase();

  if (needle && (!condition || ["contains", "starts_with", "ends_with", "is"].includes(condition.op))) {
    if (condition?.op === "starts_with") start = lower.startsWith(needle) ? 0 : -1;
    else if (condition?.op === "ends_with") start = lower.endsWith(needle) ? value.length - needle.length : -1;
    else if (condition?.op === "is") start = lower.trim() === needle.trim() ? 0 : -1;
    else start = lower.indexOf(needle);

    length = condition?.op === "is" ? value.length : needle.length;
  }

  if (start < 0 || !length) return [{ text: value, match: false }];

  return [
    { text: value.slice(0, start), match: false },
    { text: value.slice(start, start + length), match: true },
    { text: value.slice(start + length), match: false },
  ].filter((part) => part.text);
}

/**
 * Loads data for a palette step. `key` names the request; a new key loads again and drops any
 * response to the previous one. Returns { status: "loading"|"ready"|"error", data, error, retry }.
 */
export function useLoad(load, key) {
  const latest = useRef(load);
  latest.current = load;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ status: "loading", data: null, error: null, key: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading", error: null }));

    latest
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data, error: null, key });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ status: "error", data: null, error, key });
      });

    return () => controller.abort();
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { ...state, retry };
}

export function optionId(listboxId, item) {
  return `${listboxId}-${item.id.replace(/[^\w-]/g, "_")}`;
}

export function formatUploadDay(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";
  const options = { day: "numeric", month: "short" };

  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";

  return date.toLocaleDateString("en-GB", options);
}

/** Reads `GET /v1/search/catalog` at the boundary: unknown or malformed entries are dropped. */
export function parseSearchCatalog(value) {
  if (!isJsonObject(value)) return EMPTY_CATALOG;

  const templates = isJsonArray(value.templates)
    ? value.templates.flatMap((template) =>
        isJsonObject(template) && isString(template.id) && isString(template.name)
          ? [
              {
                id: template.id,
                name: template.name,
                current_version: Number.isSafeInteger(template.current_version) ? template.current_version : 1,
                fields: isJsonArray(template.fields)
                  ? template.fields.flatMap((field) =>
                      isJsonObject(field) && isString(field.field_id) && isString(field.name) ? [field] : [],
                    )
                  : [],
              },
            ]
          : [],
      )
    : [];

  const interpretation = isJsonObject(value.interpretation) ? value.interpretation : {};
  const capabilities = isJsonObject(value.capabilities) ? value.capabilities : {};

  return {
    templates,
    models: isJsonArray(value.models) ? value.models.filter(isString) : [],
    interpretation:
      interpretation.available === true
        ? { available: true }
        : { available: false, reason: isString(interpretation.reason) ? interpretation.reason : "model_unavailable" },
    // Searching by cost is off unless the server says this caller may read costs.
    capabilities: { cost: capabilities.cost === true },
  };
}

/**
 * Ties a flow's running action to the palette: while `pending`, Esc and Back do nothing (the
 * registered back handler reports it handled them), and the palette can't be closed.
 */
export function useBusyFlow(pending, { registerBack, onBusyChange }) {
  const busy = useRef(pending);
  busy.current = pending;

  useEffect(() => {
    if (!registerBack) return undefined;
    registerBack(() => busy.current);

    return () => registerBack(null);
  }, [registerBack]);

  useEffect(() => {
    onBusyChange?.(pending);
  }, [pending, onBusyChange]);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
}
