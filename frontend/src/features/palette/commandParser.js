import {
  conditionLeaves,
  groupMembers,
  isConditionGroup,
  isCostTerm,
  isIsoDate,
  operatorsFor,
  SEARCH_LIMITS,
} from "../../../../shared/documentSearch.ts";

/**
 * Local command parser for the command palette. Pure and synchronous: it runs on every keystroke.
 * Template names, field labels and known values come from the workspace catalogue; only page names,
 * statuses and action verbs are fixed here.
 *
 * @typedef {import("../../../../shared/documentSearch.ts").SearchCatalog} SearchCatalog
 * @typedef {import("../../../../shared/documentSearch.ts").SearchCatalogTemplate} SearchCatalogTemplate
 * @typedef {import("../../../../shared/documentSearch.ts").SearchCatalogField} SearchCatalogField
 * @typedef {import("../../../../shared/documentSearch.ts").CommandInterpretation} CommandInterpretation
 * @typedef {import("../../../../shared/documentSearch.ts").CommandAction} CommandAction
 * @typedef {import("../../../../shared/documentSearch.ts").CommandArgs} CommandArgs
 * @typedef {import("../../../../shared/documentSearch.ts").CommandPage} CommandPage
 * @typedef {import("../../../../shared/documentSearch.ts").DocumentSearchFilter} DocumentSearchFilter
 * @typedef {import("../../../../shared/documentSearch.ts").FieldCondition} FieldCondition
 * @typedef {import("../../../../shared/documentSearch.ts").CostCondition} CostCondition
 * @typedef {import("../../../../shared/documentSearch.ts").CostTerm} CostTerm
 * @typedef {import("../../../../shared/documentSearch.ts").SearchCondition} SearchCondition
 * @typedef {import("../../../../shared/documentSearch.ts").InterpretationNote} InterpretationNote
 * @typedef {import("../../../../shared/documentSearch.ts").SearchJobStatus} SearchJobStatus
 * @typedef {import("../../../../shared/documentSearch.ts").SearchOperator} SearchOperator
 *
 * @typedef {"plain"|"action"|"quantity"|"subject"|"template"|"field"|"condition"|"value"|"date"|"status"|"person"|"role"|"format"|"page"|"workspace"|"instruction"} SegmentType
 * @typedef {{ type: SegmentType, text: string, start: number, end: number }} Segment
 * @typedef {{ id: string, name: string }} PaletteWorkspace
 * @typedef {{ workspaces?: PaletteWorkspace[] }} LexOptions
 * @typedef {{ today?: string, workspaces?: PaletteWorkspace[] }} InterpretOptions
 * @typedef {{ from: string|null, to: string|null }} DateRange
 * @typedef {{ interpretation: CommandInterpretation, complete: boolean, resolved: Array<string|null>, unused: string[] }} LocalInterpretation
 */

// ---------------------------------------------------------------------------
// Fixed vocabulary
// ---------------------------------------------------------------------------

/** @type {Array<[CommandAction, string[]]>} */
const ACTION_VERBS = [
  [
    "find_documents",
    [
      "show me",
      "search for",
      "look up",
      "look for",
      "pull up",
      "bring up",
      "give me",
      "find",
      "show",
      "search",
      "list",
      "get",
      "return",
      "fetch",
      "display",
      "view",
    ],
  ],
  ["edit_template", ["edit", "update", "modify", "change", "improve"]],
  ["create_template", ["create", "make"]],
  ["upload", ["upload"]],
  ["retry", ["try again", "retry", "re-run", "rerun", "reprocess", "process again"]],
  ["export", ["export", "download"]],
  ["delete", ["delete", "remove"]],
  ["invite", ["invite"]],
  ["switch_workspace", ["switch to", "switch", "change to"]],
  ["go_to", ["go to", "take me to", "navigate to", "open"]],
  ["run_evaluation", ["run an evaluation", "run evaluation", "evaluate"]],
];

/** @type {Map<string, CommandAction>} */
const ACTION_BY_VERB = new Map(ACTION_VERBS.flatMap(([action, verbs]) => verbs.map((verb) => [verb, action])));

/** Actions whose subject is a set of documents described by a filter. */
const FILTER_ACTIONS = new Set(["find_documents", "retry", "export", "delete"]);

/** @type {Array<[SearchJobStatus, string[]]>} */
const STATUS_WORDS = [
  ["failed", ["failed"]],
  ["completed", ["completed"]],
  ["processing", ["processing", "in progress"]],
  ["queued", ["queued"]],
  [
    "awaiting_template",
    ["needs a template", "needs template", "need a template", "awaiting template", "awaiting a template"],
  ],
];

/** @type {Map<string, SearchJobStatus>} */
const STATUS_BY_WORD = new Map(STATUS_WORDS.flatMap(([status, words]) => words.map((word) => [word, status])));

const STATUS_LABELS = {
  failed: "failed",
  completed: "completed",
  processing: "processing",
  queued: "queued",
  awaiting_template: "needs template",
};

/** @type {Array<[CommandPage, string[]]>} */
const PAGE_WORDS = [
  ["documents", ["documents"]],
  ["templates", ["templates"]],
  ["evaluations", ["evaluations"]],
  ["costs", ["costs", "cost", "spend", "spending"]],
  ["workspace", ["workspace settings", "workspace", "settings", "members", "team"]],
  ["connected_apps", ["connected apps"]],
];

/** @type {Map<string, CommandPage>} */
const PAGE_BY_WORD = new Map(PAGE_WORDS.flatMap(([page, words]) => words.map((word) => [word, page])));

const PAGE_LABELS = {
  documents: "Documents",
  templates: "Templates",
  evaluations: "Evaluations",
  costs: "Costs",
  workspace: "Workspace",
  connected_apps: "Connected apps",
};

/** Generic subject words. Template names (singular and plural) are added from the catalogue. */
const DOCUMENT_SUBJECTS = ["documents", "document", "docs", "files", "file"];

const TEMPLATE_SUBJECTS = ["templates", "template"];

/** Words that describe what a Template is rather than which one, e.g. "Prescription Template" → "prescription". */
const GENERIC_NAME_WORDS = new Set(["template", "templates", "form", "forms", "document", "documents", "type"]);

/** Words that carry no meaning on their own, so leaving them out never loses anything. */
const STOP_WORDS = new Set(
  (
    "a an the and or of for from in into on at by to with where whose which that who is are was were be been has have had " +
    "me my our their i you we us can could would please want like need let lets let's show all any every some " +
    "those these them they ones only just it its this page pages tab screen section list " +
    "do does did get give"
  ).split(" "),
);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTH_FULL = "january|february|march|april|may|june|july|august|september|october|november|december";

const MONTH_ANY = `${MONTH_FULL}|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec`;

const ORDINAL = "(?:st|nd|rd|th)?";

const WORD_END = "(?![\\p{L}\\p{N}_])";

const RELATIVE_DATE =
  "today|yesterday|this\\s+(?:week|month|year)|last\\s+(?:week|month|year)|(?:the\\s+)?(?:last|past)\\s+\\d{1,3}\\s+days?|(?:the\\s+)?past\\s+week";

const EXPLICIT_DATE =
  `\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4}` +
  `|\\d{1,2}${ORDINAL}\\s+(?:of\\s+)?(?:${MONTH_ANY})\\.?(?:,?\\s+\\d{4})?` +
  `|(?:${MONTH_ANY})\\.?\\s+\\d{1,2}${ORDINAL}(?:,?\\s+\\d{4})?`;

const MONTH_PERIOD = `(?:${MONTH_ANY})\\.?\\s+\\d{4}|(?:${MONTH_FULL})`;

const DATE_CORE = `${RELATIVE_DATE}|${EXPLICIT_DATE}|${MONTH_PERIOD}|\\d{4}`;

const DATE_PREFIX = "from|in|during|since|before|after|on|until|till|by|up\\s+to";

const NUMBER = "[£$€]?\\s?-?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";

const QUOTED =
  "\"[^\"]*(?:\"|$)|“[^”]*(?:”|$)|'(?:[^']|'(?=[\\p{L}\\p{N}]))*(?:'|$)|‘(?:[^’]|’(?=[\\p{L}\\p{N}]))*(?:’|$)";

const BARE_VALUE = '[^\\s,;"“”()]*[^\\s,;"“”().?!:]';

const DATE_PATTERN = new RegExp(
  `^(?:(?:uploaded|added|created|received)\\s+)?(?:(${DATE_PREFIX})\\s+)?(?:the\\s+)?(${DATE_CORE})$`,
  "iu",
);

const UPLOAD_VERB = "(?:(?:uploaded|added|created|received)\\s+)?";

const RANGE_TO = "to|until|till|through|thru";

/** A dash between dates needs spaces around it, so ISO dates such as 2026-03-01 aren't split. */
const RANGE_DASH = "\\s+[-–]\\s+|\\s*–\\s*";

const DAY_OR_MONTH = `${EXPLICIT_DATE}|${MONTH_PERIOD}`;

/** A range end other than a bare year, which after "between" or around a dash reads as a number. */
const RANGE_CORE = `${RELATIVE_DATE}|${DAY_OR_MONTH}`;

/**
 * Two-ended date ranges: "from X to Y", "from X until Y", "between X and Y", "X – Y", and "X to Y"
 * when both ends are explicit days or months. Bare years only form a range after "from".
 */
const DATE_RANGE =
  `${UPLOAD_VERB}(?:` +
  `from\\s+(?:the\\s+)?(?:${DATE_CORE})(?:\\s+(?:${RANGE_TO})\\s+|${RANGE_DASH})(?:the\\s+)?(?:${DATE_CORE})` +
  `|between\\s+(?:the\\s+)?(?:${RANGE_CORE})(?:\\s+(?:and|to)\\s+|${RANGE_DASH})(?:the\\s+)?(?:${RANGE_CORE})` +
  `|(?:${RANGE_CORE})(?:${RANGE_DASH})(?:${RANGE_CORE})` +
  `|(?:${DAY_OR_MONTH})\\s+(?:${RANGE_TO})\\s+(?:${DAY_OR_MONTH}))`;

const DATE_RANGE_PATTERN = new RegExp(
  `^${UPLOAD_VERB}(?:(from|between)\\s+)?(?:the\\s+)?(${DATE_CORE})(?:\\s+(${RANGE_TO}|and)\\s+|${RANGE_DASH})(?:the\\s+)?(${DATE_CORE})$`,
  "iu",
);

const RELATIVE_WHOLE = new RegExp(`^(?:the\\s+)?(?:${RELATIVE_DATE})$`, "iu");

/** Condition phrases that test the stored state rather than a value. */
const STATE_PHRASES = {
  not_found: [
    "is missing",
    "are missing",
    "was missing",
    "missing",
    "is not found",
    "isn't found",
    "not found",
    "was not found",
    "wasn't found",
    "is unknown",
    "is not set",
    "isn't set",
    "has no value",
    "without a",
    "without an",
    "without the",
    "without",
    "with no",
  ],
  empty: ["is empty", "is blank", "was empty", "empty", "blank"],
  invalid: ["is invalid", "was invalid", "invalid"],
  has_value: [
    "has a value",
    "has value",
    "is present",
    "is set",
    "exists",
    "is not missing",
    "isn't missing",
    "is not empty",
    "isn't empty",
    "with a value",
  ],
  is_true: ["is yes", "is true", "= yes", "= true"],
  is_false: ["is no", "is false", "= no", "= false"],
};

/** @type {Map<string, SearchOperator>} */
const STATE_BY_PHRASE = new Map(
  Object.entries(STATE_PHRASES).flatMap(([op, phrases]) => phrases.map((phrase) => [phrase, op])),
);

/** Text operators. "is" on a number or date field becomes "eq". */
const TEXT_PHRASES = {
  starts_with: ["starts with", "start with", "begins with", "begin with", "starting with"],
  ends_with: ["ends with", "end with", "ending with"],
  contains: [
    "contains",
    "contain",
    "containing",
    "includes",
    "include",
    "mentions",
    "mentioning",
    "matches",
    "matching",
    "named",
    "called",
    "titled",
  ],
  is_not: ["is not", "isn't", "!="],
  is: ["is", "equals", "equal to", "==", "="],
};

/** @type {Map<string, SearchOperator>} */
const TEXT_BY_PHRASE = new Map(
  Object.entries(TEXT_PHRASES).flatMap(([op, phrases]) => phrases.map((phrase) => [phrase, op])),
);

/** Words before a value that leave it out: "excluding Acme", "not from Acme", "without Acme". */
const NEGATION_LEAD =
  "excluding|except\\s+for|except|other\\s+than|(?:(?:is|are|was|were)\\s+)?not\\s+(?:from|by)" +
  "|(?:isn|aren|wasn|weren)['’]t\\s+(?:from|by)|without";

const NEGATED_PATTERN = new RegExp(`^(${NEGATION_LEAD})(?:\\s+|(?=["“'‘]))([\\s\\S]+)$`, "iu");

const COMPARE_PHRASES = {
  gt: ["over", "above", "more than", "greater than", "higher than", "after", ">"],
  gte: ["at least", "no less than", "since", "on or after", ">="],
  lt: ["under", "below", "less than", "lower than", "before", "<"],
  lte: ["at most", "no more than", "until", "up to", "on or before", "<="],
  eq: ["on", "is", "equals", "="],
};

/** @type {Map<string, SearchOperator>} */
const COMPARE_BY_PHRASE = new Map(
  Object.entries(COMPARE_PHRASES).flatMap(([op, phrases]) => phrases.map((phrase) => [phrase, op])),
);

/**
 * Words for what a document cost to process. They mean the processing cost only when an amount
 * follows ("cost over $0.03"); otherwise "costs" and "spend" name the Costs page.
 */
const COST_PHRASES = [
  "total processing cost",
  "total processing costs",
  "processing cost",
  "processing costs",
  "total cost",
  "total costs",
  "cost to process",
  "price to process",
  "cost",
  "costs",
  "costing",
  "costed",
  "spend",
  "spent",
  "spending",
];

const COST_PHRASE_KEYS = new Set(COST_PHRASES);

/** Comparisons for an amount. Date words such as "after" or "since" don't apply to money. */
const COST_COMPARE_PHRASES = {
  gt: ["over", "above", "more than", "greater than", "higher than", "in excess of", ">"],
  gte: ["at least", "no less than", ">="],
  lt: ["under", "below", "less than", "lower than", "cheaper than", "<"],
  lte: ["at most", "no more than", "up to", "<="],
  eq: ["exactly", "equal to", "equals", "="],
};

/** @type {Map<string, SearchOperator>} */
const COST_COMPARE_BY_PHRASE = new Map(
  Object.entries(COST_COMPARE_PHRASES).flatMap(([op, phrases]) => phrases.map((phrase) => [phrase, op])),
);

const COST_AMOUNT = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+";

const DOLLAR_AMOUNT = `(?:us\\s?)?\\$\\s?(?:${COST_AMOUNT})(?:\\s*(?:usd|dollars?))?`;

/** An amount with a currency: "$0.03", "3 cents", "3c", "2 dollars". */
const MARKED_AMOUNT = `${DOLLAR_AMOUNT}|(?:${COST_AMOUNT})(?:\\s*(?:cents?|usd|dollars?)|\\s?¢|c)`;

/** Plain numbers are dollars. */
const AMOUNT = `${MARKED_AMOUNT}|${COST_AMOUNT}`;

/** "is", "was" or "of" may come between the cost phrase and its comparison: "a cost of more than $1". */
const COST_LEAD = "(?:(?:is|are|was|were|of)\\s+)?";

export const PROCESSING_COST_LABEL = "Processing cost";

const COST_UNAVAILABLE = "Only owners and admins can search by cost.";

