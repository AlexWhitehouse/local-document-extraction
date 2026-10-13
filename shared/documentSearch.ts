import { isJsonArray, isJsonObject, isNumber, isString, type JsonObject, type JsonValue } from "./json";

/**
 * Contract shared by the document search route, the interpretation route and the command palette.
 * Field identity is always explicit: a condition names one Template, one field ID on that Template's
 * current version, and is only matched against results whose stored type is the same.
 */

export const SEARCH_LIMITS = Object.freeze({
  textCharacters: 200,
  valueCharacters: 200,
  /** Field and cost conditions in the whole tree, wherever they sit. */
  conditions: 10,
  /** How deeply `any` and `all` groups may nest. */
  conditionDepth: 3,
  templates: 20,
  statuses: 5,
  pageSize: 100,
  defaultPageSize: 50,
  idsPageSize: 500,
  countCap: 10_000,
  interpretationTextCharacters: 1_000,
  interpretationSegments: 60,
  instructionCharacters: 4_000,
  unrecognised: 20,
  notes: 10,
});

export const SEARCH_JOB_STATUSES = ["queued", "processing", "completed", "failed", "awaiting_template"] as const;

export type SearchJobStatus = (typeof SEARCH_JOB_STATUSES)[number];

/** Scalar search types. Tables, objects and arrays are not indexed in this version. */
export const SEARCH_VALUE_TYPES = ["text", "number", "date", "boolean"] as const;

export type SearchValueType = (typeof SEARCH_VALUE_TYPES)[number];

/** How a stored result is held: a usable value, not found, failed validation, or an empty string. */
export const SEARCH_VALUE_STATES = ["value", "missing", "invalid", "empty"] as const;

export type SearchValueState = (typeof SEARCH_VALUE_STATES)[number];

export function searchValueType(dataType: string): SearchValueType | null {
  if (dataType === "string") return "text";

  if (dataType === "number" || dataType === "date" || dataType === "boolean") return dataType;

  return null;
}

/** Operators that test the stored state rather than the value. Valid for every type. */
export const STATE_OPERATORS = ["has_value", "not_found", "invalid", "empty"] as const;

export const TEXT_OPERATORS = ["contains", "starts_with", "ends_with", "is", "is_not"] as const;

/** Numbers and ISO dates share the comparison operators. */
export const COMPARISON_OPERATORS = ["eq", "gt", "gte", "lt", "lte", "between"] as const;

export const BOOLEAN_OPERATORS = ["is_true", "is_false"] as const;

export type StateOperator = (typeof STATE_OPERATORS)[number];

export type TextOperator = (typeof TEXT_OPERATORS)[number];

export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export type BooleanOperator = (typeof BOOLEAN_OPERATORS)[number];

export type SearchOperator = StateOperator | TextOperator | ComparisonOperator | BooleanOperator;

export function operatorsFor(type: SearchValueType): readonly SearchOperator[] {
  const typed =
    type === "text" ? TEXT_OPERATORS : type === "boolean" ? BOOLEAN_OPERATORS : COMPARISON_OPERATORS;

  return [...typed, ...STATE_OPERATORS];
}

/**
 * `value` is a string for text, a finite number for numbers and `YYYY-MM-DD` for dates.
 * `value2` is only present for `between`, and is never smaller than `value`.
 * State and boolean operators carry no value.
 */
export type FieldCondition = {
  template_id: string;
  field_id: string;
  op: SearchOperator;
  value?: string | number;
  value2?: string | number;
};

/**
 * A document's total reported processing cost in USD: its own model calls plus its page share of
 * its packet's split. Calls without a reported amount count as nothing. `value2` is only for `between`.
 */
export type CostCondition = { op: ComparisonOperator; value: number; value2?: number };

/** A condition on the document's processing cost, as one condition in a filter. */
export type CostTerm = { cost: CostCondition };

/** `any` matches when at least one member does; `all` when every member does. */
export type ConditionGroup = { any: SearchCondition[] } | { all: SearchCondition[] };

/**
 * One member of `DocumentSearchFilter.conditions`: a field condition, a cost condition, or a group of them.
 * "Vendor is Acme or Initech and total over 100" is
 * `[{ any: [vendor is Acme, vendor is Initech] }, total gt 100]`.
 */
export type SearchCondition = FieldCondition | CostTerm | ConditionGroup;

