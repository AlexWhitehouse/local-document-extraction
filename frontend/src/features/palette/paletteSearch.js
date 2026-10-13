import { SEARCH_LIMITS } from "../../../../shared/documentSearch.ts";
import { isJsonObject, isString } from "../../../../shared/json.ts";
import { pluralize } from "../../lib/text";
import { NO_MODEL_MESSAGE } from "./paletteState.js";

// The palette's fixed vocabulary (actions and pages) and its requests. Starting an action never
// needs a lookup: the list lives here, and the interpreter only ever picks one of these.

export const RESULT_PAGE_SIZE = 50;

export const DOCUMENT_MATCH_LIMIT = 4;

export const ACTIONS = [
  { action: "upload", label: "Upload documents…", hint: "Choose files and a template", keywords: "add files pdf scan" },
  { action: "find_documents", label: "Find documents", hint: "Search by field, status or date", keywords: "search look show list" },
  { action: "edit_template", label: "Edit template…", hint: "Describe a change for the assistant", keywords: "change update field" },
  { action: "create_template", label: "Create template…", hint: "Describe a type of document", keywords: "new add" },
  { action: "retry", label: "Try failed documents again…", hint: "Uses each template's current version", keywords: "retry rerun reprocess failed" },
  { action: "export", label: "Export documents…", hint: "CSV, JSON or Excel", keywords: "download csv json excel xlsx" },
  { action: "delete", label: "Delete documents…", hint: "Find them first, then confirm", keywords: "remove", danger: true },
  { action: "invite", label: "Invite member…", hint: "Email and role", keywords: "add user person email", roles: ["owner", "admin"] },
  { action: "switch_workspace", label: "Switch workspace…", hint: "Open another workspace", keywords: "change" },
  { action: "run_evaluation", label: "Run evaluation…", hint: "Compare a template's answers", keywords: "evaluate test models" },
];

const SUGGESTED_ACTIONS = ["upload", "find_documents", "edit_template", "retry", "create_template"];

// Command pages, in sidebar order, with the app page each opens.
export const PAGES = [
  { page: "workspace", appPage: "workspace", label: "Workspace", hint: "Members, API keys and model" },
  { page: "templates", appPage: "templates", label: "Templates" },
  { page: "documents", appPage: "documents", label: "Documents" },
  { page: "evaluations", appPage: "evaluations", label: "Evaluations" },
  { page: "costs", appPage: "costs", label: "Costs", roles: ["owner", "admin"] },
  { page: "connected_apps", appPage: "connected-apps", label: "Connected apps" },
];

export function appPageFor(page) {
  return PAGES.find((candidate) => candidate.page === page)?.appPage || "";
}

function allowed(entry, role) {
  return !entry.roles || entry.roles.includes(role);
}

function exampleQuestions(templates) {
  const named = templates[0]?.name;

  return [
    "Find failed documents from last week",
    named ? `Find ${named} documents uploaded this month` : "Find documents uploaded today",
    "Export completed documents as CSV",
    "Go to costs",
  ];
}

function wordsOf(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(words, text) {
  const haystack = text.toLowerCase();

  return words.every((word) => haystack.includes(word));
}

function actionItem(entry, { failedCount }) {
  return {
    id: `action:${entry.action}`,
    kind: "action",
    action: entry.action,
    label: entry.label,
    sub: entry.action === "retry" && failedCount ? pluralize(failedCount, "failed document") : entry.hint,
    danger: Boolean(entry.danger),
  };
}

export function documentItem(job, { templateNames, group }) {
  return {
    id: `document:${job.job_id}`,
    group,
    kind: "document",
    job,
    label: job.source_name || job.job_id,
    templateName: job.template_name || templateNames.get(job.template_id) || "",
  };
}

export function templateItem(template, group) {
  const fields = Array.isArray(template.fields) ? pluralize(template.fields.length, "field") : null;

  return {
    id: `template:${template.id}`,
    group,
    kind: "template",
    template,
    label: template.name || "Untitled template",
    sub: [`v${template.current_version ?? 1}`, fields].filter(Boolean).join(" · "),
  };
}

/**
 * Instant matches for the text typed so far, grouped as Actions, Templates, Documents, Go to and
 * Workspaces, plus the Ask row. With nothing typed: suggested actions, recent documents and
 * example questions.
 */
export function localMatches(query, sources) {
  const {
    role = "",
    templates = [],
    workspaces = [],
    workspaceId = "",
    recentDocuments = [],
    documentMatches = [],
    failedCount = 0,
    interpretationAvailable = false,
    localComplete = false,
    askFirst = false,
  } = sources;

  const templateNames = new Map(templates.map((template) => [template.id, template.name]));
  const trimmed = query.trim();
  const items = [];

  if (!trimmed) {
    for (const action of SUGGESTED_ACTIONS) {
      const entry = ACTIONS.find((candidate) => candidate.action === action);

      items.push({ ...actionItem(entry, { failedCount }), group: "Actions" });
    }

    for (const job of recentDocuments.slice(0, 3)) items.push(documentItem(job, { templateNames, group: "Recent documents" }));

    for (const question of exampleQuestions(templates))
      items.push({ id: `example:${question}`, group: "Try asking", kind: "example", label: question });

    return items;
  }

  const words = wordsOf(trimmed);

  for (const entry of ACTIONS) {
    if (allowed(entry, role) && matchesAll(words, `${entry.label} ${entry.keywords}`))
      items.push({ ...actionItem(entry, { failedCount }), group: "Actions" });
  }

  for (const template of templates) {
    if (matchesAll(words, `${template.name} template`)) items.push(templateItem(template, "Templates"));
  }

  for (const job of documentMatches.slice(0, DOCUMENT_MATCH_LIMIT))
    items.push(documentItem(job, { templateNames, group: "Documents" }));

  for (const entry of PAGES) {
    if (allowed(entry, role) && matchesAll(words, `${entry.label} go to page`))
      items.push({ id: `page:${entry.page}`, group: "Go to", kind: "page", page: entry.page, label: entry.label, sub: entry.hint || "Page" });
  }

  for (const workspace of workspaces) {
    if (matchesAll(words, `${workspace.name} switch workspace`)) {
      items.push({
        id: `workspace:${workspace.id}`,
        group: "Workspaces",
        kind: "workspace",
        workspace,
        label: workspace.name,
        sub: workspace.id === workspaceId ? "Current workspace" : "Switch workspace",
      });
    }
  }

  // Without a model the sentence can still be read locally, unless some words need the model.
  const ask = {
    id: "ask",
    group: "Ask",
    kind: "ask",
    label: trimmed,
    sub: interpretationAvailable ? "Search and run actions in plain language" : NO_MODEL_MESSAGE,
    disabled: !interpretationAvailable && !localComplete,
  };

  return askFirst || !items.length ? [ask, ...items] : [...items, ask];
}

function jsonRequest(body, signal) {
  const options = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };

  if (signal) options.signal = signal;

  return options;
}