/**
 * Words that turn the phrases after them around ("except failed", "not from last week") when the parser
 * can't read them as part of a phrase.
 */
const NEGATING_WORDS = new Set(
  (
    "not no never except excepting excluding exclude excludes without other besides apart but minus sans unless " +
    "nor neither non isn't aren't wasn't weren't doesn't don't didn't instead rather omit omitting ignore ignoring " +
    "skip skipping"
  ).split(" "),
);

/** The same for the phrases before them: "Acme excluded". */
const NEGATING_AFTER_WORDS = new Set(["excluded", "excepted", "omitted", "aside", "ignored", "skipped"]);

/** Segment types that add to a document filter. */
const PREDICATE_TYPES = new Set(["field", "value", "condition", "date", "status"]);

/** Bare words that should keep their own meaning instead of becoming the value of "is". */
const RESERVED_VALUES = new Set([
  ...STATUS_BY_WORD.keys(),
  "missing",
  "empty",
  "blank",
  "invalid",
  "unknown",
  "set",
  "present",
  "not",
  "over",
  "under",
  "above",
  "below",
  "between",
  "before",
  "after",
  "a",
  "an",
  "the",
]);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** @param {string} value */
function phraseKey(value) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Longest phrases first, so a regex alternation picks the longest match.
 * @param {Iterable<string>} phrases
 */
function alternation(phrases) {
  /** @type {Set<string>} */
  const unique = new Set();

  for (const phrase of phrases) {
    const key = phraseKey(phrase);

    if (key) unique.add(key);
  }

  if (!unique.size) return "(?!)";

  return [...unique]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => escapeRegExp(phrase).replace(/ /g, "\\s+"))
    .join("|");
}

/** @param {string} source */
function sticky(source) {
  return new RegExp(`(?:${source})${WORD_END}`, "iuy");
}

/** Like sticky, for phrases that may end in a symbol such as "=". */
function stickyLoose(source) {
  return new RegExp(`(?:${source})`, "iuy");
}

/**
 * @param {RegExp} pattern
 * @param {string} text
 * @param {number} index
 */
function matchAt(pattern, text, index) {
  pattern.lastIndex = index;
  const match = pattern.exec(text);

  return match && match[0].length ? match[0] : null;
}

/** @param {string} word */
function pluralOf(word) {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;

  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;

  return `${word}s`;
}

/** @param {string} phrase Pluralises the last word: "delivery note" → "delivery notes". */
function pluralPhrase(phrase) {
  const words = phrase.split(" ");

  return [...words.slice(0, -1), pluralOf(words[words.length - 1])].join(" ");
}

/**
 * The distinctive part of each Template name, without generic words such as "template" or "form",
 * so "prescriptions" finds "Prescription Template". A short name shared by several Templates, or one
 * that is itself a generic or filler word, is left out rather than guessed.
 * @param {SearchCatalogTemplate[]} templates
 * @returns {Map<SearchCatalogTemplate, string>}
 */
function shortTemplateNames(templates) {
  /** @type {Map<string, SearchCatalogTemplate[]>} */
  const owners = new Map();

  for (const template of templates) {
    const name = phraseKey(template.name);

    if (!name) continue;
    const words = name.split(" ");

    while (words.length && GENERIC_NAME_WORDS.has(words[words.length - 1])) words.pop();

    while (words.length && GENERIC_NAME_WORDS.has(words[0])) words.shift();
    const short = words.join(" ");

    if (!short || short === name || short.length < 3 || STOP_WORDS.has(short)) continue;
    owners.set(short, [...(owners.get(short) ?? []), template]);
  }

  const fullNames = new Set(templates.map((template) => phraseKey(template.name)));
  /** @type {Map<SearchCatalogTemplate, string>} */
  const short = new Map();

  for (const [name, list] of owners) if (list.length === 1 && !fullNames.has(name)) short.set(list[0], name);

  return short;
}

/** @param {string} value */
function stripQuotes(value) {
  const trimmed = value.trim();
  const match = /^(["“'‘])([\s\S]*?)(["”'’])?$/u.exec(trimmed);

  return match ? match[2] : trimmed;
}

/** @param {string} value */
function isQuoted(value) {
  return /^["“'‘]/u.test(value.trim());
}

/**
 * @param {string} text
 * @param {boolean} [keepOr] keep "or", which is otherwise a filler word
 */
function significantWords(text, keepOr = false) {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}_'’.@/-]*/gu) ?? [];
  /** @type {string[]} */
  const kept = [];

  for (const raw of words) {
    const word = raw.replace(/[.'’-]+$/u, "");

    const key = word.toLowerCase().replace(/’/g, "'");

    if (word && (!STOP_WORDS.has(key) || (keepOr && key === "or"))) kept.push(word);
  }

  return kept;
}

/**
 * Cuts text to a limit without leaving whitespace at either end.
 * @param {string} text
 * @param {number} length
 */
function clip(text, length) {
  return text.trim().slice(0, length).trim();
}

/**
 * @param {string} text
 * @param {number} length
 */
function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// Calendar helpers. Dates are UTC calendar days (`YYYY-MM-DD`), as the server compares upload dates
// by UTC day. Callers pass `today` as the UTC date.
// ---------------------------------------------------------------------------

/** Today's UTC calendar day. */
function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

/** @param {string} iso */
function utcDate(iso) {
  const { year, month, day } = dayParts(iso);
  const date = new Date(0);

  date.setUTCFullYear(year, month - 1, day);

  return date;
}

/**
 * Days roll over (day 0 is the last day of the previous month). Years outside 1000–9999 give a
 * string that `validDay` rejects.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 */
function isoDay(year, month, day) {
  const date = new Date(0);

  date.setUTCFullYear(year, month - 1, day);

  return date.toISOString().slice(0, 10);
}

/** A day the search contract accepts: four-digit year from 1000. */
function validDay(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= "1000-01-01";
}

/**
 * @template {DateRange} T
 * @param {T | null} range
 * @returns {T | null}
 */
function checkedRange(range) {
  if (!range) return null;

  return (range.from === null || validDay(range.from)) && (range.to === null || validDay(range.to)) ? range : null;
}

/** @param {string} iso */
function dayParts(iso) {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) };
}

/**
 * @param {string} iso
 * @param {number} days
 */
function addDays(iso, days) {
  const { year, month, day } = dayParts(iso);

  return isoDay(year, month, day + days);
}

/** Monday of the week containing `iso`. */
function weekStart(iso) {
  const { year, month, day } = dayParts(iso);
  const weekday = (utcDate(isoDay(year, month, day)).getUTCDay() + 6) % 7;

  return addDays(iso, -weekday);
}

/**
 * @param {number} year
 * @param {number} month 1-12; 0 and 13 roll over into the neighbouring year
 */
function monthRange(year, month) {
  return { from: isoDay(year, month, 1), to: isoDay(year, month + 1, 0) };
}

/** @param {string} name */
function monthNumber(name) {
  return MONTHS.indexOf(name.toLowerCase().replace(/\.$/, "").slice(0, 3)) + 1;
}

/**
 * Builds a real calendar day, or null for impossible dates such as 31 February.
 * Without a year, the date is in today's year; with `pastBias` a date after today moves to the previous year.
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {{ today: string, pastBias: boolean, yearGiven: boolean }} context
 */
function calendarDay(year, month, day, context) {
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (!isIsoDate(iso)) return null;

  if (!context.yearGiven && context.pastBias && iso > context.today)
    return calendarDay(year - 1, month, day, { ...context, yearGiven: true });

  return iso;
}

/**
 * Resolves a date expression without a prefix to the days it covers, or null when it isn't a real day
 * in the years 1000–9999.
 * @param {string} core
 * @param {string} today
 * @param {boolean} pastBias true for upload dates: periods stop at today and dates without a year are in the past
 * @returns {{ from: string, to: string } | null}
 */
function resolveDateCore(core, today, pastBias) {
  return checkedRange(resolveDateCoreUnchecked(core, today, pastBias));
}

/**
 * @param {string} core
 * @param {string} today
 * @param {boolean} pastBias
 * @returns {{ from: string, to: string } | null}
 */
function resolveDateCoreUnchecked(core, today, pastBias) {
  const text = phraseKey(core).replace(/^the /, "");
  const { year: thisYear, month: thisMonth } = dayParts(today);
  let match;

  if (text === "today") return { from: today, to: today };

  if (text === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };

  if (text === "this week") return { from: weekStart(today), to: pastBias ? today : addDays(weekStart(today), 6) };

  if (text === "last week") {
    const monday = addDays(weekStart(today), -7);

    return { from: monday, to: addDays(monday, 6) };
  }

  if (text === "this month")
    return pastBias ? { from: isoDay(thisYear, thisMonth, 1), to: today } : monthRange(thisYear, thisMonth);

  if (text === "last month") return monthRange(thisYear, thisMonth - 1);

  if (text === "this year") return { from: isoDay(thisYear, 1, 1), to: pastBias ? today : isoDay(thisYear, 12, 31) };

  if (text === "last year") return { from: isoDay(thisYear - 1, 1, 1), to: isoDay(thisYear - 1, 12, 31) };

  if (text === "past week") return { from: addDays(today, -6), to: today };

  if ((match = /^(?:last|past) (\d{1,3}) days?$/.exec(text))) {
    const count = Number(match[1]);

    return count >= 1 ? { from: addDays(today, 1 - count), to: today } : null;
  }

  const context = { today, pastBias, yearGiven: false };

  if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) {
    const day = calendarDay(Number(match[1]), Number(match[2]), Number(match[3]), { ...context, yearGiven: true });

    return day ? { from: day, to: day } : null;
  }

  if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) {
    const day = calendarDay(Number(match[3]), Number(match[2]), Number(match[1]), { ...context, yearGiven: true });

    return day ? { from: day, to: day } : null;
  }

  if (
    (match = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)\.?(?:,? (\d{4}))?$/.exec(text)) ||
    (match = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(text))
  ) {
    const dayFirst = /^\d/.test(match[1]);
    const month = monthNumber(dayFirst ? match[2] : match[1]);
    const dayOfMonth = Number(dayFirst ? match[1] : match[2]);
    const yearGiven = match[3] !== undefined;

    if (!month) return null;
    const day = calendarDay(yearGiven ? Number(match[3]) : thisYear, month, dayOfMonth, { ...context, yearGiven });

    return day ? { from: day, to: day } : null;
  }

  if ((match = /^([a-z]+)\.?(?: (\d{4}))?$/.exec(text))) {
    const month = monthNumber(match[1]);

    if (!month || (match[2] === undefined && match[1].length < 3)) return null;

    if (match[2] !== undefined) return monthRange(Number(match[2]), month);

    return monthRange(pastBias && month > thisMonth ? thisYear - 1 : thisYear, month);
  }

  if ((match = /^(\d{4})$/.exec(text))) {
    const year = Number(match[1]);

    return year >= 1900 && year <= 2999 ? { from: isoDay(year, 1, 1), to: isoDay(year, 12, 31) } : null;
  }

  return null;
}

/** @param {string} core a day or month written without a year, such as "1 March" or "March" */
function isYearless(core) {
  return !/\d{4}/.test(core) && !RELATIVE_WHOLE.test(core.trim());
}

/**
 * @param {string} core
 * @param {number} year
 */
function resolveInYear(core, year) {
  return resolveDateCore(core, isoDay(year, 1, 1), false);
}

/**
 * Both ends of a range, inclusive. A day or month without a year takes its year from the other end,
 * rolling over when needed, so "1 December to 5 January" crosses into the next year. Returns null
 * when the range runs backwards rather than swapping the ends.
 * @param {string} startCore
 * @param {string} endCore
 * @param {string} today
 * @param {boolean} pastBias
 * @returns {{ from: string, to: string } | null}
 */
function resolveDateRange(startCore, endCore, today, pastBias) {
  let start;
  let end;

  if (isYearless(startCore) && !isYearless(endCore)) {
    end = resolveDateCore(endCore, today, pastBias);

    if (!end) return null;
    const year = dayParts(end.to).year;

    start = resolveInYear(startCore, year);

    if (start && start.from > end.to) start = resolveInYear(startCore, year - 1);
  } else {
    start = resolveDateCore(startCore, today, pastBias);

    if (!start) return null;

    if (isYearless(endCore)) {
      const year = dayParts(start.from).year;

      end = resolveInYear(endCore, year);

      if (end && end.to < start.from) end = resolveInYear(endCore, year + 1);
    } else end = resolveDateCore(endCore, today, pastBias);
  }

  if (!start || !end || start.from > end.to) return null;

  return { from: start.from, to: end.to };
}

/**
 * @param {string} phrase
 * @param {string} today
 * @param {boolean} pastBias
 * @returns {(DateRange & { prefix: string }) | null}
 */
function parseDatePhrase(phrase, today, pastBias) {
  const text = phrase.trim().replace(/\s+/g, " ");
  const range = DATE_RANGE_PATTERN.exec(text);

  if (range) {
    const [, prefix, start, connector, end] = range;
    const lead = prefix?.toLowerCase();
    const joiner = connector?.toLowerCase();
    // "and" only joins a range after "between"; "between" takes "and", "to" or a dash.
    const joined = joiner === "and" ? lead === "between" : lead !== "between" || !joiner || joiner === "to";
    const years = /^\d{4}$/.test(start) || /^\d{4}$/.test(end);
    const fits = joined && (!years || lead === "from");
    const resolved = fits ? resolveDateRange(start, end, today, pastBias) : null;

    return resolved ? { ...resolved, prefix: "range" } : null;
  }

  const match = DATE_PATTERN.exec(text);

  if (!match) return null;
  const prefix = match[1] ? phraseKey(match[1]) : "";
  const core = match[2];

  if (!prefix && /^\d{4}$/.test(core)) return null;
  const base = resolveDateCore(core, today, pastBias);

  if (!base) return null;

  return checkedRange(applyDatePrefix(prefix, base));
}

/**
 * @param {string} prefix
 * @param {{ from: string, to: string }} base
 * @returns {DateRange & { prefix: string }}
 */
function applyDatePrefix(prefix, base) {
  if (prefix === "since") return { from: base.from, to: null, prefix };

  if (prefix === "after") return { from: addDays(base.to, 1), to: null, prefix };

  if (prefix === "before") return { from: null, to: addDays(base.from, -1), prefix };

  if (prefix === "until" || prefix === "till" || prefix === "by" || prefix === "up to")
    return { from: null, to: base.to, prefix };

  if (prefix === "from" && base.from === base.to) return { from: base.from, to: null, prefix };

  return { from: base.from, to: base.to, prefix };
}

/**
 * Resolves a date phrase against the UTC calendar. Weeks start on Monday; "last week" is the previous
 * Monday to Sunday; "last 7 days" and "past week" end today. Accepts the forms the lexer marks as dates,
 * including "since/before/after/until <date>", ISO and UK dates, "1 March 2026", "March" and "March 2026".
 * Dates without a year that would fall after today move to the previous year, as uploads can't be in the future.
 * Phrases outside the years 1000–9999 give null.
 *
 * @param {string} phrase
 * @param {string} [today] `YYYY-MM-DD`, today's UTC date. Defaults to the current UTC day.
 * @returns {DateRange | null} Inclusive days. An open-ended phrase ("since…", "before…") leaves one end null.
 */
export function resolveRelativeDate(phrase, today = utcToday()) {
  const range = parseDatePhrase(phrase, today, true);

  return range ? { from: range.from, to: range.to } : null;
}

/**
 * @param {string} iso
 * @param {string|null} currentYear show the year when it differs from this one; null always shows it
 */