export function isCostTerm(condition: SearchCondition): condition is CostTerm {
  return "cost" in condition;
}

export function isConditionGroup(condition: SearchCondition): condition is ConditionGroup {
  return "any" in condition || "all" in condition;
}

export function isFieldCondition(condition: SearchCondition): condition is FieldCondition {
  return "field_id" in condition;
}

/** The members of a group and whether one of them is enough. */
export function groupMembers(group: ConditionGroup): { any: boolean; members: SearchCondition[] } {
  return "any" in group ? { any: true, members: group.any } : { any: false, members: group.all };
}

/** Every field and cost condition in a list of conditions, in order. */
export function conditionLeaves(conditions: readonly SearchCondition[] | undefined): Array<FieldCondition | CostTerm> {
  return (conditions ?? []).flatMap((condition) =>
    isConditionGroup(condition) ? conditionLeaves(groupMembers(condition).members) : [condition],
  );
}

/** Rebuilds conditions with every field and cost condition replaced by `change`; groups keep their shape. */
export function mapConditionLeaves(
  conditions: readonly SearchCondition[],
  change: (leaf: FieldCondition | CostTerm) => FieldCondition | CostTerm,
): SearchCondition[] {
  return conditions.map((condition) => {
    if (!isConditionGroup(condition)) return change(condition);
    const { any, members } = groupMembers(condition);
    const mapped = mapConditionLeaves(members, change);

    return any ? { any: mapped } : { all: mapped };
  });
}

/** Whether any condition, at any depth, is on the processing cost. */
export function usesCost(filter: DocumentSearchFilter | null | undefined): boolean {
  return conditionLeaves(filter?.conditions).some(isCostTerm);
}

/** Every present member narrows the result. All members combine with AND. */
export type DocumentSearchFilter = {
  /** Plain words: document name, document ID, and extracted text values. */
  text?: string;
  statuses?: SearchJobStatus[];
  template_ids?: string[];
  /** Upload date range in UTC days, inclusive. */
  uploaded_from?: string;
  uploaded_to?: string;
  model?: string;
  /**
   * Every member must hold. Cost conditions are only for callers who may read costs
   * (`SearchCatalog.capabilities.cost`). Requests may also send a `cost` member, a cost condition or a
   * list of them, which is read as cost conditions added to this list.
   */
  conditions?: SearchCondition[];
};

export class SearchContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchContractError";
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in `YYYY-MM-DD` form. */
export function isIsoDate(value: JsonValue | undefined): value is string {
  if (!isString(value)) return false;
  const match = ISO_DATE.exec(value);

  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));

  return date.toISOString().slice(0, 10) === value;
}

/** Normalised results store dates as `DD/MM/YYYY`. Returns null for impossible dates. */
export function dayMonthYearToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());

  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;

  return isIsoDate(iso) ? iso : null;
}