function count(value) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

/** Documents whose name or ID matches, for the Documents group. */
export async function fetchDocumentMatches(request, query, signal) {
  const result = await request(`/jobs?search=${encodeURIComponent(query)}`, { method: "GET", signal });

  return Array.isArray(result?.jobs) ? result.jobs.slice(0, DOCUMENT_MATCH_LIMIT) : [];
}

/** One page of `POST /v1/jobs/search`. */
export async function searchDocuments(request, { filter, cursor = null, limit = RESULT_PAGE_SIZE, signal }) {
  const body = { filter, limit };

  if (cursor) body.cursor = cursor;

  const result = await request("/jobs/search", jsonRequest(body, signal));
  const jobs = Array.isArray(result?.jobs) ? result.jobs : [];

  return {
    jobs,
    total: Number.isSafeInteger(result?.total) ? result.total : jobs.length,
    totalCapped: result?.total_capped === true,
    nextCursor: isString(result?.next_cursor) ? result.next_cursor : null,
    hasMore: result?.has_more === true,
  };
}

/** The IDs and statuses of every match, up to the bulk limit, for Export, Try again and Delete. */
export async function searchTargets(request, filter, { limit = SEARCH_LIMITS.idsPageSize, signal } = {}) {
  const result = await request("/jobs/search", jsonRequest({ filter, ids_only: true, limit }, signal));
  const jobIds = Array.isArray(result?.job_ids) ? result.job_ids.filter(isString) : [];
  const statuses = isJsonObject(result?.statuses) ? result.statuses : {};

  return {
    jobIds,
    total: count(result?.total) || jobIds.length,
    totalCapped: result?.total_capped === true,
    statuses,
    hasMore: result?.has_more === true,
  };
}

export function failedTargetIds(targets) {
  return (targets?.jobIds || []).filter((id) => targets.statuses?.[id] === "failed");
}

// Upload dates are UTC days, so the interpreter resolves "last week" in UTC too.
export async function interpretRequest(request, { text, segments, today, signal }) {
  const result = await request(
    "/search/interpret",
    jsonRequest(
      { text, segments: segments.map((segment) => ({ type: segment.type, text: segment.text })), today, time_zone: "UTC" },
      signal,
    ),
  );

  return result?.interpretation;
}

// The search route reports filters that name a removed Template or field this way.
export function searchErrorMessage(error, describe) {
  if (error?.code === "invalid_search_filter")
    return "This search uses a template or field that's no longer available. Edit your request and try again.";

  return describe(error, "Couldn't search documents. Try again.");
}

/**
 * How many documents a bulk action may touch: "the latest 5" caps it at 5, and nothing goes past
 * the bulk limit. `capped` says whether the bulk limit, rather than the request, set the number.
 */
export function bulkLimit(interpretation, ceiling = SEARCH_LIMITS.idsPageSize) {
  const requested = interpretation?.args?.limit;

  return requested ? Math.min(requested, ceiling) : ceiling;
}

/** The note shown when only the newest part of the matches is acted on because of the bulk limit. */
export function capNote(targets, interpretation, verb) {
  if (interpretation?.args?.limit || !targets) return "";

  const more = targets.hasMore || targets.totalCapped || targets.total > targets.jobIds.length;

  if (!more) return "";

  return `The newest ${targets.jobIds.length} of ${targets.total}${targets.totalCapped ? "+" : ""} are ${verb}.`;
}