function formatDay(iso, currentYear) {
  const { year, month, day } = dayParts(iso);
  const label = `${day} ${MONTH_LABELS[month - 1]}`;

  return currentYear !== null && String(year) === currentYear ? label : `${label} ${year}`;
}

/**
 * @param {DateRange} range
 * @param {string} today
 */
function formatRange(range, today) {
  const year = today.slice(0, 4);
  const spansYears = range.from && range.to && range.from.slice(0, 4) !== range.to.slice(0, 4);
  const yearFor = spansYears ? null : year;

  if (range.from && range.to) {
    return range.from === range.to
      ? formatDay(range.from, yearFor)
      : `${formatDay(range.from, yearFor)} – ${formatDay(range.to, yearFor)}`;
  }

  if (range.from) return `From ${formatDay(range.from, year)}`;

  return range.to ? `Until ${formatDay(range.to, year)}` : "";
}

// ---------------------------------------------------------------------------
// Catalogue lexicon: built once per catalogue object
// ---------------------------------------------------------------------------

/**
 * Phrases grouped by their first word. Within a group, a lookup tries each distinct phrase length once
 * (longest first) against a Set, so the cost depends on phrase lengths, not on the size of the catalogue.
 * @typedef {{ lengths: number[], keys: Set<string>, phrases: string[] }} PhraseGroup
 * @typedef {Map<string, PhraseGroup>} PhraseIndex
 *
 * @typedef {{ template: SearchCatalogTemplate, field: SearchCatalogField }} FieldEntry
 * @typedef {{ template: SearchCatalogTemplate, field: SearchCatalogField, value: string }} ValueEntry
 * @typedef {{ kind: "documents"|"templates", template: SearchCatalogTemplate|null, plural: boolean }} SubjectEntry
 * @typedef {{
 *   templates: SearchCatalogTemplate[],
 *   subjects: Map<string, SubjectEntry>,
 *   templateNames: Map<string, SearchCatalogTemplate>,
 *   fields: Map<string, FieldEntry[]>,
 *   booleanLabels: Set<string>,
 *   values: Map<string, ValueEntry[]>,
 *   costAvailable: boolean,
 *   index: { subjects: PhraseIndex, templateNames: PhraseIndex, fields: PhraseIndex, booleanLabels: PhraseIndex, values: PhraseIndex },
 * }} Lexicon
 */

/** @type {WeakMap<SearchCatalog, Lexicon>} */
const lexiconCache = new WeakMap();

/** @type {SearchCatalog} */
const EMPTY_CATALOG = {
  templates: [],
  models: [],
  interpretation: { available: false, reason: "model_not_configured" },
  capabilities: { cost: false },
};

/**
 * @param {SearchCatalog|null|undefined} catalog
 * @returns {Lexicon}
 */
function lexiconFor(catalog) {
  const source = catalog ?? EMPTY_CATALOG;
  const cached = lexiconCache.get(source);

  if (cached) return cached;
  const lexicon = buildLexicon(source);

  lexiconCache.set(source, lexicon);

  return lexicon;
}

/**
 * @param {Map<string, T[]>} map
 * @param {string} key
 * @param {T} entry
 * @template T
 */
function addTo(map, key, entry) {
  const list = map.get(key);

  if (list) list.push(entry);
  else map.set(key, [entry]);
}

/** Verb forms for date fields: "Issue date" can be written "issued". */
function dateFieldAliases(label) {
  const match = /^([a-z]+) date$/.exec(label);

  if (!match) return [];
  const word = match[1];

  return [word.endsWith("e") ? `${word}d` : `${word}ed`];
}

const TOKEN = /[\p{L}\p{N}]+/uy;

/**
 * The lowercased word starting at `index`, or the single character there when it isn't a word.
 * @param {string} text
 * @param {number} index
 */
function firstToken(text, index) {
  TOKEN.lastIndex = index;
  const match = TOKEN.exec(text);

  return (match ? match[0] : text.charAt(index)).toLowerCase();
}

/** @param {string} char */
function isWordChar(char) {
  return /^[\p{L}\p{N}_]$/u.test(char);
}

/**
 * @param {Iterable<string>} keys phrase keys from `phraseKey`
 * @returns {PhraseIndex}
 */
function phraseIndex(keys) {
  /** @type {PhraseIndex} */
  const index = new Map();

  for (const key of keys) {
    if (!key) continue;
    const token = firstToken(key, 0);
    const group = index.get(token) ?? { lengths: [], keys: new Set(), phrases: [] };

    if (!group.keys.has(key)) {
      group.keys.add(key);
      group.phrases.push(key);

      if (!group.lengths.includes(key.length)) group.lengths.push(key.length);
    }

    index.set(token, group);
  }

  for (const group of index.values()) {
    group.lengths.sort((a, b) => b - a);
    group.phrases.sort((a, b) => b.length - a.length);
  }

  return index;
}

/**
 * Where `phrase` ends if the text at `start` spells it, ignoring case and the amount of whitespace; else -1.
 * @param {string} text
 * @param {number} start
 * @param {string} phrase
 */
function phraseEnd(text, start, phrase) {
  let position = start;

  for (const expected of phrase) {
    if (expected === " ") {
      if (!/\s/.test(text.charAt(position))) return -1;

      while (/\s/.test(text.charAt(position))) position += 1;
      continue;
    }

    const actual = text.slice(position, position + expected.length);

    if (actual.toLowerCase() !== expected) return -1;
    position += expected.length;
  }

  if (isWordChar(phrase.slice(-1)) && isWordChar(text.charAt(position))) return -1;

  return position;
}

/**
 * The longest phrase from the index at `start`.
 * @param {PhraseIndex} index
 * @param {string} text
 * @param {number} start
 * @returns {{ key: string, end: number } | null}
 */
function lookupPhrase(index, text, start) {
  const group = index.get(firstToken(text, start));

  if (!group) return null;
  const window = text.slice(start, start + group.lengths[0]);

  // Runs of whitespace change the length, so compare phrase by phrase. Typed text rarely has them.
  if (/\s\s/.test(window)) {
    for (const key of group.phrases) {
      const end = phraseEnd(text, start, key);

      if (end > start) return { key, end };
    }

    return null;
  }

  for (const length of group.lengths) {
    if (window.length < length) continue;
    const key = window.slice(0, length).toLowerCase().replace(/\s/g, " ");
    const end = start + length;

    if (group.keys.has(key) && !(isWordChar(key.slice(-1)) && isWordChar(text.charAt(end)))) return { key, end };
  }

  return null;
}

/**
 * Like lookupPhrase, also trying after an optional prefix such as "the ".
 * @param {PhraseIndex} index
 * @param {string} text
 * @param {number} start
 * @param {RegExp} prefix
 */
function lookupWithPrefix(index, text, start, prefix) {
  const plain = lookupPhrase(index, text, start);
  const prefixText = matchAt(prefix, text, start);
  const prefixed = prefixText ? lookupPhrase(index, text, start + prefixText.length) : null;

  return prefixed && (!plain || prefixed.end > plain.end) ? prefixed : plain;
}

/**
 * @param {SearchCatalog} catalog
 * @returns {Lexicon}
 */
function buildLexicon(catalog) {
  /** @type {Map<string, SubjectEntry>} */
  const subjects = new Map();
  /** @type {Map<string, SearchCatalogTemplate>} */
  const templateNames = new Map();
  /** @type {Map<string, FieldEntry[]>} */
  const fields = new Map();
  /** @type {Set<string>} */
  const booleanLabels = new Set();
  /** @type {Map<string, ValueEntry[]>} */
  const values = new Map();

  for (const word of DOCUMENT_SUBJECTS)
    subjects.set(word, { kind: "documents", template: null, plural: word.endsWith("s") });

  for (const word of TEMPLATE_SUBJECTS)
    subjects.set(word, { kind: "templates", template: null, plural: word.endsWith("s") });

  const shortNames = shortTemplateNames(catalog.templates);

  for (const template of catalog.templates) {
    const name = phraseKey(template.name);

    if (!name) continue;
    const short = shortNames.get(template);

    for (const base of short ? [name, short] : [name]) {
      for (const [form, isPlural] of [
        [base, false],
        [pluralPhrase(base), true],
      ]) {
        if (!templateNames.has(form)) templateNames.set(form, template);

        if (!subjects.has(form)) subjects.set(form, { kind: "documents", template, plural: isPlural });
      }
    }

    for (const field of template.fields) {
      if (!field.type) continue;
      const label = phraseKey(field.name);

      if (!label) continue;
      addTo(fields, label, { template, field });

      if (field.type === "date") for (const alias of dateFieldAliases(label)) addTo(fields, alias, { template, field });

      if (field.type === "boolean") booleanLabels.add(label);

      if (field.type !== "text") continue;

      for (const value of field.known_values ?? []) {
        const key = phraseKey(value);

        if (!usableKnownValue(key)) continue;
        addTo(values, key, { template, field, value: value.trim() });
      }
    }
  }

  // Field labels and template names keep their own meaning when a value has the same text.
  for (const key of [...values.keys()]) if (fields.has(key) || subjects.has(key)) values.delete(key);

  return {
    templates: catalog.templates,
    subjects,
    templateNames,
    fields,
    booleanLabels,
    values,
    // Only callers who may read costs can search by them; without capabilities, nobody can.
    costAvailable: catalog.capabilities?.cost === true,
    index: {
      subjects: phraseIndex(subjects.keys()),
      templateNames: phraseIndex(templateNames.keys()),
      fields: phraseIndex(fields.keys()),
      booleanLabels: phraseIndex(booleanLabels),
      values: phraseIndex(values.keys()),
    },
  };
}

/** Known values that are too short or too common would turn ordinary words into filters. */
function usableKnownValue(key) {
  if (key.length < 3 || key.length > 60 || /^[\d\s.,/-]+$/.test(key)) return false;

  return !STOP_WORDS.has(key) && !RESERVED_VALUES.has(key) && !ACTION_BY_VERB.has(key) && !PAGE_BY_WORD.has(key);
}

/** @param {Iterable<string>} phrases */
function wordPhrases(phrases) {
  return [...phrases].filter((phrase) => /^[a-z]/i.test(phrase));
}

/** @param {Iterable<string>} phrases */
function symbolPhrases(phrases) {
  return [...phrases].filter((phrase) => !/^[a-z]/i.test(phrase));
}

const STATIC_PATTERNS = {
  action: sticky(alternation(ACTION_BY_VERB.keys())),
  person: stickyLoose("[\\p{L}\\p{N}._%+'-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+"),
  role: sticky("as\\s+(?:an?\\s+)?(?:administrator|admin|member|editor|viewer)"),
  format: sticky(
    "(?:as|to|in|into)\\s+(?:an?\\s+)?(?:csv|json|excel|xlsx|spreadsheet)(?:\\s+(?:file|workbook|spreadsheet))?",
  ),
  page: sticky(`(?:the\\s+)?(?:${alternation(PAGE_BY_WORD.keys())})(?:\\s+page)?`),
  status: sticky(alternation(STATUS_BY_WORD.keys())),
  quantity: sticky(
    "all(?:\\s+(?:of\\s+)?the)?|every|(?:the\\s+)?(?:latest|newest|most\\s+recent)(?:\\s+\\d{1,4})?|(?:the\\s+)?(?:first|top|last)\\s+\\d{1,4}|(?:just\\s+|only\\s+)?one|a\\s+single",
  ),
  countBeforeSubject: stickyLoose("\\d{1,4}\\s+"),
  stateCondition: stickyLoose(`(?:${alternation(STATE_BY_PHRASE.keys())})${WORD_END}`),
  compareCondition: stickyLoose(
    `(?:(?:is|are|was)\\s+)?(?:(?:${alternation(wordPhrases(COMPARE_BY_PHRASE.keys()))})\\s+|(?:${alternation(symbolPhrases(COMPARE_BY_PHRASE.keys()))})\\s*)(?:${DATE_CORE}|${NUMBER})${WORD_END}`,
  ),
  betweenCondition: stickyLoose(
    `(?:(?:is|are|was)\\s+)?between\\s+(?:${EXPLICIT_DATE}|${MONTH_PERIOD}|${NUMBER})\\s+(?:and|to|-|–)\\s+(?:${EXPLICIT_DATE}|${MONTH_PERIOD}|${NUMBER})${WORD_END}`,
  ),
  textOperator: stickyLoose(
    `(?:${alternation(wordPhrases(TEXT_BY_PHRASE.keys()))})(?:\\s+|(?=["“'‘]))|(?:${alternation(symbolPhrases(TEXT_BY_PHRASE.keys()))})\\s*`,
  ),
  bareValue: stickyLoose(BARE_VALUE),
  negation: stickyLoose("(?:(?:is|are)\\s+)?(?:un|non-?|not\\s+)"),
  negatedLead: stickyLoose(`(?:${NEGATION_LEAD})(?:\\s+|(?=["“'‘]))`),
  date: sticky(`(?:(?:uploaded|added|created|received)\\s+)?(?:(?:${DATE_PREFIX})\\s+)?(?:the\\s+)?(?:${DATE_CORE})`),
  dateRange: sticky(DATE_RANGE),
  quoted: stickyLoose(QUOTED),
  instruction: stickyLoose("(?::|(?:so\\s+that|to|for|with|that|which|by)(?=\\s))\\s*"),
  word: stickyLoose("[\\p{L}\\p{N}_]+(?:['’.\\-/][\\p{L}\\p{N}_]+)*|\\S"),
  whitespace: stickyLoose("\\s+"),
  the: stickyLoose("the\\s+"),
  fromOrBy: stickyLoose("(?:from|by)\\s+"),
  costPhrase: sticky(`(?:the\\s+)?(?:${alternation(COST_PHRASES)})`),
  costCondition: sticky(
    `${COST_LEAD}(?:between\\s+(?:${AMOUNT})\\s+(?:and|to|-|–)\\s+(?:${AMOUNT})` +
      `|(?:(?:${alternation(wordPhrases(COST_COMPARE_BY_PHRASE.keys()))})\\s+|(?:${alternation(symbolPhrases(COST_COMPARE_BY_PHRASE.keys()))})\\s*)(?:${AMOUNT})` +
      `|${MARKED_AMOUNT})`,
  ),
  templateSuffix: sticky("\\s+templates?"),
  workspaceSuffix: sticky("\\s+workspace"),
};

/** @type {WeakMap<PaletteWorkspace[], PhraseIndex>} */
const workspaceIndexCache = new WeakMap();