/** Case-folded text used for indexing and matching. Matching is literal: no wildcards. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

const IDENTIFIER_CHARACTERS = 200;

function fail(message: string): never {
  throw new SearchContractError(message);
}

function readObject(value: JsonValue | undefined, label: string, allowed: readonly string[]): JsonObject {
  if (!isJsonObject(value)) fail(`${label} must be an object.`);
  const extra = Object.keys(value).find((key) => !allowed.includes(key));

  if (extra) fail(`${label} has an unknown property "${extra}".`);

  return value;
}

function readIdentifier(value: JsonValue | undefined, label: string): string {
  if (!isString(value) || !value.trim() || value.length > IDENTIFIER_CHARACTERS) fail(`${label} is invalid.`);

  return value;
}

function readStringList<T extends string>(
  value: JsonValue | undefined,
  label: string,
  limit: number,
  accept: (item: string) => item is T,
): T[] {
  if (!isJsonArray(value) || value.length > limit) fail(`${label} must be a list of at most ${limit}.`);
  const items: T[] = [];

  for (const item of value) {
    if (!isString(item) || !accept(item)) fail(`${label} contains an invalid entry.`);

    if (!items.includes(item)) items.push(item);
  }

  return items;
}

export function isSearchJobStatus(value: string): value is SearchJobStatus {
  return SEARCH_JOB_STATUSES.some((status) => status === value);
}

export function isSearchOperator(value: string): value is SearchOperator {
  return [...STATE_OPERATORS, ...TEXT_OPERATORS, ...COMPARISON_OPERATORS, ...BOOLEAN_OPERATORS].some(
    (operator) => operator === value,
  );
}

function isIdentifier(value: string): value is string {
  return Boolean(value.trim()) && value.length <= IDENTIFIER_CHARACTERS;
}

function isStateOperator(op: SearchOperator): op is StateOperator {
  return STATE_OPERATORS.some((operator) => operator === op);
}

function isBooleanOperator(op: SearchOperator): op is BooleanOperator {
  return BOOLEAN_OPERATORS.some((operator) => operator === op);
}

function isTextOperator(op: SearchOperator): op is TextOperator {
  return TEXT_OPERATORS.some((operator) => operator === op);
}

function isComparisonOperator(value: string): value is ComparisonOperator {
  return COMPARISON_OPERATORS.some((operator) => operator === value);
}

function readCostAmount(value: JsonValue | undefined): number {
  if (!isNumber(value) || !Number.isFinite(value) || value < 0) fail("Cost values must be amounts in USD of 0 or more.");

  return value;
}

function readCostCondition(value: JsonValue | undefined): CostCondition {
  const input = readObject(value, "Cost", ["op", "value", "value2"]);
  const op = input.op;

  if (!isString(op) || !isComparisonOperator(op)) fail("Cost has an unknown operator.");
  const condition: CostCondition = { op, value: readCostAmount(input.value) };

  if ((op === "between") !== (input.value2 !== undefined)) fail(`Cost needs a second value only for "between".`);

  if (input.value2 !== undefined) {
    const value2 = readCostAmount(input.value2);

    if (value2 < condition.value) fail("The second value of a range must not be smaller than the first.");
    condition.value2 = value2;
  }

  return condition;
}

/**
 * Reads a list of conditions with its groups. `count` holds the field and cost conditions read so far,
 * across the whole tree, so the limit and the labels ("Condition 3") count every one of them.
 */
function readConditionList(value: JsonValue | undefined, depth: number, count: { leaves: number }): SearchCondition[] {
  if (!isJsonArray(value)) fail("Conditions must be a list.");

  return value.map((member) => {
    const group = isJsonObject(member) && ("any" in member || "all" in member);

    if (!group) {
      count.leaves += 1;

      if (count.leaves > SEARCH_LIMITS.conditions) fail(`Use at most ${SEARCH_LIMITS.conditions} conditions.`);

      return isJsonObject(member) && "cost" in member
        ? { cost: readCostCondition(readObject(member, `Condition ${count.leaves}`, ["cost"]).cost) }
        : readCondition(member, count.leaves - 1);
    }

    if (depth >= SEARCH_LIMITS.conditionDepth)
      fail(`Condition groups can be nested at most ${SEARCH_LIMITS.conditionDepth} deep.`);
    const input = readObject(member, "Condition group", ["any", "all"]);
    const any = input.any !== undefined;

    if (any === (input.all !== undefined)) fail(`A condition group has either "any" or "all".`);
    const members = readConditionList(any ? input.any : input.all, depth + 1, count);

    if (!members.length) fail("A condition group needs at least one condition.");

    return any ? { any: members } : { all: members };
  });
}

/** Checks the shape of a condition. The value's type is checked against the field in `checkCondition`. */
function readCondition(value: JsonValue | undefined, index: number): FieldCondition {
  const label = `Condition ${index + 1}`;
  const input = readObject(value, label, ["template_id", "field_id", "op", "value", "value2"]);
  const op = input.op;

  if (!isString(op) || !isSearchOperator(op)) fail(`${label} has an unknown operator.`);

  const condition: FieldCondition = {
    template_id: readIdentifier(input.template_id, `${label} template`),
    field_id: readIdentifier(input.field_id, `${label} field`),
    op,
  };

  const needsValue = !isStateOperator(op) && !isBooleanOperator(op);

  if (!needsValue) {
    if (input.value !== undefined || input.value2 !== undefined) fail(`${label} takes no value.`);

    return condition;
  }

  for (const key of ["value", "value2"] as const) {
    const member = input[key];

    if (member === undefined) continue;

    if (isString(member)) {
      if (member.length > SEARCH_LIMITS.valueCharacters) fail(`${label} value is too long.`);
      condition[key] = member;
    } else if (isNumber(member) && Number.isFinite(member)) condition[key] = member;
    else fail(`${label} value must be text or a number.`);
  }

  if (condition.value === undefined) fail(`${label} needs a value.`);

  if ((op === "between") !== (condition.value2 !== undefined))
    fail(`${label} needs a second value only for "between".`);

  return condition;
}