/** @param {PaletteWorkspace[]|undefined} workspaces */
function workspaceIndex(workspaces) {
  if (!workspaces) return phraseIndex([]);
  const cached = workspaceIndexCache.get(workspaces);

  if (cached) return cached;
  const index = phraseIndex(workspaces.map((workspace) => phraseKey(workspace.name)));

  workspaceIndexCache.set(workspaces, index);

  return index;
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

/**
 * Splits a command into typed phrases. The segments cover the whole input: connecting words,
 * punctuation and whitespace are `plain` segments, so joining every `text` gives back the input.
 * Only the first 1,000 characters are read; anything after them is one `plain` segment.
 *
 * - Only the first verb is an `action`.
 * - After an edit or create action and a template or subject, the rest after "to", "so that", ":",
 *   "for", "with" or "that" is one `instruction` segment.
 * - Template names, field labels and known values come from the catalogue, longest match first, case-insensitive.
 *   A phrase that is both a Template name and a field on a Template already named is read as the field.
 * - Workspace names come from `options.workspaces`. A bare name is only a workspace after "switch";
 *   elsewhere it needs the word "workspace" after it.
 *
 * @param {string} text
 * @param {SearchCatalog|null|undefined} catalog
 * @param {LexOptions} [options]
 * @returns {Segment[]}
 */
export function lexCommand(text, catalog, options = {}) {
  const lexicon = lexiconFor(catalog);
  const source = text.slice(0, SEARCH_LIMITS.interpretationTextCharacters);

  /** @type {LexContext} */
  const context = {
    lexicon,
    workspaces: workspaceIndex(options.workspaces),
    action: null,
    afterField: false,
    afterCost: false,
    listing: null,
    named: new Set(),
  };

  /** @type {Segment[]} */
  const segments = [];
  let wantsInstruction = false;
  let index = 0;

  /** @param {SegmentType} type @param {number} end */
  const push = (type, end) => {
    const last = segments[segments.length - 1];
    const piece = text.slice(index, end);

    if (type === "plain" && last?.type === "plain") {
      last.text += piece;
      last.end = end;
    } else segments.push({ type, text: piece, start: index, end });

    index = end;
  };

  while (index < source.length) {
    const space = matchAt(STATIC_PATTERNS.whitespace, source, index);

    if (space) {
      push("plain", index + space.length);
      continue;
    }

    if (wantsInstruction) {
      wantsInstruction = false;
      const connector = matchAt(STATIC_PATTERNS.instruction, source, index);

      if (connector && source.slice(index + connector.length).trim()) {
        push("plain", index + connector.length);
        push("instruction", source.length);
        break;
      }
    }

    const best = bestMatch(source, index, context);

    if (best) {
      push(best.type, index + best.text.length);
      context.afterField = best.type === "field";
      // "cost over 3 cents and under 5 cents": a second amount is still about the cost.
      context.afterCost =
        best.type === "field" ? isCostPhrase(best.text) : best.type === "condition" && context.afterCost;
      context.listing = LISTED_TYPES.has(best.type) ? "after_item" : null;
      noteNamedTemplate(context, best);

      if (best.type === "action") context.action = ACTION_BY_VERB.get(phraseKey(best.text)) ?? null;

      if (
        (best.type === "template" || best.type === "subject") &&
        (context.action === "edit_template" || context.action === "create_template")
      )
        wantsInstruction = true;

      continue;
    }

    const word = matchAt(STATIC_PATTERNS.word, source, index) ?? source[index];
    const key = word.toLowerCase();

    // "is X1, X2 or X3", "is 5 or 10": a bare word after "or" or a comma is another value in the list.
    if (context.listing === "after_joiner" && /^[\p{L}\p{N}]/u.test(word) && !STOP_WORDS.has(key)) {
      push("value", index + word.length);
      context.listing = "after_item";
      continue;
    }

    context.listing = context.listing && (key === "or" || word === ",") ? "after_joiner" : null;

    if (significantWords(word).length) {
      context.afterField = false;
      context.afterCost = false;
    }

    push("plain", index + word.length);
  }

  if (index < text.length) push("plain", text.length);

  return segments;
}

/**
 * @param {LexContext} context
 * @param {{ type: SegmentType, text: string }} segment
 */
function noteNamedTemplate(context, segment) {
  const key = phraseKey(segment.text);

  if (segment.type === "subject") {
    const template = context.lexicon.subjects.get(key)?.template;

    if (template) context.named.add(template.id);
  }

  if (segment.type === "template") {
    const template = context.lexicon.templateNames.get(templateNameKey(key));

    if (template) context.named.add(template.id);
  }
}

/** @param {string} key a phrase key such as "the invoice template" */
function templateNameKey(key) {
  return key.replace(/^the /, "").replace(/ templates?$/, "");
}

/**
 * @typedef {{
 *   lexicon: Lexicon,
 *   workspaces: PhraseIndex,
 *   action: CommandAction|null,
 *   afterField: boolean,
 *   afterCost: boolean,
 *   listing: "after_item"|"after_joiner"|null,
 *   named: Set<string>,
 * }} LexContext
 * @typedef {{ type: SegmentType, test: (text: string, index: number, context: LexContext) => string|null }} LexRule
 */

/**
 * @param {string} text
 * @param {number} start
 * @param {{ end: number } | null} match
 */
function sliceMatch(text, start, match) {
  return match ? text.slice(start, match.end) : null;
}

/** Phrases that can start a list of values continued by "or" or a comma. */
const LISTED_TYPES = new Set(["condition", "value", "date"]);

/** @type {LexRule[]} */
const CONDITION_RULES = [
  // After a cost phrase, amounts may be written "3 cents" or "$0.03".
  {
    type: "condition",
    test: (text, index, { afterCost }) => (afterCost ? matchAt(STATIC_PATTERNS.costCondition, text, index) : null),
  },
  { type: "condition", test: (text, index) => matchAt(STATIC_PATTERNS.stateCondition, text, index) },
  {
    type: "condition",
    test: (text, index, { lexicon }) => {
      const prefix = matchAt(STATIC_PATTERNS.negation, text, index);

      if (!prefix) return null;

      return sliceMatch(text, index, lookupPhrase(lexicon.index.booleanLabels, text, index + prefix.length));
    },
  },
  { type: "condition", test: (text, index) => matchAt(STATIC_PATTERNS.betweenCondition, text, index) },
  { type: "condition", test: (text, index) => matchAt(STATIC_PATTERNS.compareCondition, text, index) },
];

/** @type {LexRule} */
const DATE_RULE = {
  type: "date",
  test: (text, index) => {
    const range = matchAt(STATIC_PATTERNS.dateRange, text, index);
    const match = matchAt(STATIC_PATTERNS.date, text, index);

    if (range && (!match || range.length > match.length)) return range;

    // "May" alone is too common a word; it needs a prefix ("in May") or a year.
    if (match && /^may$/i.test(match.trim())) return null;

    return match;
  },
};

/** @type {LexRule[]} */
const LATER_RULES = [
  {
    type: "quantity",
    test: (text, index, { lexicon }) => {
      const fixed = matchAt(STATIC_PATTERNS.quantity, text, index);

      if (fixed) return fixed;
      const count = matchAt(STATIC_PATTERNS.countBeforeSubject, text, index);

      return count && lookupPhrase(lexicon.index.subjects, text, index + count.length) ? count.trimEnd() : null;
    },
  },
  {
    type: "template",
    test: (text, index, { lexicon }) => {
      const name = lookupWithPrefix(lexicon.index.templateNames, text, index, STATIC_PATTERNS.the);
      const suffix = name ? matchAt(STATIC_PATTERNS.templateSuffix, text, name.end) : null;

      return name && suffix ? text.slice(index, name.end + suffix.length) : null;
    },
  },
  {
    type: "subject",
    test: (text, index, { lexicon }) => sliceMatch(text, index, lookupPhrase(lexicon.index.subjects, text, index)),
  },
  { type: "status", test: (text, index) => matchAt(STATIC_PATTERNS.status, text, index) },
  // "cost over $0.03": a cost phrase followed by an amount. Before the page rule, which also reads "cost".
  {
    type: "field",
    test: (text, index) => {
      const phrase = matchAt(STATIC_PATTERNS.costPhrase, text, index);
      const gap = phrase ? matchAt(STATIC_PATTERNS.whitespace, text, index + phrase.length) : null;

      if (!phrase || !gap) return null;

      return matchAt(STATIC_PATTERNS.costCondition, text, index + phrase.length + gap.length) ? phrase : null;
    },
  },
  {
    type: "field",
    test: (text, index, { lexicon }) =>
      sliceMatch(text, index, lookupWithPrefix(lexicon.index.fields, text, index, STATIC_PATTERNS.the)),
  },
  {
    type: "condition",
    test: (text, index, { lexicon, afterField }) => {
      const lead = matchAt(STATIC_PATTERNS.negatedLead, text, index);

      if (!lead) return null;
      const start = index + lead.length;
      const quoted = matchAt(STATIC_PATTERNS.quoted, text, start);

      if (quoted) return text.slice(index, start + quoted.length);
      const known = lookupPhrase(lexicon.index.values, text, start);

      if (known) return text.slice(index, known.end);

      // Straight after a field any word is its value, except after "without", which usually names a field.
      if (!afterField || /^without/i.test(lead)) return null;

      if (lookupPhrase(lexicon.index.fields, text, start) || lookupPhrase(lexicon.index.subjects, text, start))
        return null;
      const value = matchAt(STATIC_PATTERNS.bareValue, text, start);

      return value && isValueWord(value, text, start + value.length) ? text.slice(index, start + value.length) : null;
    },
  },
  {
    type: "condition",
    test: (text, index, { lexicon }) => {
      const operator = matchAt(STATIC_PATTERNS.textOperator, text, index);

      if (!operator) return null;
      const start = index + operator.length;
      const quoted = matchAt(STATIC_PATTERNS.quoted, text, start);

      if (quoted) return text.slice(index, start + quoted.length);
      const known = lookupPhrase(lexicon.index.values, text, start);
      const value = known ? text.slice(start, known.end) : matchAt(STATIC_PATTERNS.bareValue, text, start);

      return value && isValueWord(value, text, start + value.length) ? text.slice(index, start + value.length) : null;
    },
  },
  {
    type: "value",
    test: (text, index, { lexicon }) =>
      sliceMatch(text, index, lookupWithPrefix(lexicon.index.values, text, index, STATIC_PATTERNS.fromOrBy)),
  },
  { type: "value", test: (text, index) => matchAt(STATIC_PATTERNS.quoted, text, index) },
  { type: "page", test: (text, index) => matchAt(STATIC_PATTERNS.page, text, index) },
  {
    type: "workspace",
    test: (text, index, { workspaces, action }) => {
      const name = lookupWithPrefix(workspaces, text, index, STATIC_PATTERNS.the);

      if (!name) return null;
      const suffix = matchAt(STATIC_PATTERNS.workspaceSuffix, text, name.end);

      if (suffix) return text.slice(index, name.end + suffix.length);

      return action === "switch_workspace" ? text.slice(index, name.end) : null;
    },
  },
];

/**
 * Whether a bare word after an operator is its value. Reserved words aren't, except "a" or "an" that ends
 * the condition: in "starts with A" it is the letter, while in "is a supplier" it begins a longer phrase.
 * @param {string} value
 * @param {string} text
 * @param {number} end where the value ends in `text`
 */
function isValueWord(value, text, end) {
  const key = phraseKey(value);

  if (!RESERVED_VALUES.has(key)) return true;

  if (key !== "a" && key !== "an") return false;

  if (/^\s*(?:$|[,;.?!])/u.test(text.slice(end))) return true;
  const next = end + (matchAt(STATIC_PATTERNS.whitespace, text, end)?.length ?? 0);

  return (
    /^(?:and|or)\b/i.test(text.slice(next)) ||
    Boolean(matchAt(STATIC_PATTERNS.date, text, next) || matchAt(STATIC_PATTERNS.status, text, next))
  );
}

/** @type {LexRule[]} */
const LEADING_RULES = [
  { type: "action", test: (text, index, { action }) => (action ? null : matchAt(STATIC_PATTERNS.action, text, index)) },
  { type: "person", test: (text, index) => matchAt(STATIC_PATTERNS.person, text, index) },
  { type: "role", test: (text, index) => matchAt(STATIC_PATTERNS.role, text, index) },
  { type: "format", test: (text, index) => matchAt(STATIC_PATTERNS.format, text, index) },
];

const RULES_AFTER_FIELD = [...LEADING_RULES, ...CONDITION_RULES, DATE_RULE, ...LATER_RULES];

const RULES_ELSEWHERE = [...LEADING_RULES, DATE_RULE, ...CONDITION_RULES, ...LATER_RULES];

/**
 * The longest match wins; on a tie the earlier rule wins. Straight after a field, conditions beat dates.
 * A phrase that is both a Template name and a field on a Template already named is the field.
 * @param {string} text
 * @param {number} index
 * @param {LexContext} context
 */
function bestMatch(text, index, context) {
  /** @type {{ type: SegmentType, text: string } | null} */
  let best = null;
  /** @type {string|null} */
  let field = null;

  for (const rule of context.afterField ? RULES_AFTER_FIELD : RULES_ELSEWHERE) {
    const match = rule.test(text, index, context);

    if (!match) continue;

    if (rule.type === "field") field = match;

    if (!best || match.length > best.text.length) best = { type: rule.type, text: match };
  }

  if (best?.type === "subject" && field?.length === best.text.length) {
    const candidates = context.lexicon.fields.get(phraseKey(field).replace(/^the /, "")) ?? [];

    if (candidates.some((candidate) => context.named.has(candidate.template.id))) return { type: "field", text: field };
  }

  return best;
}

// ---------------------------------------------------------------------------
// Condition parsing
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   op: SearchOperator,
 *   values: string[],
 *   word: string,
 *   negatedLabel?: string,
 *   kind: "state"|"text"|"compare"|"between"|"boolean",
 * }} ParsedCondition
 */

/** @param {string} text */
function splitTextCondition(text) {
  const key = text.replace(/\s+/g, " ");
  let best = null;

  for (const phrase of TEXT_BY_PHRASE.keys()) {
    if (!key.toLowerCase().startsWith(phrase)) continue;
    const rest = key.slice(phrase.length);

    if (/^[a-z]/i.test(phrase) && rest && !/^[\s"“'‘]/u.test(rest)) continue;

    if (!best || phrase.length > best.phrase.length) best = { phrase, value: rest.trim() };
  }

  return best && best.value ? best : null;
}

/**
 * @param {string} text
 * @param {Lexicon} lexicon
 * @returns {ParsedCondition | null}
 */
function parseCondition(text, lexicon) {
  const key = phraseKey(text);
  const state = STATE_BY_PHRASE.get(key);

  if (state) return { op: state, values: [], word: key, kind: "state" };
  const excluded = NEGATED_PATTERN.exec(text.trim());

  if (excluded) return { op: "is_not", values: [stripQuotes(excluded[2])], word: phraseKey(excluded[1]), kind: "text" };

  const negation = /^(?:(?:is|are) )?(?:un|non-?|not )(.+)$/.exec(key);

  if (negation && lexicon.booleanLabels.has(negation[1]))
    return { op: "is_false", values: [], word: key, negatedLabel: negation[1], kind: "boolean" };

  const between = /^(?:(?:is|are|was) )?between (.+?) (?:and|to|-|–) (.+)$/.exec(key);

  if (between) return { op: "between", values: [between[1], between[2]], word: "between", kind: "between" };

  let compare = null;

  for (const [phrase, pattern] of COMPARE_PREFIXES) {
    const prefixed = pattern.exec(key);

    if (prefixed && (!compare || phrase.length > compare.word.length) && isComparableValue(prefixed[1]))
      compare = { word: phrase, value: prefixed[1] };
  }

  const textual = splitTextCondition(text.trim());

  if (compare && (!textual || compare.word !== "is" || !isQuoted(textual.value))) {
    const op = COMPARE_BY_PHRASE.get(compare.word);

    if (op) return { op, values: [compare.value], word: compare.word, kind: "compare" };
  }

  if (textual) {
    const op = TEXT_BY_PHRASE.get(textual.phrase.toLowerCase());

    if (op) return { op, values: [stripQuotes(textual.value)], word: textual.phrase.toLowerCase(), kind: "text" };
  }

  return null;
}

const COMPARE_PREFIXES = [...COMPARE_BY_PHRASE.keys()].map((phrase) => [
  phrase,
  new RegExp(`^(?:(?:is|are|was) )?${escapeRegExp(phrase)}\\s*(.+)$`),
]);

const WHOLE_DATE = new RegExp(`^(?:${DATE_CORE})$`, "iu");

/** @param {string} value */
function isComparableValue(value) {
  return parseNumber(value) !== null || WHOLE_DATE.test(value.trim());
}

/** @param {string} value */
function parseNumber(value) {
  const cleaned = value
    .trim()
    .replace(/^[£$€]\s?/, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "");

  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);

  return Number.isFinite(number) ? number : null;
}

/**
 * Whether a phrase names a document's processing cost, such as "cost", "the total cost" or "spent".
 * @param {string} text
 */
export function isCostPhrase(text) {
  return COST_PHRASE_KEYS.has(phraseKey(text).replace(/^the /, ""));
}

const AMOUNT_PARTS = /^(?:us ?)?(\$)? ?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+) ?(cents?|¢|c|usd|dollars?)?$/;

/**
 * An amount in USD: "$0.03", "0.03" and "3 cents" are all 0.03.
 * @param {string} text
 * @param {"cents"|"dollars"|null} [unitIfMissing] a range's unit, written once at its end ("1 to 5 cents")
 * @returns {{ value: number, unit: "cents"|"dollars"|null, marked: boolean } | null}
 */
function parseAmount(text, unitIfMissing = null) {
  const match = AMOUNT_PARTS.exec(phraseKey(text));

  if (!match) return null;
  const [, dollarSign, digits, word] = match;
  const written = word ? (/^(?:cents?|¢|c)$/.test(word) ? "cents" : "dollars") : null;

  if (dollarSign && written === "cents") return null;
  const unit = written ?? (dollarSign ? "dollars" : unitIfMissing);
  // Shifting the decimal point in the text keeps "3 cents" exactly 0.03.
  const value = Number(`${digits.replace(/,/g, "")}${unit === "cents" ? "e-2" : ""}`);

  return Number.isFinite(value) ? { value, unit, marked: Boolean(dollarSign || written) } : null;
}

/**
 * A comparison with an amount, as written after a cost phrase: "over 3 cents", "between $0.01 and $0.05",
 * "of $1", ">= 0.5". A bare amount needs a currency ("costing $0.05") to count as "equals".
 * @param {string} text
 * @returns {CostCondition | null}
 */
export function parseCostCondition(text) {
  const key = phraseKey(text).replace(/^(?:is|are|was|were|of) /, "");
  const between = /^between (.+?) (?:and|to|-|–) (.+)$/.exec(key);

  if (between) {
    const second = parseAmount(between[2]);
    const first = second && parseAmount(between[1], second.unit);

    return first && second && second.value >= first.value
      ? { op: "between", value: first.value, value2: second.value }
      : null;
  }

  let best = null;

  for (const [phrase, op] of COST_COMPARE_BY_PHRASE) {
    if (!key.startsWith(phrase)) continue;
    const rest = key.slice(phrase.length);

    if (/^[a-z]/.test(phrase) && !/^ /.test(rest)) continue;

    if (!best || phrase.length > best.phrase.length) best = { phrase, op, rest: rest.trim() };
  }

  const amount = parseAmount(best ? best.rest : key);

  if (!amount || (!best && !amount.marked)) return null;

  return { op: best?.op ?? "eq", value: amount.value };
}

// ---------------------------------------------------------------------------
// Local interpretation
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   lexicon: Lexicon,
 *   today: string,
 *   segments: Segment[],
 *   resolved: Array<string|null>,
 *   unused: string[],
 *   notes: InterpretationNote[],
 *   incomplete: boolean,
 *   hints: string[],
 *   terms: Term[],
 *   joined: Set<number>,
 *   statuses: SearchJobStatus[],
 *   text: string[],
 *   uploaded: DateRange,
 *   guarded: Set<number>,
 *   scoped: boolean,
 * }} InterpretState
 *
 * A field or cost condition the request names, with the segments it was read from. `exclusive` marks an
 * exact value ("vendor is Acme", "from Acme"): one field can't hold two of them, so "and" between two
 * means either.
 * @typedef {{ condition: FieldCondition|CostTerm, start: number, end: number, exclusive: boolean }} Term
 */

/**
 * Turns lexed segments into a `CommandInterpretation` without the model. The result always passes
 * `validateCommandInterpretation` for the same catalogue.
 *
 * `complete` is true when every phrase was used, nothing was ambiguous and nothing was cut to fit the limits;
 * otherwise the palette asks the model.
 * `resolved` is aligned with `segments`: a short label of what each phrase matched, or null.
 * `unused` lists words, and phrases that couldn't be applied, exactly as written.
 *
 * @param {Segment[]} segments
 * @param {SearchCatalog|null|undefined} catalog
 * @param {InterpretOptions} [options]
 * @returns {LocalInterpretation}
 */
export function interpretLocally(segments, catalog, options = {}) {
  const lexicon = lexiconFor(catalog);
  // Upload dates are UTC days, so callers pass today's UTC date.
  const today = options.today ?? utcToday();
  const first = interpretWith(segments, lexicon, today, options, new Set());

  // An "or" that joins no two conditions ("failed or from Acme") can't be expressed. Read again with
  // the phrases beside it left out, so the model reads them instead of the parser applying them with AND.
  return first.loose.length ? interpretWith(segments, lexicon, today, options, new Set(first.loose)).result : first.result;
}

/**
 * @param {Segment[]} segments
 * @param {Lexicon} lexicon
 * @param {string} today
 * @param {InterpretOptions} options
 * @param {Set<number>} guardedOrs "or" segments whose neighbouring phrases are left out
 * @returns {{ result: LocalInterpretation, loose: number[] }} `loose` lists "or" segments that joined nothing
 */
function interpretWith(segments, lexicon, today, options, guardedOrs) {
  const { guarded, disjunctions } = findGuards(segments, lexicon, guardedOrs);

  /** @type {InterpretState} */
  const state = {
    lexicon,
    today,
    segments,
    resolved: segments.map(() => null),
    unused: [],
    notes: [],
    incomplete: false,
    hints: [],
    terms: [],
    joined: new Set(),
    statuses: [],
    text: [],
    uploaded: { from: null, to: null },
    guarded,
    scoped: templatesScopeConditions(segments, lexicon),
  };

  const subjects = readSubjects(state);

  state.hints = subjects.templateIds;
  const action = chooseAction(segments, subjects);
  /** @type {CommandArgs} */
  const args = {};
  const filterAction = FILTER_ACTIONS.has(action);

  /** @type {Set<number>} segment indexes the action consumed */
  const consumed = new Set();

  if (filterAction) readFilterSegments(state, consumed);

  const grouped = filterAction ? groupTerms(state) : [];

  readArgs(state, action, subjects, args, consumed, options.workspaces);

  for (const [index, segment] of segments.entries()) {
    if (consumed.has(index)) continue;

    // "or" joins statuses or Templates into one list, or conditions into a group; anywhere else the
    // filter can't express it.
    const disjunction =
      disjunctions.has(index) && !state.joined.has(index) && (disjunctions.get(index) === null || !filterAction);

    if (segment.type === "plain") state.unused.push(...significantWords(segment.text, disjunction));
    else if (guarded.has(index) || !["action", "subject", "template", "page"].includes(segment.type)) {
      state.unused.push(segment.text.trim());
      state.resolved[index] = null;
    }
  }

  const filter = filterAction ? buildFilter(state, action, subjects, grouped) : null;

  if (state.unused.length) state.notes.push(notUsedNote(state.unused));

  /** @type {CommandInterpretation} */
  const interpretation = {
    action,
    args,
    filter,
    unrecognised: state.unused.slice(0, SEARCH_LIMITS.unrecognised).map((word) => truncate(word, 100)),
    notes: state.notes.slice(0, SEARCH_LIMITS.notes),
  };

  const loose = filterAction
    ? [...disjunctions].flatMap(([index, kind]) => (kind === null && !state.joined.has(index) && !guardedOrs.has(index) ? [index] : []))
    : [];

  return {
    result: {
      interpretation,
      complete: !state.incomplete && state.unused.length === 0,
      resolved: state.resolved,
      unused: state.unused,
    },
    loose,
  };
}

/**
 * The note listing words a reading left unused.
 * @param {string[]} words
 * @returns {InterpretationNote}
 */
function notUsedNote(words) {
  return { kind: "unrecognised", text: truncate(`${NOT_USED}${words.map((word) => `“${word}”`).join(", ")}.`, 300) };
}

const NOT_USED = "Not used: ";

/**
 * Phrases the parser must not apply because a word it can't read changes their meaning: a negating
 * word ("except failed", "not from last week", "Acme excluded"), or an "or" in `guardedOrs`, one the
 * filter can't express. A guard covers the run of filter phrases on that side of the word, up to an
 * unread word or another kind of phrase, so a field goes with its value. Template names in the run are
 * guarded after a negating word and passed over after "or". "or" between two statuses or two Templates
 * is a list the filter holds, and "or" between conditions is a group, so neither is guarded.
 * @param {Segment[]} segments
 * @param {Lexicon} lexicon
 * @param {Set<number>} guardedOrs
 * @returns {{ guarded: Set<number>, disjunctions: Map<number, "status"|"template"|null> }}
 */
function findGuards(segments, lexicon, guardedOrs) {
  /** @type {Set<number>} */
  const guarded = new Set();
  /** @type {Map<number, "status"|"template"|null>} */
  const disjunctions = new Map();

  /** @param {Segment|undefined} segment */
  const namesTemplate = (segment) =>
    segment?.type === "template" ||
    (segment?.type === "subject" && Boolean(lexicon.subjects.get(phraseKey(segment.text))?.template));

  /**
   * @param {number} start
   * @param {1|-1} step
   * @param {boolean} templates
   */
  const guardRun = (start, step, templates) => {
    for (let index = start; index >= 0 && index < segments.length; index += step) {
      const segment = segments[index];

      if (segment.type === "plain") {
        if (significantWords(segment.text).length) return;
        continue;
      }

      if (PREDICATE_TYPES.has(segment.type) || (templates && namesTemplate(segment))) guarded.add(index);
      else if (segment.type !== "subject" && segment.type !== "template") return;
    }
  };

  for (const [index, segment] of segments.entries()) {
    if (segment.type !== "plain") continue;
    const words = segment.text.toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];

    if (words.includes("or")) {
      const before = segments[index - 1];
      const after = segments[index + 1];
      const statuses = before?.type === "status" && after?.type === "status";
      const kind = statuses ? "status" : namesTemplate(before) && namesTemplate(after) ? "template" : null;

      disjunctions.set(index, kind);

      if (!kind && guardedOrs.has(index)) {
        guardRun(index - 1, -1, false);
        guardRun(index + 1, 1, false);
      }
    }

    if (words.some((word) => NEGATING_WORDS.has(word))) guardRun(index + 1, 1, true);

    if (words.some((word) => NEGATING_AFTER_WORDS.has(word))) guardRun(index - 1, -1, true);
  }

  return { guarded, disjunctions };
}

/**
 * @typedef {{
 *   templateIds: string[],
 *   kind: "documents"|"templates"|null,
 *   singular: boolean,
 *   templateSegment: boolean,
 * }} Subjects
 */

/**
 * @param {InterpretState} state
 * @returns {Subjects}
 */
function readSubjects(state) {
  /** @type {Subjects} */
  const subjects = { templateIds: [], kind: null, singular: false, templateSegment: false };

  for (const [index, segment] of state.segments.entries()) {
    if (segment.type === "subject") {
      const entry = state.lexicon.subjects.get(phraseKey(segment.text));

      if (!entry) continue;
      subjects.kind ??= entry.kind;
      subjects.singular ||= !entry.plural;

      if (entry.template && !state.guarded.has(index)) {
        if (!subjects.templateIds.includes(entry.template.id)) subjects.templateIds.push(entry.template.id);
        state.resolved[index] = entry.template.name;
        noteTemplateOrField(state, entry.template, phraseKey(segment.text));
      }
    }

    if (segment.type === "template") {
      const name = phraseKey(segment.text)
        .replace(/^the /, "")
        .replace(/ templates?$/, "");

      const template = state.lexicon.templateNames.get(name);

      subjects.templateSegment = true;
      subjects.kind ??= "templates";

      if (template && !state.guarded.has(index)) {
        if (!subjects.templateIds.includes(template.id)) subjects.templateIds.push(template.id);
        state.resolved[index] = `v${template.current_version}`;
      }
    }
  }

  return subjects;
}

/**
 * A Template name that is also a field label could mean either; the lexer only reads it as the field
 * when a Template with that field was named earlier.
 * @param {InterpretState} state
 * @param {SearchCatalogTemplate} template
 * @param {string} key
 */
function noteTemplateOrField(state, template, key) {
  const fields = (state.lexicon.fields.get(key) ?? []).filter((candidate) => candidate.template.id !== template.id);

  if (!fields.length) return;
  const places = [...new Set(fields.map((candidate) => candidate.template.name))].join(" and ");

  state.incomplete = true;
  state.notes.push({
    kind: "ambiguous_field",
    text: truncate(`“${template.name}” is a template and a field on ${places}. Using the template.`, 300),
    alternatives: fields.slice(0, 5).map((candidate) => ({
      template_id: candidate.template.id,
      field_id: candidate.field.field_id,
    })),
  });
}

/**
 * @param {Segment[]} segments
 * @param {Subjects} subjects
 * @returns {CommandAction}
 */
function chooseAction(segments, subjects) {
  const verb = segments.find((segment) => segment.type === "action");
  const has = (type) => segments.some((segment) => segment.type === type);
  let action = verb ? (ACTION_BY_VERB.get(phraseKey(verb.text)) ?? "find_documents") : null;

  if (!action) {
    if (has("person")) action = "invite";
    else if (has("workspace")) action = "switch_workspace";
    else if (has("page") && !has("subject") && !has("template")) action = "go_to";
    else action = "find_documents";
  }

  if (action === "go_to" && has("workspace")) return "switch_workspace";

  if (action === "find_documents") {
    const subjectIsTemplates = subjects.kind === "templates" || subjects.templateSegment;

    if (subjectIsTemplates) return "find_templates";

    if (has("page") && !has("subject")) return "go_to";
  }

  return action;
}

/**
 * Reads statuses, dates, quantities and field conditions for document actions.
 * @param {InterpretState} state
 * @param {Set<number>} consumed
 */