export function parseDocumentSearchFilter(value: JsonValue | undefined): DocumentSearchFilter {
  const input = readObject(value, "Filter", [
    "text",
    "statuses",
    "template_ids",
    "uploaded_from",
    "uploaded_to",
    "model",
    "conditions",
    "cost",
  ]);

  const filter: DocumentSearchFilter = {};

  if (input.text !== undefined) {
    if (!isString(input.text) || input.text.length > SEARCH_LIMITS.textCharacters || input.text.includes("\0"))
      fail(`Search text must be at most ${SEARCH_LIMITS.textCharacters} characters.`);
    const text = input.text.trim();

    if (text) filter.text = text;
  }

  if (input.statuses !== undefined)
    filter.statuses = readStringList(input.statuses, "Statuses", SEARCH_LIMITS.statuses, isSearchJobStatus);

  if (input.template_ids !== undefined)
    filter.template_ids = readStringList(input.template_ids, "Templates", SEARCH_LIMITS.templates, isIdentifier);

  for (const key of ["uploaded_from", "uploaded_to"] as const) {
    const member = input[key];

    if (member === undefined) continue;

    if (!isIsoDate(member)) fail("Upload dates must be real dates in YYYY-MM-DD form.");
    filter[key] = member;
  }

  if (filter.uploaded_from && filter.uploaded_to && filter.uploaded_from > filter.uploaded_to)
    fail("The upload start date must not be after the end date.");

  if (input.model !== undefined) {
    if (!isString(input.model) || !input.model.trim() || input.model.length > 255) fail("Model is invalid.");
    filter.model = input.model;
  }

  const count = { leaves: 0 };
  const conditions = input.conditions === undefined ? [] : readConditionList(input.conditions, 0, count);

  // An earlier form: `cost` beside the conditions, one cost condition or a list of them.
  if (input.cost !== undefined) {
    const costs = isJsonArray(input.cost) ? input.cost : [input.cost];

    if (!costs.length) fail("Cost must be a cost condition or a list of them.");
    conditions.push(...readConditionList(costs.map((cost) => ({ cost })), 0, count));
  }

  if (input.conditions !== undefined || conditions.length) filter.conditions = conditions;

  return filter;
}

/** One field of a Template's current version, as offered to the palette and the interpreter. */
export type SearchCatalogField = {
  field_id: string;
  name: string;
  data_type: string;
  /** Null for tables, objects and arrays, which can't be searched in this version. */
  type: SearchValueType | null;
  /** Frequent short text values, for recognising words such as supplier names. Text fields only. */
  known_values?: string[];
};

export type SearchCatalogTemplate = {
  id: string;
  name: string;
  current_version: number;
  fields: SearchCatalogField[];
};

/** What the caller may search by, beyond the Templates and fields. */
export type SearchCapabilities = {
  /** Whether the caller may read processing costs, as on the Costs page: workspace owners and admins. */
  cost: boolean;
};

export type SearchCatalog = {
  templates: SearchCatalogTemplate[];
  models: string[];
  interpretation: { available: true } | { available: false; reason: "model_not_configured" | "model_unavailable" };
  capabilities: SearchCapabilities;
};

/** A catalogue for validation. Without `capabilities`, nothing beyond Templates and fields is available. */
export type ValidationCatalog = Pick<SearchCatalog, "templates"> & { capabilities?: SearchCapabilities };

export function findCatalogField(
  catalog: Pick<SearchCatalog, "templates">,
  templateId: string,
  fieldId: string,
): { template: SearchCatalogTemplate; field: SearchCatalogField } | null {
  const template = catalog.templates.find((candidate) => candidate.id === templateId);
  const field = template?.fields.find((candidate) => candidate.field_id === fieldId);

  return template && field ? { template, field } : null;
}

/**
 * Checks a structurally valid condition against the field it names and returns it with typed values.
 * Text values are kept as written; numbers are numbers; dates are ISO days.
 */