function readFilterSegments(state, consumed) {
  /** @type {{ index: number, entry: FieldEntry, used: boolean } | null} */
  let pendingField = null;
  /** @type {{ index: number, op: SearchOperator } | null} */
  let pendingState = null;
  /** @type {Set<number>} amounts a cost phrase already took, used or not */
  const costAmounts = new Set();

  const settleField = () => {
    if (pendingField && !pendingField.used) {
      const { entry, index } = pendingField;
      const op = entry.field.type === "boolean" ? "is_true" : "has_value";

      addTerm(state, { template_id: entry.template.id, field_id: entry.field.field_id, op }, index);

      if (entry.field.type === "boolean") state.resolved[index] = `${entry.field.name}: yes`;
    }

    pendingField = null;
  };

  for (const [index, segment] of state.segments.entries()) {
    if (costAmounts.has(index)) continue;

    if (state.guarded.has(index)) {
      settleField();
      continue;
    }

    if (!pendingField && readFollowing(state, index)) {
      consumed.add(index);
      continue;
    }

    switch (segment.type) {
      case "field": {
        settleField();
        const amountIndex = readCost(state, index, consumed);

        if (amountIndex !== null) {
          costAmounts.add(amountIndex);
          break;
        }

        const entry = resolveField(state, segment.text, index);

        if (!entry) break;
        consumed.add(index);
        pendingField = { index, entry, used: false };

        if (pendingState) {
          addCondition(state, entry, { op: pendingState.op, values: [], word: "", kind: "state" }, pendingState.index, index);
          consumed.add(pendingState.index);
          pendingField.used = true;
          pendingState = null;
        }

        break;
      }

      case "condition": {
        const parsed = parseCondition(segment.text, state.lexicon);

        if (!parsed) break;

        if (parsed.negatedLabel) {
          settleField();
          const entry = resolveField(state, parsed.negatedLabel, index);

          if (entry) {
            addTerm(state, { template_id: entry.template.id, field_id: entry.field.field_id, op: "is_false" }, index);
            state.resolved[index] = `${entry.field.name}: no`;
            consumed.add(index);
          }

          break;
        }

        if (pendingField) {
          if (addCondition(state, pendingField.entry, parsed, index, pendingField.index)) {
            consumed.add(index);
            pendingField.used = true;
          }

          pendingField = null;
          break;
        }

        if (parsed.kind === "state") pendingState = { index, op: parsed.op };
        else if (parsed.kind === "text" && parsed.op === "is_not") {
          // "excluding Acme" or "isn't Acme" without a field: a known value names its field.
          if (applyKnownValue(state, parsed.values[0], index, "is_not")) consumed.add(index);
        } else if (applyLooseCondition(state, parsed, index)) consumed.add(index);

        break;
      }

      case "value": {
        // A value names its own field unless it directly follows a field that can hold it.
        // "from Acme" or "by Acme" always names the field it belongs to.
        const prefixed = /^(?:from|by)\s/i.test(segment.text);

        const holder =
          pendingField && !prefixed && (pendingField.entry.field.type === "text" || isQuoted(segment.text));

        if (!holder) settleField();
        const target = holder ? pendingField : null;

        if (applyValue(state, segment.text, index, target)) {
          consumed.add(index);

          if (target) target.used = true;
        }

        pendingField = null;
        break;
      }

      case "date": {
        // "uploaded last week" is about the upload date even straight after a date field.
        const upload = /^(?:uploaded|added|created|received)\s/i.test(segment.text);
        const dateField = !upload && pendingField?.entry.field.type === "date" ? pendingField : null;

        if (!dateField) settleField();
        const range = parseDatePhrase(segment.text, state.today, !dateField);

        if (range) state.resolved[index] = formatRange(range, state.today);

        if (range && dateField) {
          addTerm(state, rangeCondition(dateField.entry, range), dateField.index, index);
          dateField.used = true;
          consumed.add(index);
        } else if (range && mergeUploaded(state, range)) consumed.add(index);

        pendingField = null;
        break;
      }

      case "status": {
        settleField();
        const status = STATUS_BY_WORD.get(phraseKey(segment.text));

        if (status && !state.statuses.includes(status)) state.statuses.push(status);

        if (status) consumed.add(index);

        break;
      }

      case "quantity":
        settleField();
        break;
      case "plain":
        break;
      default:
        settleField();
    }
  }

  settleField();
}

/**
 * Reads a cost phrase and the amount after it ("cost over $0.03") as the processing cost. Returns the
 * amount's segment index once both are handled, or null to read the phrase as a field label instead:
 * when no amount follows, or a Template named in the request has a field with that label.
 * Without access to costs a catalogue field of that name is still used; otherwise both stay unused.
 * @param {InterpretState} state
 * @param {number} index
 * @param {Set<number>} consumed
 * @returns {number|null}
 */
function readCost(state, index, consumed) {
  const segment = state.segments[index];

  if (!isCostPhrase(segment.text)) return null;
  const amountIndex = state.segments.findIndex((candidate, position) => position > index && candidate.text.trim());
  const amount = state.segments[amountIndex];
  const cost = amount?.type === "condition" ? parseCostCondition(amount.text) : null;

  if (!cost) return null;
  const fields = state.lexicon.fields.get(phraseKey(segment.text).replace(/^the /, "")) ?? [];

  if (fields.some((entry) => state.hints.includes(entry.template.id))) return null;

  if (!state.lexicon.costAvailable) {
    if (fields.length) return null;

    if (!state.notes.some((note) => note.text === COST_UNAVAILABLE))
      state.notes.push({ kind: "unrecognised", text: COST_UNAVAILABLE });

    return amountIndex;
  }

  addTerm(state, { cost }, index, amountIndex);
  state.resolved[index] = PROCESSING_COST_LABEL;
  consumed.add(index);
  consumed.add(amountIndex);

  return amountIndex;
}

/**
 * Records a field or cost condition read from segments `start` to `end`.
 * @param {InterpretState} state
 * @param {FieldCondition|CostTerm} condition
 * @param {number} start
 * @param {number} [end]
 * @param {boolean} [exclusive] defaults to whether the condition is an exact value
 */
function addTerm(state, condition, start, end = start, exclusive) {
  const exact = "op" in condition && (condition.op === "is" || condition.op === "eq");

  state.terms.push({ condition, start, end, exclusive: exclusive ?? exact });
}

/**
 * Reads a phrase that continues the condition just before it, joined only by "and", "or" or a comma:
 * "cost over $0.03 and under $0.05", "total under 10 or over 100", "vendor is Acme or Globex",
 * "invoice number is X1, X2 or X3", "issued before 1 March or after 1 June". The phrase is on the same
 * field, and a bare value takes the same operator. Returns whether the segment was used.
 * @param {InterpretState} state
 * @param {number} index
 */
function readFollowing(state, index) {
  const segment = state.segments[index];
  const last = state.terms.at(-1);

  if (!last || !["condition", "value", "date"].includes(segment.type) || !joinsTerms(state, last.end, index)) return false;

  if (isCostTermCondition(last.condition)) {
    const cost = segment.type === "condition" ? parseCostCondition(segment.text) : null;

    if (!cost) return false;
    addTerm(state, { cost }, index);

    return true;
  }

  const entry = fieldEntry(state.lexicon, last.condition);

  if (!entry) return false;

  if (segment.type === "date") {
    // "uploaded last week" is about the upload date, never the field.
    if (entry.field.type !== "date" || /^(?:uploaded|added|created|received)\s/i.test(segment.text)) return false;
    const range = parseDatePhrase(segment.text, state.today, false);

    if (!range) return false;
    state.resolved[index] = formatRange(range, state.today);
    addTerm(state, rangeCondition(entry, range), index);

    return true;
  }

  if (segment.type === "value") {
    const value = (isQuoted(segment.text) ? stripQuotes(segment.text) : segment.text.replace(/^(?:from|by)\s+/i, "")).trim();
    const { op } = last.condition;
    const takesValue = last.condition.value !== undefined && op !== "between";
    const kind = entry.field.type === "text" ? "text" : "compare";

    if (!value || value.length > SEARCH_LIMITS.valueCharacters) return false;
    const parsed = { op: takesValue ? op : entry.field.type === "text" ? "is" : "eq", values: [value], word: "", kind };

    return addCondition(state, entry, parsed, index, index, last.exclusive);
  }

  const parsed = parseCondition(segment.text, state.lexicon);

  if (!parsed || parsed.negatedLabel) return false;

  return addCondition(state, entry, parsed, index);
}

/**
 * Whether only "and", "or", commas and filler words come between two segments.
 * @param {InterpretState} state
 * @param {number} after
 * @param {number} before
 */
function joinsTerms(state, after, before) {
  for (let index = after + 1; index < before; index += 1) {
    const segment = state.segments[index];

    if (segment.type !== "plain" || significantWords(segment.text, true).some((word) => word.toLowerCase() !== "or"))
      return false;
  }

  return true;
}

/**
 * @param {FieldCondition|CostTerm} condition
 * @returns {condition is CostTerm}
 */
function isCostTermCondition(condition) {
  return "cost" in condition;
}

/**
 * @param {Lexicon} lexicon
 * @param {FieldCondition} condition
 * @returns {FieldEntry|null}
 */
function fieldEntry(lexicon, condition) {
  const template = lexicon.templates.find((candidate) => candidate.id === condition.template_id);
  const field = template?.fields.find((candidate) => candidate.field_id === condition.field_id);

  return template && field ? { template, field } : null;
}

/**
 * Picks the field for a label. A Template named in the sentence wins. When several named Templates, or no
 * named Template but several others, have the label, the first is used and the choice is reported.
 * @param {InterpretState} state
 * @param {string} label
 * @param {number} index
 * @returns {FieldEntry | null}
 */
function resolveField(state, label, index) {
  const key = phraseKey(label).replace(/^the /, "");
  const candidates = state.lexicon.fields.get(key) ?? [];

  if (!candidates.length) return null;

  // "invoices with total over 100 or receipts with total over 50": each field is on the Template before it.
  if (state.scoped) {
    const scope = scopeTemplate(state, index);
    const scoped = candidates.find((candidate) => candidate.template.id === scope);

    if (scoped) {
      state.resolved[index] = scoped.template.name;

      return scoped;
    }
  }

  const named = candidates.filter((candidate) => state.hints.includes(candidate.template.id));
  const pool = named.length ? named : candidates;
  const chosen = pool[0];
  const others = pool.slice(1);

  state.resolved[index] = chosen.template.name;

  if (!named.length && state.hints.length) {
    const names = state.hints.map((id) => templateName(state.lexicon, id)).join(" or ");

    state.incomplete = true;
    state.notes.push({
      kind: "unrecognised",
      text: truncate(`“${chosen.field.name}” isn't on ${names}. Using ${chosen.template.name}.`, 300),
    });
  } else if (others.length) {
    const names = [...new Set(pool.map((candidate) => candidate.template.name))].join(" and ");

    state.incomplete = true;
    state.notes.push({
      kind: "ambiguous_field",
      text: truncate(`“${chosen.field.name}” is on ${names}. Using ${chosen.template.name}.`, 300),
      alternatives: others.slice(0, 5).map((candidate) => ({
        template_id: candidate.template.id,
        field_id: candidate.field.field_id,
      })),
    });
  }

  return chosen;
}

/**
 * @param {Lexicon} lexicon
 * @param {string} id
 */
function templateName(lexicon, id) {
  return lexicon.templates.find((template) => template.id === id)?.name ?? id;
}

/**
 * Applies a parsed condition to a field, converting it to the operator the field's type takes.
 * @param {InterpretState} state
 * @param {FieldEntry} entry
 * @param {ParsedCondition} parsed
 * @param {number} index the condition's segment
 * @param {number} [end] the last segment the condition was read from, when it isn't `index`
 * @param {boolean} [exclusive]
 */
function addCondition(state, entry, parsed, index, end = index, exclusive) {
  const condition = fitCondition(entry, parsed, state.today);

  if (!condition) return false;
  addTerm(state, condition, Math.min(index, end), Math.max(index, end), exclusive);

  if (state.resolved[index] === null && entry.field.type === "boolean")
    state.resolved[index] = `${entry.field.name}: ${condition.op === "is_true" ? "yes" : "no"}`;

  return true;
}

const YES_WORDS = new Set(["yes", "true", "y"]);

const NO_WORDS = new Set(["no", "false", "n"]);

/**
 * @param {FieldEntry} entry
 * @param {ParsedCondition} parsed
 * @param {string} today
 * @returns {FieldCondition | null}
 */
function fitCondition(entry, parsed, today) {
  const type = entry.field.type;
  const base = { template_id: entry.template.id, field_id: entry.field.field_id };
  let { op } = parsed;
  const [first, second] = parsed.values;

  if (!type) return null;

  if (op === "has_value" || op === "not_found" || op === "invalid" || op === "empty") return { ...base, op };

  if (type === "boolean") {
    const word = first === undefined ? "" : phraseKey(first);

    if (op === "is_true" || op === "is_false") return { ...base, op };

    if ((op === "is" || op === "eq") && YES_WORDS.has(word)) return { ...base, op: "is_true" };

    if ((op === "is" || op === "eq") && NO_WORDS.has(word)) return { ...base, op: "is_false" };

    if (op === "is_not" && YES_WORDS.has(word)) return { ...base, op: "is_false" };

    if (op === "is_not" && NO_WORDS.has(word)) return { ...base, op: "is_true" };

    return null;
  }

  if (op === "is_true" || op === "is_false") {
    if (type !== "text") return null;

    return { ...base, op: "is", value: parsed.word.replace(/^(?:is|=)\s*/, "") };
  }

  if (type === "text") {
    if (op === "eq") op = "is";

    if (!operatorsFor("text").includes(op) || first === undefined) return null;
    const value = (parsed.kind === "compare" ? first : stripQuotes(first)).trim();

    return value && value.length <= SEARCH_LIMITS.valueCharacters ? { ...base, op, value } : null;
  }

  if (op === "is") op = "eq";

  if (!["eq", "gt", "gte", "lt", "lte", "between"].includes(op) || first === undefined) return null;

  if (type === "number") {
    const value = parseNumber(stripQuotes(first));
    const value2 = second === undefined ? null : parseNumber(second);

    if (value === null) return null;

    if (op !== "between") return { ...base, op, value };

    return value2 !== null && value2 >= value ? { ...base, op, value, value2 } : null;
  }

  if (op === "between") {
    const span = second === undefined ? null : resolveDateRange(stripQuotes(first), second, today, false);

    return span ? { ...base, op, value: span.from, value2: span.to } : null;
  }

  const range = resolveDateCore(stripQuotes(first), today, false);

  if (!range) return null;

  if (op === "eq")
    return range.from === range.to
      ? { ...base, op, value: range.from }
      : { ...base, op: "between", value: range.from, value2: range.to };

  if (op === "gt" || op === "lte") return { ...base, op, value: range.to };

  return { ...base, op, value: range.from };
}

/**
 * A date phrase next to a date field filters that field instead of the upload date.
 * @param {FieldEntry} entry
 * @param {DateRange} range
 * @returns {FieldCondition}
 */
function rangeCondition(entry, range) {
  const base = { template_id: entry.template.id, field_id: entry.field.field_id };

  if (range.from && range.to)
    return range.from === range.to
      ? { ...base, op: "eq", value: range.from }
      : { ...base, op: "between", value: range.from, value2: range.to };

  return range.from ? { ...base, op: "gte", value: range.from } : { ...base, op: "lte", value: range.to ?? "" };
}

/**
 * Narrows the upload range. Returns false when the ranges don't overlap.
 * @param {InterpretState} state
 * @param {DateRange} range
 */
function mergeUploaded(state, range) {
  const from =
    [state.uploaded.from, range.from]
      .filter((value) => value !== null)
      .sort()
      .pop() ?? null;

  const to =
    [state.uploaded.to, range.to]
      .filter((value) => value !== null)
      .sort()
      .shift() ?? null;

  if (from && to && from > to) return false;
  state.uploaded = { from, to };

  return true;
}

/**
 * A condition without a field: plain text, an upload date range, or the only number field on the subject.
 * @param {InterpretState} state
 * @param {ParsedCondition} parsed
 * @param {number} index
 */
function applyLooseCondition(state, parsed, index) {
  const [first, second] = parsed.values;

  if (parsed.kind === "text" && (parsed.op === "contains" || parsed.op === "is") && first?.trim()) {
    state.text.push(first.trim());
    state.resolved[index] = "Any text";

    return true;
  }

  if (first === undefined) return false;
  const isNumber = parseNumber(first) !== null && (second === undefined || parseNumber(second) !== null);

  if (!isNumber) {
    if (!["between", "eq"].includes(parsed.op)) return false;

    const range =
      second === undefined
        ? resolveDateCore(first, state.today, true)
        : resolveDateRange(first, second, state.today, true);

    if (!range || !mergeUploaded(state, range)) return false;
    state.resolved[index] = formatRange(range, state.today);

    return true;
  }

  if (state.hints.length !== 1) return false;
  const template = state.lexicon.templates.find((candidate) => candidate.id === state.hints[0]);
  const numbers = template?.fields.filter((field) => field.type === "number") ?? [];

  if (!template || numbers.length !== 1) return false;
  const entry = { template, field: numbers[0] };

  if (!addCondition(state, entry, parsed, index)) return false;
  state.resolved[index] = entry.field.name;

  return true;
}

/**
 * A known value ("Acme", "from Northwind") or a quoted phrase.
 * @param {InterpretState} state
 * @param {string} text
 * @param {number} index
 * @param {{ index: number, entry: FieldEntry } | null} pendingField
 */
function applyValue(state, text, index, pendingField) {
  const quoted = isQuoted(text);
  const raw = quoted ? stripQuotes(text) : text.trim().replace(/^(?:from|by)\s+/i, "");
  const value = raw.trim();

  if (!value || value.length > SEARCH_LIMITS.valueCharacters) return false;

  if (pendingField) {
    const kind = pendingField.entry.field.type === "text" ? "text" : "compare";
    const op = pendingField.entry.field.type === "text" ? "contains" : "eq";

    return addCondition(state, pendingField.entry, { op, values: [value], word: "", kind }, index, pendingField.index);
  }

  if (quoted) {
    state.text.push(value);
    state.resolved[index] = "Any text";

    return true;
  }

  return applyKnownValue(state, value, index, "contains");
}

/**
 * A known value without a field takes the field it is known in: "Acme" is Vendor contains “Acme”,
 * "excluding Acme" is Vendor is not “Acme”.
 * @param {InterpretState} state
 * @param {string} value
 * @param {number} index
 * @param {"contains"|"is_not"} op
 */
function applyKnownValue(state, value, index, op) {
  const candidates = state.lexicon.values.get(phraseKey(value)) ?? [];

  // With Templates named, only their fields count; a value from another Template would match nothing.
  // Where Templates are named between conditions, the value is on the Template named before it.
  const scope = state.scoped ? scopeTemplate(state, index) : null;
  const scoped = candidates.filter((candidate) => candidate.template.id === scope);

  const pool = scoped.length
    ? scoped
    : state.hints.length
      ? candidates.filter((candidate) => state.hints.includes(candidate.template.id))
      : candidates;

  const chosen = pool[0];

  if (!chosen) return false;
  // A known value is a whole value, so two of them on one field are alternatives.
  addTerm(state, { template_id: chosen.template.id, field_id: chosen.field.field_id, op, value: chosen.value }, index, index, op !== "is_not");
  state.resolved[index] = chosen.field.name;

  // A condition limits the search to its Template, so "documents excluding Acme" would quietly leave out
  // every other Template's documents.
  if (op === "is_not" && !state.hints.length) {
    state.incomplete = true;
    state.notes.push({
      kind: "unrecognised",
      text: truncate(`Only ${chosen.template.name} documents can leave out “${chosen.value}”, so others aren't included.`, 300),
    });
  }

  /** @type {Array<{ template_id: string, field_id: string }>} */
  const alternatives = [];

  for (const candidate of pool) {
    const seen = alternatives.some(
      (item) => item.template_id === candidate.template.id && item.field_id === candidate.field.field_id,
    );

    if (candidate !== chosen && !seen && (candidate.template !== chosen.template || candidate.field !== chosen.field))
      alternatives.push({ template_id: candidate.template.id, field_id: candidate.field.field_id });
  }

  if (alternatives.length) {
    const place = (entry) => `${entry.template.name} › ${entry.field.name}`;

    const others = alternatives.map((item) => {
      const match = pool.find(
        (candidate) => candidate.template.id === item.template_id && candidate.field.field_id === item.field_id,
      );

      return match ? place(match) : item.field_id;
    });

    state.incomplete = true;
    state.notes.push({
      kind: "ambiguous_field",
      text: truncate(
        `“${chosen.value}” appears in ${[place(chosen), ...others].join(" and ")}. Using ${place(chosen)}.`,
        300,
      ),
      alternatives: alternatives.slice(0, 5),
    });
  }

  return true;
}

/**
 * The Template a subject or Template phrase names, if any.
 * @param {Segment} segment
 * @param {Lexicon} lexicon
 * @returns {string|null}
 */
function segmentTemplate(segment, lexicon) {
  const key = phraseKey(segment.text);

  if (segment.type === "subject") return lexicon.subjects.get(key)?.template?.id ?? null;

  if (segment.type === "template") return lexicon.templateNames.get(templateNameKey(key))?.id ?? null;

  return null;
}

/**
 * The Template named last before a segment, which its field belongs to when `state.scoped`.
 * @param {InterpretState} state
 * @param {number} index
 */
function scopeTemplate(state, index) {
  return (
    state.segments
      .slice(0, index)
      .map((segment) => segmentTemplate(segment, state.lexicon))
      .findLast(Boolean) ?? null
  );
}

/**
 * Whether Templates are named between conditions, as in "invoices with total over 100 or receipts with
 * total over 50", so each field belongs to the Template named before it.
 * @param {Segment[]} segments
 * @param {Lexicon} lexicon
 */
function templatesScopeConditions(segments, lexicon) {
  const firstCondition = segments.findIndex((segment) => ["field", "condition", "value"].includes(segment.type));

  return (
    firstCondition >= 0 &&
    segments.some((segment, index) => index > firstCondition && segmentTemplate(segment, lexicon) !== null)
  );
}

/**
 * Joins the request's conditions the way it reads, and marks the "or" words that joined them.
 *
 * Conditions on one field come together first: "vendor is Acme or Globex and total over 100" is
 * (Acme or Globex) and total over 100. Then "and" binds tighter than "or", as in "vendor is Acme or
 * total over 500 and paid": Acme, or (over 500 and paid). In "A, B or C" the commas take the word that
 * ends the list. Exact values of one field joined by "and" are alternatives, since a field can't hold
 * both, and excluded values joined by "or" all stay excluded: "excluding Acme or Globex" leaves out both.
 * @param {InterpretState} state
 * @returns {SearchCondition[]} the filter's conditions, all of which must hold
 */
function groupTerms(state) {
  const terms = [...state.terms].sort((a, b) => a.start - b.start).slice(0, SEARCH_LIMITS.conditions);

  if (!terms.length) return [];
  const links = terms.slice(1).map((term, position) => readLink(state, terms[position], term));

  for (const link of links) for (const index of link.ors) state.joined.add(index);

  // "A, B or C": each comma takes the word after the last item.
  const kinds = links.map((link, position) => {
    if (link.kind !== "list") return link.kind;

    return links.slice(position).find((next) => next.kind !== "list")?.kind === "or" ? "or" : "and";
  });

  /** @type {SearchCondition[]} */
  const runs = [];
  /** @type {Array<"and"|"or">} */
  const between = [];
  let start = 0;

  for (let end = 1; end <= terms.length; end += 1) {
    if (end < terms.length && termSubject(terms[end]) === termSubject(terms[start])) continue;
    const run = terms.slice(start, end);
    let inner = kinds.slice(start, end - 1);

    if (run.every((term) => "op" in term.condition && term.condition.op === "is_not")) inner = inner.map(() => "and");
    else if (run.length > 1 && run.every((term) => term.exclusive) && inner.every((kind) => kind === "and"))
      inner = inner.map(() => "or");

    runs.push(combineByPrecedence(run.map((term) => term.condition), inner));

    if (end < terms.length) between.push(kinds[end - 1]);
    start = end;
  }

  const root = combineByPrecedence(runs, between);

  return "all" in root ? root.all : [root];
}

/**
 * How two conditions are joined: by "or", by a comma, or otherwise by "and". Only words, punctuation and
 * the Template the next condition is on may come between them; any other phrase means "and", and an
 * "or" there joins nothing.
 * @param {InterpretState} state
 * @param {Term} previous
 * @param {Term} next
 * @returns {{ kind: "and"|"or"|"list", ors: number[] }}
 */
function readLink(state, previous, next) {
  /** @type {number[]} */
  const ors = [];
  let comma = false;

  for (let index = previous.end + 1; index < next.start; index += 1) {
    const segment = state.segments[index];

    if (segmentTemplate(segment, state.lexicon)) continue;

    if (segment.type !== "plain") return { kind: "and", ors: [] };

    if (significantWords(segment.text, true).some((word) => word.toLowerCase() === "or")) ors.push(index);

    comma ||= segment.text.includes(",");
  }

  return { kind: ors.length ? "or" : comma ? "list" : "and", ors };
}

/** @param {Term} term */
function termSubject(term) {
  const { condition } = term;

  return isCostTermCondition(condition) ? "cost" : `${condition.template_id}\u0000${condition.field_id}`;
}

/**
 * Combines conditions joined by "and" and "or", "and" first: [a, b, c] with ["and", "or"] is (a and b) or c.
 * Groups of the same kind are merged, so the result is never `{ all: [{ all: ... }] }`.
 * @param {SearchCondition[]} items
 * @param {Array<"and"|"or">} kinds `kinds[i]` joins `items[i]` and `items[i + 1]`
 * @returns {SearchCondition}
 */
function combineByPrecedence(items, kinds) {
  /** @type {SearchCondition[][]} */
  const groups = [[items[0]]];

  for (const [position, item] of items.slice(1).entries()) {
    if (kinds[position] === "or") groups.push([item]);
    else groups[groups.length - 1].push(item);
  }

  const alternatives = groups.map((group) =>
    group.length === 1 ? group[0] : { all: group.flatMap((item) => ("all" in item ? item.all : [item])) },
  );

  return alternatives.length === 1
    ? alternatives[0]
    : { any: alternatives.flatMap((item) => ("any" in item ? item.any : [item])) };
}

/**
 * The Templates a document must have to match, or null when any Template can. `conflict` lists the
 * Templates of an "all" group whose members need different Templates, which nothing can match.
 * @param {SearchCondition} condition
 * @returns {{ templates: string[]|null, conflict: string[]|null }}
 */
function conditionTemplates(condition) {
  if (isCostTerm(condition)) return { templates: null, conflict: null };

  if (!isConditionGroup(condition)) return { templates: [condition.template_id], conflict: null };
  const { any, members } = groupMembers(condition);
  const read = members.map(conditionTemplates);

  // An alternative that can't match is harmless while another can; the group only conflicts when none can.
  if (any) {
    const possible = read.filter((member) => !member.conflict);

    if (!possible.length) return { templates: [], conflict: read[0].conflict };

    return possible.some((member) => member.templates === null)
      ? { templates: null, conflict: null }
      : { templates: [...new Set(possible.flatMap((member) => member.templates ?? []))], conflict: null };
  }

  const conflict = read.find((member) => member.conflict)?.conflict ?? null;
  const known = read.flatMap((member) => (member.templates ? [member.templates] : []));

  if (!known.length) return { templates: null, conflict };
  const shared = known.reduce((common, templates) => common.filter((id) => templates.includes(id)));

  return { templates: shared, conflict: conflict ?? (shared.length ? null : [...new Set(known.flat())]) };
}

/**
 * How deeply groups nest in a list of conditions.
 * @param {SearchCondition[]} conditions
 * @returns {number}
 */
function conditionDepth(conditions) {
  return Math.max(
    0,
    ...conditions.map((condition) =>
      isConditionGroup(condition) ? 1 + conditionDepth(groupMembers(condition).members) : 0,
    ),
  );
}

/**
 * @param {InterpretState} state
 * @param {CommandAction} action
 * @param {Subjects} subjects
 * @param {SearchCondition[]} conditions from `groupTerms`
 * @returns {DocumentSearchFilter}
 */
function buildFilter(state, action, subjects, conditions) {
  /** @type {DocumentSearchFilter} */
  const filter = {};

  /** @param {string} text */
  const cut = (text) => {
    state.incomplete = true;
    state.notes.push({ kind: "unrecognised", text: truncate(text, 300) });
  };

  if (state.terms.length > SEARCH_LIMITS.conditions) cut(`Only the first ${SEARCH_LIMITS.conditions} conditions are used.`);

  // A document has one Template, so conditions on different Templates can only be alternatives.
  const { templates: pinned, conflict } = conditionTemplates({ all: conditions });

  if (conflict) {
    const names = conflict.map((id) => templateName(state.lexicon, id)).join(" and ");

    cut(`These conditions use fields from ${names}, so no document can match.`);
  } else if (pinned) {
    const left = subjects.templateIds.filter((id) => !pinned.includes(id)).map((id) => templateName(state.lexicon, id));
    const names = pinned.map((id) => templateName(state.lexicon, id)).join(" and ");

    if (left.length) cut(`The conditions only apply to ${names}, so ${left.join(" and ")} is left out.`);
  }

  if (state.text.length) {
    const text = state.text.join(" ").trim();

    filter.text = clip(text, SEARCH_LIMITS.textCharacters);

    if (text.length > SEARCH_LIMITS.textCharacters)
      cut(`Search text is limited to ${SEARCH_LIMITS.textCharacters} characters.`);
  }

  const statuses = state.statuses.length ? state.statuses : action === "retry" ? ["failed"] : [];

  if (statuses.length) filter.statuses = statuses.slice(0, SEARCH_LIMITS.statuses);

  if (!pinned && subjects.templateIds.length) {
    filter.template_ids = subjects.templateIds.slice(0, SEARCH_LIMITS.templates);

    if (subjects.templateIds.length > SEARCH_LIMITS.templates)
      cut(`Only the first ${SEARCH_LIMITS.templates} templates are used.`);
  }

  if (state.uploaded.from) filter.uploaded_from = state.uploaded.from;

  if (state.uploaded.to) filter.uploaded_to = state.uploaded.to;

  if (conditions.length) {
    if (conditionDepth(conditions) > SEARCH_LIMITS.conditionDepth)
      cut("These conditions mix “and” and “or” too deeply to search for.");
    else filter.conditions = conditions;
  }

  // With nothing else to go on, plain words become a text search so the palette still shows results.
  if (!Object.keys(filter).length && state.unused.length)
    filter.text = clip(state.unused.join(" "), SEARCH_LIMITS.textCharacters);

  return filter;
}

/**
 * Fills the action's arguments and marks the segments it used.
 * @param {InterpretState} state
 * @param {CommandAction} action
 * @param {Subjects} subjects
 * @param {CommandArgs} args
 * @param {Set<number>} consumed
 * @param {PaletteWorkspace[]|undefined} workspaces
 */