export function checkCondition(condition: FieldCondition, type: SearchValueType | null): FieldCondition {
  if (!type) fail("Tables and nested fields can't be searched yet.");

  if (!operatorsFor(type).includes(condition.op)) fail(`"${condition.op}" doesn't apply to a ${type} field.`);

  if (isStateOperator(condition.op) || isBooleanOperator(condition.op)) return condition;

  if (type === "text") {
    if (!isTextOperator(condition.op)) fail("Text fields take text conditions.");
    const text = String(condition.value).trim();

    if (!text) fail("Text conditions need a value.");

    return { ...condition, value: text };
  }

  const read = (raw: string | number | undefined): string | number => {
    if (type === "number") {
      const number = isNumber(raw) ? raw : Number(String(raw).replace(/[£$€,\s]/g, ""));

      if (!Number.isFinite(number) || String(raw).trim() === "") fail("Number conditions need a number.");

      return number;
    }

    if (!isIsoDate(raw)) fail("Date conditions need a date in YYYY-MM-DD form.");

    return raw;
  };

  const first = read(condition.value);
  const checked: FieldCondition = { ...condition, value: first };

  if (condition.op === "between") {
    const second = read(condition.value2);

    const reversed =
      isNumber(first) && isNumber(second) ? first > second : String(first) > String(second);

    if (reversed) fail("The second value of a range must not be smaller than the first.");
    checked.value2 = second;
  }

  return checked;
}

/** Validates every condition against the catalogue so unrelated fields on other Templates never match. */
export function checkFilterAgainstCatalog(
  filter: DocumentSearchFilter,
  catalog: Pick<SearchCatalog, "templates">,
): DocumentSearchFilter {
  if (!filter.conditions) return filter;

  return {
    ...filter,
    conditions: mapConditionLeaves(filter.conditions, (condition) => {
      if (isCostTerm(condition)) return condition;
      const match = findCatalogField(catalog, condition.template_id, condition.field_id);

      if (!match) fail(`Field "${condition.field_id}" isn't on that template.`);

      return checkCondition(condition, match.field.type);
    }),
  };
}

/** The fixed action list. The interpreter only chooses one of these; it never runs anything itself. */
export const COMMAND_ACTIONS = [
  "find_documents",
  "find_templates",
  "edit_template",
  "create_template",
  "upload",
  "retry",
  "export",
  "delete",
  "invite",
  "switch_workspace",
  "go_to",
  "run_evaluation",
] as const;

export type CommandAction = (typeof COMMAND_ACTIONS)[number];

export const COMMAND_PAGES = ["documents", "templates", "evaluations", "costs", "workspace", "connected_apps"] as const;

export type CommandPage = (typeof COMMAND_PAGES)[number];

export const EXPORT_FORMATS = ["csv", "json", "xlsx"] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const INVITE_ROLES = ["member", "admin"] as const;

export type InviteRole = (typeof INVITE_ROLES)[number];

export type CommandArgs = {
  template_id?: string;
  instruction?: string;
  format?: ExportFormat;
  email?: string;
  role?: InviteRole;
  page?: CommandPage;
  /** A workspace name as written. The client resolves it against the workspaces it can see. */
  workspace?: string;
  /** "the latest 5" limits the result to the newest N documents. */
  limit?: number;
};

export type InterpretationNote =
  | {
      kind: "ambiguous_field";
      text: string;
      /** Conditions that would use another Template's field with the same name. */
      alternatives: Array<{ template_id: string; field_id: string }>;
    }
  | { kind: "matched"; text: string }
  | { kind: "unrecognised"; text: string };

export type CommandInterpretation = {
  action: CommandAction;
  args: CommandArgs;
  filter: DocumentSearchFilter | null;
  /** Words from the request that weren't used, each exactly as written. */
  unrecognised: string[];
  notes: InterpretationNote[];
};