function readArgs(state, action, subjects, args, consumed, workspaces) {
  const { segments } = state;
  const singleTemplate = subjects.templateIds[0];

  for (const [index, segment] of segments.entries()) {
    const key = phraseKey(segment.text);

    if (segment.type === "action") consumed.add(index);

    if ((segment.type === "subject" || segment.type === "template") && !state.guarded.has(index)) consumed.add(index);

    if (segment.type === "quantity") {
      const limit = quantityLimit(key, subjects);

      // "all" and "every" mean no limit. Other quantities only count when the action takes a limit.
      if (limit === null && /^(?:all|every)\b/.test(key)) consumed.add(index);
      else if (limit !== null && FILTER_ACTIONS.has(action)) {
        args.limit = limit;
        state.resolved[index] = `Newest ${limit}`;
        consumed.add(index);
      }
    }

    if (segment.type === "person" && action === "invite" && segment.text.trim().length <= 254) {
      args.email = segment.text.trim();
      consumed.add(index);
    }

    if (segment.type === "role" && action === "invite") {
      args.role = /admin/.test(key) ? "admin" : "member";
      state.resolved[index] = args.role === "admin" ? "Admin" : "Member";
      consumed.add(index);
    }

    if (segment.type === "format" && action === "export") {
      args.format = /json/.test(key) ? "json" : /csv/.test(key) ? "csv" : "xlsx";
      state.resolved[index] = { json: "JSON", csv: "CSV", xlsx: "Excel" }[args.format];
      consumed.add(index);
    }

    if (segment.type === "page") {
      const page = PAGE_BY_WORD.get(key.replace(/^the /, "").replace(/ page$/, ""));

      if (page) state.resolved[index] = PAGE_LABELS[page];

      if (page && action === "go_to") args.page = page;

      consumed.add(index);
    }

    if (segment.type === "workspace" && action === "switch_workspace") {
      const name = key.replace(/^the /, "").replace(/ workspace$/, "");
      const workspace = (workspaces ?? []).find((candidate) => phraseKey(candidate.name) === name);

      args.workspace = clip(workspace?.name ?? segment.text, 200);
      state.resolved[index] = args.workspace;
      consumed.add(index);
    }

    if (segment.type === "instruction" && (action === "edit_template" || action === "create_template")) {
      const instruction = clip(segment.text, SEARCH_LIMITS.instructionCharacters);

      if (instruction) args.instruction = instruction;

      consumed.add(index);
    }
  }

  if (singleTemplate && ["edit_template", "upload", "run_evaluation", "go_to", "find_templates"].includes(action))
    args.template_id = singleTemplate;

  if (action === "go_to" && !args.page && subjects.kind)
    args.page = subjects.kind === "templates" || subjects.templateSegment ? "templates" : "documents";

  if (action === "switch_workspace" && !args.workspace) {
    const words = significantWords(plainText(segments)).filter((word) => !/^workspaces?$/i.test(word));

    if (words.length) {
      args.workspace = clip(words.join(" "), 200);
      markPlainConsumed(segments, consumed);
    }
  }

  if (action === "create_template" && !args.instruction) {
    const verbIndex = segments.findIndex((segment) => segment.type === "action");
    const after = verbIndex >= 0 ? segments.slice(verbIndex + 1) : segments;
    const words = significantWords(plainText(after));

    if (words.length) {
      const description = after
        .map((segment) => segment.text)
        .join("")
        .trim()
        .replace(/^(?:an?|the|new)\s+/i, "");

      args.instruction = clip(description, SEARCH_LIMITS.instructionCharacters);
      markPlainConsumed(segments, consumed);
    }
  }
}

/**
 * The number of documents a quantity asks for, or null when it sets no limit. "The latest" means one
 * only for a singular subject ("the latest invoice").
 * @param {string} key
 * @param {Subjects} subjects
 */
function quantityLimit(key, subjects) {
  const count = /\d+/.exec(key);

  if (count) return Math.min(Math.max(Number(count[0]), 1), SEARCH_LIMITS.idsPageSize);

  if (/\bone$|single$/.test(key)) return 1;

  if (/latest|newest|most recent/.test(key) && (subjects.singular || !subjects.kind)) return 1;

  return null;
}

/** @param {Segment[]} segments */
function plainText(segments) {
  return segments.flatMap((segment) => (segment.type === "plain" ? [segment.text] : [])).join(" ");
}

/**
 * @param {Segment[]} segments
 * @param {Set<number>} consumed
 */
function markPlainConsumed(segments, consumed) {
  for (const [index, segment] of segments.entries()) if (segment.type === "plain") consumed.add(index);
}

// ---------------------------------------------------------------------------
// Combining the local reading with the model's
// ---------------------------------------------------------------------------

/**
 * The model only fills the gaps. Whatever the local parser recognised (the action verb, upload
 * dates, statuses, Templates, field and cost conditions and arguments) stays exactly as the pills show it,
 * so the same request can't change meaning between runs. The model adds what the parser couldn't
 * read: leftover words, plain search text and conditions on other fields. When words were left
 * unread, the model's conditions on a field replace the parser's on that field, since an unread word
 * may change a condition the parser did read. The parser itself leaves out phrases next to a
 * negating word or an "or" it can't group, so those never reach this merge.
 * @param {CommandInterpretation} local
 * @param {CommandInterpretation} model
 * @param {Segment[]} segments
 * @returns {CommandInterpretation}
 */
export function mergeInterpretations(local, model, segments) {
  const action = segments.some((segment) => segment.type === "action") ? local.action : model.action;
  const args = { ...model.args, ...local.args };
  const notes = [];
  // The parser's list of unused words is from before the model read them; the model's list replaces it.
  const localNotes = local.notes.filter((note) => !(note.kind === "unrecognised" && note.text.startsWith(NOT_USED)));
  const unusedNotes = model.unrecognised.length ? [notUsedNote(model.unrecognised)] : [];

  for (const note of [...unusedNotes, ...localNotes, ...model.notes])
    if (notes.length < SEARCH_LIMITS.notes && !notes.some((kept) => kept.text === note.text)) notes.push(note);

  const merged = { action, args, filter: null, unrecognised: model.unrecognised, notes };

  if (!FILTER_ACTIONS.has(action) && action !== "find_templates") {
    merged.filter = model.filter ?? local.filter;

    return merged;
  }

  const mine = local.filter ?? {};
  const theirs = model.filter ?? {};
  /** @type {DocumentSearchFilter} */
  const filter = {};
  // Local text built from unused words is a stand-in; the model's reading of those words replaces it.
  const text = theirs.text ?? (local.unrecognised.length ? undefined : mine.text);

  if (text) filter.text = text;
  const statuses = mine.statuses?.length ? mine.statuses : theirs.statuses;

  if (statuses?.length) filter.statuses = statuses;
  const templateIds = mine.template_ids?.length ? mine.template_ids : theirs.template_ids;

  if (templateIds?.length) filter.template_ids = templateIds;
  const dates = mine.uploaded_from || mine.uploaded_to ? mine : theirs;

  if (dates.uploaded_from) filter.uploaded_from = dates.uploaded_from;

  if (dates.uploaded_to) filter.uploaded_to = dates.uploaded_to;
  const modelName = mine.model ?? theirs.model;

  if (modelName) filter.model = modelName;

  // Local conditions stay and model conditions are added for other fields, on the same Templates. Each
  // member of the conditions list, a group included, is kept or added whole, keyed by the fields it uses.
  // When the parser left words unread, any of them could change a condition it did read ("bar Acme"),
  // so the model's conditions replace the parser's on each field the model also filtered. A locally
  // recognised cost always stays as its pills show it: a member holding one is only replaced when the
  // model's conditions keep that same cost, so a correction can never drop it and widen the search.
  const replace = local.unrecognised.length > 0;
  const localConditions = mine.conditions ?? [];

  const pinned = new Set([
    ...(templateIds ?? []),
    ...conditionLeaves(localConditions).flatMap((leaf) => (isCostTerm(leaf) ? [] : [leaf.template_id])),
  ]);

  // Model conditions on other Templates are never used, so they can't replace anything either.
  const offered = (theirs.conditions ?? []).filter(
    (condition) =>
      !pinned.size || conditionLeaves([condition]).every((leaf) => isCostTerm(leaf) || pinned.has(leaf.template_id)),
  );

  const offeredKeys = new Set(offered.flatMap(conditionKeys));

  // A parser condition is replaced when the model read one of its fields again and kept all of its costs.
  let replaced = new Set(
    localConditions.filter(
      (condition) =>
        replace &&
        conditionKeys(condition).some((key) => key !== "cost" && offeredKeys.has(key)) &&
        costsKept(condition, offered),
    ),
  );

  /**
   * The kept parser conditions and the model's additions, for a set of replaced parser conditions.
   * @param {Set<SearchCondition>} without
   */
  const combine = (without) => {
    const kept = localConditions.filter((condition) => !without.has(condition));
    const localKeys = new Set(kept.flatMap(conditionKeys));
    /** @type {SearchCondition[]} */
    const added = [];

    for (const condition of offered) {
      if (conditionKeys(condition).some((key) => localKeys.has(key))) continue;

      if (conditionLeaves([...kept, ...added, condition]).length <= SEARCH_LIMITS.conditions) added.push(condition);
    }

    return { kept, added };
  };

  // Replacing is only safe once the replacement is actually added: a parser condition whose fields or
  // costs didn't make it into the result is restored, and the model's conditions are chosen again.
  let combined = combine(replaced);

  for (;;) {
    const addedKeys = new Set(combined.added.flatMap(conditionKeys));

    const lost = [...replaced].filter(
      (condition) =>
        !costsKept(condition, combined.added) ||
        !conditionKeys(condition).some((key) => key !== "cost" && offeredKeys.has(key) && addedKeys.has(key)),
    );

    if (!lost.length) break;
    replaced = new Set([...replaced].filter((condition) => !lost.includes(condition)));
    combined = combine(replaced);
  }

  const conditions = [...combined.kept, ...combined.added];

  if (conditions.length) filter.conditions = conditions;
  merged.filter = filter;

  return merged;
}

/**
 * Whether every cost in a condition is also in `others`, exactly.
 * @param {SearchCondition} condition
 * @param {SearchCondition[]} others
 */
function costsKept(condition, others) {
  const costs = conditionLeaves(others).filter(isCostTerm);

  return conditionLeaves([condition])
    .filter(isCostTerm)
    .every((cost) => costs.some((candidate) => sameCost(candidate, cost)));
}

/**
 * @param {CostTerm} a
 * @param {CostTerm} b
 */
function sameCost(a, b) {
  return a.cost.op === b.cost.op && a.cost.value === b.cost.value && a.cost.value2 === b.cost.value2;
}

/**
 * The fields a condition uses, at any depth, as `template\u0000field`, and "cost" for the processing cost.
 * @param {SearchCondition} condition
 * @returns {string[]}
 */
function conditionKeys(condition) {
  return conditionLeaves([condition]).map((leaf) =>
    isCostTerm(leaf) ? "cost" : `${leaf.template_id}\u0000${leaf.field_id}`,
  );
}

// ---------------------------------------------------------------------------
// Questions and descriptions
// ---------------------------------------------------------------------------

const QUESTION_WORDS =
  /^(?:how|what|what's|whats|why|which|who|when|where|can|could|should|does|do|is|are|will|would|explain|tell me)\b/i;

/**
 * Whether the text reads as a question, so the palette offers the Ask row first.
 * @param {string} text
 * @param {Segment[]} segments
 */
export function askLooksLikeQuestion(text, segments) {
  const trimmed = text.trim();

  if (!trimmed) return false;

  if (trimmed.endsWith("?")) return true;
  const first = segments.find((segment) => segment.text.trim());

  return first?.type !== "action" && QUESTION_WORDS.test(trimmed);
}

const OPERATOR_WORDS = {
  text: { contains: "contains", starts_with: "starts with", ends_with: "ends with", is: "is", is_not: "is not" },
  number: { eq: "is", gt: "over", gte: "at least", lt: "under", lte: "at most", between: "between" },
  date: { eq: "is", gt: "after", gte: "on or after", lt: "before", lte: "on or before", between: "between" },
  state: {
    has_value: "has a value",
    not_found: "is missing",
    invalid: "is invalid",
    empty: "is empty",
    is_true: "is yes",
    is_false: "is no",
  },
};

const NUMBER_FORMAT = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 });

const COST_WORDS = { eq: "of", gt: "over", gte: "at least", lt: "under", lte: "at most", between: "between" };

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/**
 * "over $0.03", "between $0.01 and $0.05", written after the word "cost".
 * @param {CostCondition} cost
 */
function describeCost(cost) {
  const word = COST_WORDS[cost.op] ?? cost.op;
  const first = USD_FORMAT.format(cost.value);

  if (cost.op === "between") return `${word} ${first} and ${USD_FORMAT.format(cost.value2 ?? cost.value)}`;

  return `${word} ${first}`;
}

/**
 * A condition or a group: "Invoice › Vendor is “Acme” or Invoice › Vendor is “Globex”". A group inside
 * another is bracketed.
 * @param {SearchCondition} condition
 * @param {SearchCatalog|null|undefined} catalog
 * @param {boolean} nested
 * @returns {string}
 */
function describeSearchCondition(condition, catalog, nested) {
  if (!isConditionGroup(condition)) {
    const { subject, predicate } = describeLeaf(condition, catalog);

    return `${subject} ${predicate}`;
  }

  const { any, members } = groupMembers(condition);
  const joiner = any ? " or " : " and ";
  const leaves = members.flatMap((member) => (isConditionGroup(member) ? [] : [describeLeaf(member, catalog)]));

  // Conditions on one field name it once: "Invoice › Total under 10 or over 100".
  const text =
    leaves.length === members.length && leaves.every((leaf) => leaf.subject === leaves[0].subject)
      ? `${leaves[0].subject} ${leaves.map((leaf) => leaf.predicate).join(joiner)}`
      : members.map((member) => describeSearchCondition(member, catalog, true)).join(joiner);

  return nested && members.length > 1 ? `(${text})` : text;
}

/**
 * @param {FieldCondition|CostTerm} condition
 * @param {SearchCatalog|null|undefined} catalog
 * @returns {{ subject: string, predicate: string }}
 */
function describeLeaf(condition, catalog) {
  return isCostTerm(condition)
    ? { subject: "cost", predicate: describeCost(condition.cost) }
    : describeCondition(condition, catalog);
}

/**
 * @param {string|number|undefined} value
 * @param {string|null} type
 */
function describeValue(value, type) {
  if (value === undefined) return "";

  if (type === "number" && Number.isFinite(Number(value))) return NUMBER_FORMAT.format(Number(value));

  if (type === "date" && isIsoDate(String(value))) return formatDay(String(value), null);

  return `“${value}”`;
}

/**
 * @param {FieldCondition} condition
 * @param {SearchCatalog|null|undefined} catalog
 * @returns {{ subject: string, predicate: string }} "Invoice › Total" and "over 500"
 */
function describeCondition(condition, catalog) {
  const template = catalog?.templates.find((candidate) => candidate.id === condition.template_id);
  const field = template?.fields.find((candidate) => candidate.field_id === condition.field_id);
  const type = field?.type ?? null;
  const place = `${template?.name ?? condition.template_id} › ${field?.name ?? condition.field_id}`;
  const stateWord = OPERATOR_WORDS.state[condition.op];

  if (stateWord) return { subject: place, predicate: stateWord };
  const words = type === "number" || type === "date" ? OPERATOR_WORDS[type] : OPERATOR_WORDS.text;
  const word = words[condition.op] ?? condition.op.replace(/_/g, " ");
  const first = describeValue(condition.value, type);

  if (condition.op === "between")
    return { subject: place, predicate: `${word} ${first} and ${describeValue(condition.value2, type)}` };

  return { subject: place, predicate: `${word} ${first}` };
}

/**
 * A one-line summary of a filter in UK style, e.g.
 * `Invoice › Invoice number starts with “hnh” · failed · uploaded 5 Oct – 11 Oct · text “acme”`.
 * Returns an empty string for a filter that matches every document.
 *
 * @param {DocumentSearchFilter|null|undefined} filter
 * @param {SearchCatalog|null|undefined} catalog
 * @param {{ today?: string }} [options] years are shown only when they differ from today's
 */
export function describeFilter(filter, catalog, options = {}) {
  if (!filter) return "";
  const today = options.today ?? utcToday();
  /** @type {string[]} */
  const parts = [];

  if (filter.template_ids?.length)
    parts.push(filter.template_ids.map((id) => templateName(lexiconFor(catalog), id)).join(" or "));

  for (const condition of filter.conditions ?? []) parts.push(describeSearchCondition(condition, catalog, false));

  if (filter.statuses?.length)
    parts.push(filter.statuses.map((status) => STATUS_LABELS[status] ?? status).join(" or "));

  if (filter.uploaded_from || filter.uploaded_to) {
    const range = { from: filter.uploaded_from ?? null, to: filter.uploaded_to ?? null };
    const label = formatRange(range, today);

    if (range.from && range.to) parts.push(`uploaded ${label}`);
    else parts.push(`uploaded ${label.replace(/^From/, "since").replace(/^Until/, "up to")}`);
  }

  if (filter.model) parts.push(`model “${filter.model}”`);

  if (filter.text) parts.push(`text “${filter.text}”`);

  return parts.join(" · ");
}