function isOneOf<T extends string>(list: readonly T[]) {
  return (value: string): value is T => list.some((item) => item === value);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readArgs(value: JsonValue | undefined, catalog: Pick<SearchCatalog, "templates">): CommandArgs {
  const input = readObject(value, "Args", [
    "template_id",
    "instruction",
    "format",
    "email",
    "role",
    "page",
    "workspace",
    "limit",
  ]);

  const args: CommandArgs = {};
  const { template_id, instruction, format, email, role, page, workspace, limit } = input;

  if (template_id !== undefined) {
    const id = readIdentifier(template_id, "Template");

    if (!catalog.templates.some((template) => template.id === id)) fail("Template isn't in this workspace.");
    args.template_id = id;
  }

  if (instruction !== undefined) {
    if (!isString(instruction) || !instruction.trim() || instruction.length > SEARCH_LIMITS.instructionCharacters)
      fail("Instruction is invalid.");
    args.instruction = instruction.trim();
  }

  if (format !== undefined) {
    if (!isString(format) || !isOneOf(EXPORT_FORMATS)(format)) fail("Export format is invalid.");
    args.format = format;
  }

  if (email !== undefined) {
    if (!isString(email) || email.length > 254 || !EMAIL.test(email)) fail("Email is invalid.");
    args.email = email;
  }

  if (role !== undefined) {
    if (!isString(role) || !isOneOf(INVITE_ROLES)(role)) fail("Role is invalid.");
    args.role = role;
  }

  if (page !== undefined) {
    if (!isString(page) || !isOneOf(COMMAND_PAGES)(page)) fail("Page is invalid.");
    args.page = page;
  }

  if (workspace !== undefined) {
    if (!isString(workspace) || !workspace.trim() || workspace.length > 200) fail("Workspace is invalid.");
    args.workspace = workspace.trim();
  }

  if (limit !== undefined) {
    if (!isNumber(limit) || !Number.isSafeInteger(limit) || limit < 1 || limit > SEARCH_LIMITS.idsPageSize)
      fail("Limit is invalid.");
    args.limit = limit;
  }

  return args;
}

function readNote(value: JsonValue | undefined, catalog: Pick<SearchCatalog, "templates">): InterpretationNote {
  const kind = isJsonObject(value) ? value.kind : undefined;

  if (kind === "ambiguous_field") {
    const input = readObject(value, "Note", ["kind", "text", "alternatives"]);

    if (!isJsonArray(input.alternatives) || input.alternatives.length > 5) fail("Note alternatives are invalid.");

    return {
      kind,
      text: readNoteText(input.text),
      alternatives: input.alternatives.map((alternative) => {
        const entry = readObject(alternative, "Alternative", ["template_id", "field_id"]);
        const templateId = readIdentifier(entry.template_id, "Alternative template");
        const fieldId = readIdentifier(entry.field_id, "Alternative field");

        if (!findCatalogField(catalog, templateId, fieldId)) fail("Alternative field isn't in this workspace.");

        return { template_id: templateId, field_id: fieldId };
      }),
    };
  }

  if (kind === "matched" || kind === "unrecognised") {
    const input = readObject(value, "Note", ["kind", "text"]);

    return { kind, text: readNoteText(input.text) };
  }

  fail("Note kind is invalid.");
}

function readNoteText(value: JsonValue | undefined): string {
  if (!isString(value) || !value.trim() || value.length > 300) fail("Note text is invalid.");

  return value.trim();
}

/**
 * Validates an interpretation returned by the model, or built locally, against the workspace catalogue.
 * Anything the catalogue doesn't contain is rejected, so the interpreter can't invent fields or Templates.
 */
export function validateCommandInterpretation(
  value: JsonValue | undefined,
  catalog: ValidationCatalog,
): CommandInterpretation {
  const input = readObject(value, "Interpretation", ["action", "args", "filter", "unrecognised", "notes"]);
  const action = input.action;

  if (!isString(action) || !isOneOf(COMMAND_ACTIONS)(action)) fail("Action isn't one of the supported actions.");

  const filter =
    input.filter === null || input.filter === undefined
      ? null
      : checkFilterAgainstCatalog(parseDocumentSearchFilter(input.filter), catalog);

  if (filter?.template_ids?.some((id) => !catalog.templates.some((template) => template.id === id)))
    fail("Filter names a template that isn't in this workspace.");

  if (usesCost(filter) && !catalog.capabilities?.cost) fail("Only workspace owners and admins can search by cost.");

  const unrecognised = input.unrecognised ?? [];

  if (!isJsonArray(unrecognised) || unrecognised.length > SEARCH_LIMITS.unrecognised)
    fail("Unrecognised words must be a short list.");

  const notes = input.notes ?? [];

  if (!isJsonArray(notes) || notes.length > SEARCH_LIMITS.notes) fail("Notes must be a short list.");

  return {
    action,
    args: readArgs(input.args ?? {}, catalog),
    filter,
    unrecognised: unrecognised.map((word) => {
      if (!isString(word) || !word.trim() || word.length > 100) fail("Unrecognised words are invalid.");

      return word.trim();
    }),
    notes: notes.map((note) => readNote(note, catalog)),
  };
}
