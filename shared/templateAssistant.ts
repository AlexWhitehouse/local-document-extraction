import { isString, isNumber, isJsonArray, type JsonValue, type JsonObject } from "./json";
import {
  COLUMN_DATA_TYPES,
  TEMPLATE_DATA_TYPES,
  diagnoseTemplateDraft,
  isRecord,
  isTableType,
  templateColumns,
  templateIdentity,
  templateObjectMetadata,
  normalizeTemplateName,
  type DraftRecord,
  type TemplateDiagnostic,
} from "./templateDiagnostics";

export * from "./templateDiagnostics";

export const ASSISTANT_LIMITS = Object.freeze({
  draftBytes: 65_536,
  instructionCharacters: 4_000,
  evidenceBytes: 131_072,
  responseBytes: 65_536,
  groups: 20,
  operations: 100,
  operationsPerGroup: 25,
  observations: 20,
  referencesPerObservation: 20,
  propertyCharacters: 8_000,
});

export type AssistanceAction = "explain" | "edit";

export type EvidenceContext = {
  sampleSupplied?: boolean;
  resultFields?: JsonValue[];
  result?: JsonObject;
  evaluationFieldIds?: string[];
};

export type EvidenceReference =
  | { scope: "field"; fieldIndex: number }
  | { scope: "column"; fieldIndex: number; columnIndex: number }
  | { scope: "result"; fieldId: string; columnKey?: string }
  | { scope: "evaluation"; fieldId: string }
  | { scope: "sample" };

export type AssistantObservation = {
  kind: "observation" | "hypothesis" | "suggestion";
  text: string;
  references: EvidenceReference[];
};

type ProposedColumn = { heading: string; description: string; data_type: (typeof COLUMN_DATA_TYPES)[number] };

type ProposedSchema = { mode?: "table"; data_type?: "object" | "array<object>"; columns: ProposedColumn[] };

type ProposedField = {
  name: string;
  description: string;
  data_type: (typeof TEMPLATE_DATA_TYPES)[number];
  object_schema?: ProposedSchema | null;
};

type FieldTarget = { fieldIndex: number; expectName: string | null };

type ColumnTarget = FieldTarget & { columnIndex: number; expectHeading: string | null };

export type ProposalOperation =
  | { op: "set_template"; set: { name?: string; description?: string | null } }
  | { op: "add_field"; after: number | null; field: ProposedField }
  | (FieldTarget & { op: "update_field"; set: Partial<ProposedField> })
  | (FieldTarget & { op: "remove_field" })
  | (FieldTarget & { op: "add_column"; after: number | null; column: ProposedColumn })
  | (ColumnTarget & { op: "update_column"; set: Partial<ProposedColumn> })
  | (ColumnTarget & { op: "remove_column" });

export type ProposalGroup = {
  id: string;
  title: string;
  rationale: string;
  dependsOn: string[];
  operations: ProposalOperation[];
};

export type AssistantOutput = { explanation: string; observations: AssistantObservation[]; groups: ProposalGroup[] };

export class AssistantContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantContractError";
  }
}

function fail(message: string): never {
  throw new AssistantContractError(message);
}

const own = (record: DraftRecord, property: string) => Object.prototype.hasOwnProperty.call(record, property);

const encodedBytes = (value: JsonValue | undefined) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function object(
  value: JsonValue | undefined,
  label: string,
  keys: readonly string[],
  required: readonly string[] = keys,
): DraftRecord {
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail(`${label} must be an object`);
  const record = value;

  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(`${label} has unsupported property “${key}”`);

  for (const key of required) if (!own(record, key)) fail(`${label}.${key} is required`);

  return record;
}

function textValue(
  value: JsonValue | undefined,
  label: string,
  max: number = ASSISTANT_LIMITS.propertyCharacters,
  allowEmpty = false,
): asserts value is string {
  if (!isString(value) || (!allowEmpty && !value.trim()) || value.length > max)
    fail(`${label} must be ${allowEmpty ? "text" : "non-empty text"} of at most ${max} characters`);
}

function expected(value: JsonValue | undefined, label: string): void {
  if (value !== null) textValue(value, label, ASSISTANT_LIMITS.propertyCharacters, true);
}

function position(value: JsonValue | undefined, length: number, label: string): asserts value is number {
  if (!isNumber(value) || !Number.isInteger(value) || value < 0 || value >= length)
    fail(`${label} does not address a base draft position`);
}

function insertion(value: JsonValue | undefined, length: number, label: string): void {
  if (value !== null && (!isNumber(value) || !Number.isInteger(value) || value < -1 || value >= length))
    fail(`${label} must be null (append), -1 (prepend), or an existing base position`);
}

function validateColumn(value: JsonValue | undefined, partial = false): void {
  const column = object(value, "column", ["heading", "description", "data_type"], partial ? [] : undefined);

  if (partial && !Object.keys(column).length) fail("A column update must change a property");

  if (own(column, "heading")) {
    textValue(column.heading, "column.heading");

    if (normalizeTemplateName(column.heading) !== column.heading)
      fail("Proposed column headings must contain only letters, numbers and single spaces, without surrounding spaces");
  }

  if (own(column, "description")) textValue(column.description, "column.description");

  if (own(column, "data_type") && !COLUMN_DATA_TYPES.some((type) => type === column.data_type))
    fail("Unsupported column data_type");
}

function validateSchema(value: JsonValue | undefined): void {
  if (value === null) return;
  const schema = object(value, "object_schema", ["mode", "data_type", "columns"], ["columns"]);

  if (own(schema, "mode") && schema.mode !== "table") fail("object_schema.mode must be table");

  if (own(schema, "data_type") && !isTableType(schema.data_type)) fail("object_schema.data_type must be a table type");

  if (!isJsonArray(schema.columns) || !schema.columns.length || schema.columns.length > 20)
    fail("object_schema.columns must contain 1 to 20 columns");
  schema.columns.forEach((column: JsonValue | undefined) => validateColumn(column));
}

function validateField(value: JsonValue | undefined, partial = false): void {
  const field = object(
    value,
    "field",
    ["name", "description", "data_type", "object_schema"],
    partial ? [] : ["name", "description", "data_type"],
  );

  if (partial && !Object.keys(field).length) fail("A field update must change a property");

  if (own(field, "name")) {
    textValue(field.name, "field.name");

    if (normalizeTemplateName(field.name) !== field.name)
      fail("Proposed field names must contain only letters, numbers and single spaces, without surrounding spaces");
  }

  if (own(field, "description")) {
    textValue(field.description, "field.description");

    if (/\[\[\/?OBJECT_(SCHEMA|TABLE_GUIDANCE)\]\]/.test(field.description))
      fail("Field instructions must be plain text; use object_schema for column changes");
  }

  if (own(field, "data_type") && !TEMPLATE_DATA_TYPES.some((type) => type === field.data_type))
    fail("Unsupported field data_type");

  if (own(field, "object_schema")) validateSchema(field.object_schema);

  if (!partial && own(field, "object_schema") && (!isTableType(field.data_type) || field.object_schema === null))
    fail("New field schemas must describe a table-shaped field");
}

const OP_KEYS = {
  set_template: ["op", "set"],
  add_field: ["op", "after", "field"],
  update_field: ["op", "fieldIndex", "expectName", "set"],
  remove_field: ["op", "fieldIndex", "expectName"],
  add_column: ["op", "fieldIndex", "expectName", "after", "column"],
  update_column: ["op", "fieldIndex", "expectName", "columnIndex", "expectHeading", "set"],
  remove_column: ["op", "fieldIndex", "expectName", "columnIndex", "expectHeading"],
};

function isOperationName(value: JsonValue | undefined): value is keyof typeof OP_KEYS {
  return isString(value) && Object.hasOwn(OP_KEYS, value);
}

function validateOperation(value: JsonValue | undefined, base: DraftRecord): asserts value is ProposalOperation {
  if (!isRecord(value) || !isOperationName(value.op)) fail("Unsupported proposal operation");
  const op = object(value, "operation", OP_KEYS[value.op]);
  const fields = isJsonArray(base.fields) ? base.fields : [];

  if (op.op === "set_template") {
    const set = object(op.set, "set_template.set", ["name", "description"], []);

    if (!Object.keys(set).length) fail("A Template update must change a property");

    if (own(set, "name")) textValue(set.name, "Template name");

    if (own(set, "description") && set.description !== null)
      textValue(set.description, "Template description", ASSISTANT_LIMITS.propertyCharacters, true);

    return;
  }

  if (op.op === "add_field") {
    insertion(op.after, fields.length, "add_field.after");
    validateField(op.field);

    return;
  }

  position(op.fieldIndex, fields.length, "fieldIndex");
  const field = fields[op.fieldIndex];
  expected(op.expectName, "expectName");

  if (!isRecord(field) || (field.name ?? null) !== op.expectName)
    fail(`Proposal target Field ${op.fieldIndex + 1} does not match its exact base name`);

  if (op.op === "remove_field") return;

  if (op.op === "update_field") {
    validateField(op.set, true);

    return;
  }

  if (!isTableType(field.data_type))
    fail(
      "Column operations require a table-shaped field in the base draft; use one atomic field type/schema update for conversions",
    );
  const columns = templateColumns(field);

  if (op.op === "add_column") {
    insertion(op.after, columns.length, "add_column.after");
    validateColumn(op.column);

    return;
  }

  position(op.columnIndex, columns.length, "columnIndex");
  expected(op.expectHeading, "expectHeading");
  const column = columns[op.columnIndex];

  if (!isRecord(column) || (column.heading ?? null) !== op.expectHeading)
    fail(`Proposal target column ${op.columnIndex + 1} does not match its exact base heading`);

  if (op.op === "update_column") validateColumn(op.set, true);
}

function validateReference(
  value: JsonValue | undefined,
  base: DraftRecord,
  context: EvidenceContext,
): asserts value is EvidenceReference {
  if (!isRecord(value)) fail("Evidence reference must be an object");
  const ref = value;
  const fields = isJsonArray(base.fields) ? base.fields : [];

  if (ref.scope === "sample") {
    object(ref, "sample reference", ["scope"]);

    if (!context.sampleSupplied) fail("A sample reference requires a supplied binary source");
  } else if (ref.scope === "field" || ref.scope === "column") {
    object(
      ref,
      "draft reference",
      ref.scope === "field" ? ["scope", "fieldIndex"] : ["scope", "fieldIndex", "columnIndex"],
    );
    position(ref.fieldIndex, fields.length, "Evidence fieldIndex");

    if (ref.scope === "column")
      position(ref.columnIndex, templateColumns(fields[ref.fieldIndex]).length, "Evidence columnIndex");
  } else if (ref.scope === "result") {
    object(ref, "result reference", ["scope", "fieldId", "columnKey"], ["scope", "fieldId"]);
    textValue(ref.fieldId, "Evidence fieldId");
    const field = context.resultFields?.find((entry) => isRecord(entry) && entry.id === ref.fieldId);

    if (!field || !context.result || !own(context.result, ref.fieldId))
      fail("Result reference must identify a supplied historical field and result");

    if (own(ref, "columnKey")) {
      textValue(ref.columnKey, "Evidence columnKey");

      if (
        !templateColumns(field).some(
          (column) => isRecord(column) && (column.key ?? templateIdentity(column.heading)) === ref.columnKey,
        )
      )
        fail("Result column reference must identify a supplied historical column");
    }
  } else if (ref.scope === "evaluation") {
    object(ref, "evaluation reference", ["scope", "fieldId"]);
    textValue(ref.fieldId, "Evidence fieldId");

    if (!context.evaluationFieldIds?.includes(ref.fieldId))
      fail("Evaluation reference must identify a supplied failing field");
  } else fail("Unsupported evidence reference scope");
}

/** Invalid model output is rejected whole; nothing is truncated, inferred, or silently dropped. */
export function validateAssistantOutput(
  value: JsonValue | undefined,
  base: JsonValue | undefined,
  action: AssistanceAction,
  evidenceContext: EvidenceContext = {},
): AssistantOutput {
  if (!isRecord(base)) fail("The base draft must be an object");

  if (action !== "explain" && action !== "edit") fail("Unsupported assistance action");

  if (encodedBytes(value) > ASSISTANT_LIMITS.responseBytes)
    fail("Assistance output exceeds 64 KiB; request fewer changes");
  const output = object(value, "assistant output", ["explanation", "observations", "groups"]);
  textValue(output.explanation, "explanation", 8_000);

  if (!isJsonArray(output.observations) || output.observations.length > ASSISTANT_LIMITS.observations)
    fail("observations must be a list of at most 20 items");
  output.observations.forEach((value: JsonValue | undefined) => {
    const observation = object(value, "observation", ["kind", "text", "references"]);

    if (observation.kind !== "observation" && observation.kind !== "hypothesis" && observation.kind !== "suggestion")
      fail("Unsupported observation kind");
    textValue(observation.text, "observation.text", 4_000);

    if (
      !isJsonArray(observation.references) ||
      observation.references.length > ASSISTANT_LIMITS.referencesPerObservation
    )
      fail("Each observation may reference at most 20 supplied locations");
    observation.references.forEach((ref: JsonValue | undefined) => validateReference(ref, base, evidenceContext));

    if (observation.kind === "observation" && !observation.references.length)
      fail(
        "An observation requires a supplied evidence reference; label unsupported reasoning as a hypothesis or suggestion",
      );
  });

  if (action === "explain" && (!isJsonArray(output.groups) || output.groups.length))
    fail("Explain-only requests cannot propose edits");
  validateGroups(output.groups, base);

  // SAFETY: Every observation and reference is checked above; validateGroups checks all group and operation contracts.
  return output as AssistantOutput;
}

function validateGroups(value: JsonValue | undefined, base: DraftRecord): asserts value is ProposalGroup[] {
  if (!isJsonArray(value) || value.length > ASSISTANT_LIMITS.groups)
    fail("groups must contain at most 20 change groups");
  const groups: ProposalGroup[] = [];
  const ids = new Set<string>();
  let operations = 0;

  for (const item of value) {
    const group = object(item, "group", ["id", "title", "rationale", "dependsOn", "operations"]);
    textValue(group.id, "group.id", 64);

    if (!/^[a-zA-Z0-9_-]+$/.test(group.id) || ids.has(group.id))
      fail("Group IDs must be unique letters, numbers, underscores or hyphens");
    ids.add(group.id);
    textValue(group.title, "group.title", 200);
    textValue(group.rationale, "group.rationale", 2_000);

    if (
      !isJsonArray(group.dependsOn) ||
      group.dependsOn.length > ASSISTANT_LIMITS.groups ||
      !group.dependsOn.every(isString) ||
      new Set(group.dependsOn).size !== group.dependsOn.length
    )
      fail("dependsOn must contain unique group IDs");

    if (
      !isJsonArray(group.operations) ||
      !group.operations.length ||
      group.operations.length > ASSISTANT_LIMITS.operationsPerGroup
    )
      fail("Each group must contain 1 to 25 operations");
    operations += group.operations.length;

    if (operations > ASSISTANT_LIMITS.operations) fail("A proposal may contain at most 100 operations");

    const validatedOperations = group.operations.map((operation) => {
      validateOperation(operation, base);

      return operation;
    });

    validateAtomicConversions(base, validatedOperations);
    groups.push({
      id: group.id,
      title: group.title,
      rationale: group.rationale,
      dependsOn: group.dependsOn,
      operations: validatedOperations,
    });
  }

  const visiting = new Set<string>(),
    visited = new Set<string>();

  const walk = (id: string) => {
    if (visiting.has(id)) fail("Change dependencies must not contain a cycle");

    if (visited.has(id)) return;
    visiting.add(id);

    for (const dependency of groups.find((group) => group.id === id)!.dependsOn) {
      if (!ids.has(dependency)) fail(`Unknown dependency: ${dependency}`);
      walk(dependency);
    }

    visiting.delete(id);
    visited.add(id);
  };

  groups.forEach((group) => walk(group.id));
  const conflicts = operationConflicts(groups);

  if (conflicts.length)
    fail(
      `Conflicting proposal operations in ${conflicts.join(", ")}; produce independent changes or a single coherent atomic group`,
    );
}

function validateAtomicConversions(base: DraftRecord, operations: ProposalOperation[]): void {
  for (const op of operations) {
    if (op.op !== "update_field") continue;
    const original = draftField(base, op.fieldIndex);

    if (own(op.set, "object_schema")) {
      const typeChange = operations.find(
        (entry) => entry.op === "update_field" && entry.fieldIndex === op.fieldIndex && own(entry.set, "data_type"),
      );

      const effectiveType =
        (typeChange?.op === "update_field" ? typeChange.set.data_type : undefined) ?? original.data_type;

      if (op.set.object_schema !== null && !isTableType(effectiveType))
        fail("A column schema requires a table-shaped field in the same atomic group");

      if (op.set.object_schema === null && templateObjectMetadata(original).schema === undefined && !typeChange)
        fail("There is no column schema to remove");
    }

    if (!own(op.set, "data_type")) continue;

    const beforeTable = isTableType(original.data_type),
      afterTable = isTableType(op.set.data_type);

    if (beforeTable === afterTable) continue;

    const schemaOperation = operations.find(
      (entry) => entry.op === "update_field" && entry.fieldIndex === op.fieldIndex && own(entry.set, "object_schema"),
    );

    if (
      !schemaOperation ||
      schemaOperation.op !== "update_field" ||
      (afterTable ? schemaOperation.set.object_schema === null : schemaOperation.set.object_schema !== null)
    )
      fail("A table type conversion and its explicit schema addition/removal must be in the same atomic group");
  }
}

type Touch = {
  group: string;
  operation: number;
  key: string;
  field?: number;
  column?: number;
  removesField?: boolean;
  schema?: boolean;
  removesColumn?: boolean;
};

function operationTouches(op: ProposalOperation, group: string, operation: number): Touch[] {
  const touch = (key: string, extra: Partial<Touch> = {}): Touch => ({ group, operation, key, ...extra });

  if (op.op === "set_template") return Object.keys(op.set).map((key) => touch(`template:${key}`));

  if (op.op === "add_field") return [touch(`new-field:${templateIdentity(op.field.name)}`)];
  const field = op.fieldIndex;

  if (op.op === "remove_field") return [touch(`field:${field}:*`, { field, removesField: true })];

  if (op.op === "update_field")
    return Object.keys(op.set).map((key) => touch(`field:${field}:${key}`, { field, schema: key === "object_schema" }));

  if (op.op === "add_column")
    return [touch(`new-column:${field}:${templateIdentity(op.column.heading)}`, { field, column: -1 })];
  const column = op.columnIndex;

  if (op.op === "remove_column") return [touch(`column:${field}:${column}:*`, { field, column, removesColumn: true })];

  return Object.keys(op.set).map((key) => touch(`column:${field}:${column}:${key}`, { field, column }));
}

function operationConflicts(groups: ProposalGroup[]): string[] {
  const all = groups.flatMap((group) => group.operations.flatMap((op, index) => operationTouches(op, group.id, index)));
  const conflicting = new Set<string>();

  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!,
        b = all[j]!;

      if (a.group === b.group && a.operation === b.operation) continue;
      const sameField = a.field !== undefined && a.field === b.field;

      if (
        a.key === b.key ||
        (sameField &&
          (a.removesField ||
            b.removesField ||
            (a.schema && b.column !== undefined) ||
            (b.schema && a.column !== undefined) ||
            (a.column !== undefined && a.column === b.column && (a.removesColumn || b.removesColumn))))
      ) {
        conflicting.add(a.group);
        conflicting.add(b.group);
      }
    }

  return [...conflicting];
}

/** Copy only touched records. Positions always refer to the exact base, including insertion anchors. */
export function applyGroups(base: DraftRecord, groups: ProposalGroup[]): DraftRecord {
  const operations = groups.flatMap((group) => group.operations);
  operations.forEach((op) => validateOperation(op, base));
  groups.forEach((group) => validateAtomicConversions(base, group.operations));

  if (operationConflicts(groups).length) fail("Conflicting selected operations");
  const result = { ...base };
  const fields = isJsonArray(base.fields) ? base.fields : [];

  const removed = new Set<number>(),
    updates = new Map<number, DraftRecord>();

  const additions: { after: number; field: DraftRecord }[] = [];
  const columnOperations = new Map<number, ProposalOperation[]>();

  for (const op of operations) {
    if (op.op === "set_template") Object.assign(result, op.set);
    else if (op.op === "add_field")
      additions.push({ after: op.after ?? fields.length - 1, field: addIdentities(op.field) });
    else if (op.op === "remove_field") removed.add(op.fieldIndex);
    else if (op.op === "update_field") {
      const original = updates.get(op.fieldIndex) || draftField(base, op.fieldIndex);
      const next: DraftRecord = { ...original, ...op.set };

      if (own(op.set, "name") && op.set.name !== original.name) next.id = templateIdentity(op.set.name);

      if (
        own(op.set, "description") &&
        !own(op.set, "object_schema") &&
        isTableType(original.data_type) &&
        original.object_schema === undefined
      ) {
        const schema = templateObjectMetadata(original).schema;

        if (schema !== undefined) next.object_schema = schema;
      }

      if (own(op.set, "object_schema")) {
        if (op.set.object_schema === null) delete next.object_schema;
        else if (op.set.object_schema)
          next.object_schema = {
            ...op.set.object_schema,
            columns: op.set.object_schema.columns.map((column) => ({
              ...column,
              key: templateIdentity(column.heading),
            })),
          };

        if (/\[\[OBJECT_SCHEMA\]\]/.test(isString(original.description) ? original.description : ""))
          next.description = own(op.set, "description")
            ? op.set.description
            : templateObjectMetadata(original).description;
      }

      updates.set(op.fieldIndex, next);
    } else columnOperations.set(op.fieldIndex, [...(columnOperations.get(op.fieldIndex) || []), op]);
  }

  for (const [fieldIndex, ops] of columnOperations) {
    const original = draftField(base, fieldIndex);
    const next = { ...(updates.get(fieldIndex) || original) };
    const columns = templateColumns(original);

    const changed = new Map<number, DraftRecord>(),
      dropped = new Set<number>();

    const added: { after: number; column: DraftRecord }[] = [];

    for (const op of ops) {
      if (op.op === "add_column")
        added.push({
          after: op.after ?? columns.length - 1,
          column: { ...op.column, key: templateIdentity(op.column.heading) },
        });

      if (op.op === "remove_column") dropped.add(op.columnIndex);

      if (op.op === "update_column") {
        const column: DraftRecord = {
          ...(changed.get(op.columnIndex) || draftRecord(columns[op.columnIndex])),
          ...op.set,
        };

        if (own(op.set, "heading") && op.set.heading !== draftRecord(columns[op.columnIndex]).heading)
          column.key = templateIdentity(op.set.heading);
        changed.set(op.columnIndex, column);
      }
    }

    const nextColumns: JsonValue[] = [];

    const place = (after: number) =>
      added.filter((entry) => entry.after === after).forEach((entry) => nextColumns.push(entry.column));

    place(-1);
    columns.forEach((column, index) => {
      if (!dropped.has(index)) nextColumns.push(changed.get(index) || column);
      place(index);
    });
    const schema = templateObjectMetadata(original).schema;
    next.object_schema = { ...(isRecord(schema) ? schema : { mode: "table" }), columns: nextColumns };

    if (/\[\[OBJECT_SCHEMA\]\]/.test(isString(original.description) ? original.description : ""))
      next.description = templateObjectMetadata(next).description;
    updates.set(fieldIndex, next);
  }

  const nextFields: JsonValue[] = [];

  const place = (after: number) =>
    additions.filter((entry) => entry.after === after).forEach((entry) => nextFields.push(entry.field));

  place(-1);
  fields.forEach((field, index) => {
    if (!removed.has(index)) nextFields.push(updates.get(index) || field);
    place(index);
  });
  result.fields = nextFields;

  return result;
}

function addIdentities(field: ProposedField): DraftRecord {
  const next = { ...field, id: templateIdentity(field.name) };

  if (field.object_schema)
    next.object_schema = {
      ...field.object_schema,
      columns: field.object_schema.columns.map((column) => ({ ...column, key: templateIdentity(column.heading) })),
    };

  return next;
}

const selectionError = (message: string): TemplateDiagnostic => ({
  id: "proposal.invalid",
  code: "proposal.invalid",
  severity: "error",
  location: { scope: "template", property: "fields" },
  title: message,
  explanation: "This proposal cannot safely update the current draft.",
  remedy: "Revise the request and regenerate the proposal.",
});

type SelectionEvaluation = {
  selected: ProposalGroup[];
  result: DraftRecord | null;
  errors: TemplateDiagnostic[];
  conflicting: ProposalGroup[];
  dependencyErrors: string[];
  canApply: boolean;
};

export function evaluateSelection(
  base: JsonValue | undefined,
  groups: ProposalGroup[],
  selectedIds: Set<string> | string[],
) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const selected = isJsonArray(groups) ? groups.filter((group) => ids.has(group.id)) : [];

  const result: SelectionEvaluation = {
    selected,
    result: null,
    errors: [],
    conflicting: [],
    dependencyErrors: [],
    canApply: false,
  };

  try {
    if (!isRecord(base)) fail("The base draft must be an object");
    validateGroups(groups, base);

    for (const id of ids) if (!groups.some((group) => group.id === id)) fail("Selection contains an unknown group");
    result.dependencyErrors = selected.flatMap((group) =>
      group.dependsOn.flatMap((id) =>
        ids.has(id) ? [] : [`“${group.title}” also requires “${groups.find((entry) => entry.id === id)!.title}”.`],
      ),
    );

    if (result.dependencyErrors.length) {
      result.errors = result.dependencyErrors.map(selectionError);

      return result;
    }

    if (!selected.length) return result;
    result.result = applyGroups(base, selected);
    result.errors = diagnoseTemplateDraft(result.result);
    result.canApply = result.errors.length === 0;
  } catch (error) {
    result.errors = [selectionError(error instanceof Error ? error.message : "Invalid proposal")];
  }

  return result;
}

export type IdentityImpact = {
  kind: "added" | "removed" | "renamed" | "retyped";
  before?: string;
  after?: string;
  from?: string;
  to?: string;
};

export function identityImpacts(base: DraftRecord, group: ProposalGroup): IdentityImpact[] {
  const impacts: IdentityImpact[] = [];

  for (const op of group.operations) {
    const field = "fieldIndex" in op ? draftField(base, op.fieldIndex) : {};
    const fieldKey = templateIdentity(field.name);

    if (op.op === "add_field") impacts.push({ kind: "added", after: templateIdentity(op.field.name) });

    if (op.op === "remove_field") impacts.push({ kind: "removed", before: fieldKey });

    if (op.op === "update_field") {
      if (own(op.set, "name") && templateIdentity(op.set.name) !== fieldKey)
        impacts.push({ kind: "renamed", before: fieldKey, after: templateIdentity(op.set.name) });

      if (own(op.set, "data_type") && op.set.data_type !== field.data_type)
        impacts.push({
          kind: "retyped",
          before: fieldKey,
          from: isString(field.data_type) ? field.data_type : undefined,
          to: op.set.data_type,
        });

      if (own(op.set, "object_schema")) {
        const before = templateColumns(field).map(draftRecord),
          after = op.set.object_schema?.columns ?? [];

        for (const column of before) {
          const key = templateIdentity(column.heading),
            match = after.find((next) => templateIdentity(next.heading) === key);

          if (!match) impacts.push({ kind: "removed", before: `${fieldKey}.${key}` });
          else if (match.data_type !== column.data_type)
            impacts.push({
              kind: "retyped",
              before: `${fieldKey}.${key}`,
              from: isString(column.data_type) ? column.data_type : undefined,
              to: match.data_type,
            });
        }

        for (const column of after)
          if (!before.some((previous) => templateIdentity(previous.heading) === templateIdentity(column.heading)))
            impacts.push({ kind: "added", after: `${fieldKey}.${templateIdentity(column.heading)}` });
      }
    }

    const column = "columnIndex" in op ? draftRecord(templateColumns(field)[op.columnIndex]) : {};
    const columnKey = `${fieldKey}.${templateIdentity(column.heading)}`;

    if (op.op === "add_column")
      impacts.push({ kind: "added", after: `${fieldKey}.${templateIdentity(op.column.heading)}` });

    if (op.op === "remove_column") impacts.push({ kind: "removed", before: columnKey });

    if (op.op === "update_column") {
      if (own(op.set, "heading") && templateIdentity(op.set.heading) !== templateIdentity(column?.heading))
        impacts.push({ kind: "renamed", before: columnKey, after: `${fieldKey}.${templateIdentity(op.set.heading)}` });

      if (own(op.set, "data_type") && op.set.data_type !== column?.data_type)
        impacts.push({
          kind: "retyped",
          before: columnKey,
          from: isString(column.data_type) ? column.data_type : undefined,
          to: op.set.data_type,
        });
    }
  }

  return impacts;
}

export type PreviewRow = {
  target: string;
  property: string;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
  kind: "add" | "remove" | "change";
};

const PROPERTY_LABELS = new Map([
  ["name", "Name"],
  ["heading", "Column name"],
  ["description", "Instructions"],
  ["data_type", "Type"],
]);

function propertyRows(
  target: string,
  before: DraftRecord | null,
  after: DraftRecord | null,
  properties: string[],
): PreviewRow[] {
  return properties.flatMap((key): PreviewRow[] =>
    before && after && before[key] === after[key]
      ? []
      : [
          {
            target,
            property: PROPERTY_LABELS.get(key) || key,
            before: before?.[key] ?? null,
            after: after?.[key] ?? null,
            kind: before === null ? "add" : after === null ? "remove" : "change",
          },
        ],
  );
}

function columnSchemaRows(target: string, before: JsonValue[], after: JsonValue[]): PreviewRow[] {
  const rows: PreviewRow[] = [];

  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    rows.push(
      ...propertyRows(
        `${target} › column ${index + 1}`,
        before[index] === undefined ? null : draftRecord(before[index]),
        after[index] === undefined ? null : draftRecord(after[index]),
        ["heading", "description", "data_type"],
      ),
    );
  }

  return rows;
}

export function describeOperation(base: DraftRecord, op: ProposalOperation): PreviewRow[] {
  if (op.op === "set_template")
    return Object.entries(op.set).map(([key, value]) => ({
      target: "Template",
      property: key === "description" ? "Description" : "Name",
      before: base[key],
      after: value,
      kind: "change",
    }));

  if (op.op === "add_field")
    return [
      ...propertyRows(op.field.name, null, op.field, ["name", "description", "data_type"]),
      ...columnSchemaRows(op.field.name, [], templateColumns(op.field)),
    ];

  const field = draftField(base, op.fieldIndex);
  const target = isString(field.name) && field.name ? field.name : `Field ${op.fieldIndex + 1}`;

  if (op.op === "remove_field")
    return [
      ...propertyRows(target, { ...field, description: templateObjectMetadata(field).description }, null, [
        "name",
        "description",
        "data_type",
      ]),
      ...columnSchemaRows(target, templateColumns(field), []),
    ];

  if (op.op === "update_field")
    return Object.entries(op.set).flatMap(([key, value]): PreviewRow[] => {
      if (key === "object_schema")
        return columnSchemaRows(
          target,
          templateColumns(field),
          isRecord(value) && isJsonArray(value.columns) ? value.columns : [],
        );

      return [
        {
          target,
          property: PROPERTY_LABELS.get(key) || key,
          before: key === "description" ? templateObjectMetadata(field).description : field[key],
          after: value,
          kind: "change",
        },
      ];
    });

  if (op.op === "add_column")
    return propertyRows(`${target} › new column`, null, op.column, ["heading", "description", "data_type"]);

  const column = draftRecord(templateColumns(field)[op.columnIndex]),
    columnTarget = `${target} › ${column?.heading || `column ${op.columnIndex + 1}`}`;

  if (op.op === "remove_column")
    return propertyRows(columnTarget, column!, null, ["heading", "description", "data_type"]);

  return Object.entries(op.set).map(([key, value]) => ({
    target: columnTarget,
    property: PROPERTY_LABELS.get(key) || key,
    before: column?.[key],
    after: value,
    kind: "change",
  }));
}

export function previewRows(base: DraftRecord, group: ProposalGroup): PreviewRow[] {
  return group.operations.flatMap((op) => describeOperation(base, op));
}

export const ASSISTANT_OUTPUT_CONTRACT = `Return exactly a JSON object {"explanation":string,"observations":[{"kind":"observation"|"hypothesis"|"suggestion","text":string,"references":[]}],"groups":[{"id":string,"title":string,"rationale":string,"dependsOn":[groupId],"operations":[]}]}. No additional properties anywhere. Explain action requires groups: []. Observations require supplied evidence references. References are exactly {scope:"field",fieldIndex}, {scope:"column",fieldIndex,columnIndex}, {scope:"result",fieldId,columnKey?}, {scope:"evaluation",fieldId}, or {scope:"sample"}. Draft positions refer to the current draft; result identities refer only to the supplied historical Template/result; evaluation field IDs refer only to supplied failing evaluation fields. Sample references require a supplied binary source. Do not claim verified answers beyond those supplied as evaluation evidence, and do not claim confirmed causes, page locations, or measured improvements. Extraction results and candidate values are model outputs, not ground truth. Label inferences as hypotheses and quality advice as suggestions.
Operations:
{op:"set_template",set:{name?,description?}};
{op:"add_field",after:number|null,field:{name,description,data_type,object_schema?}};
{op:"update_field",fieldIndex,expectName:string|null,set:{name?,description?,data_type?,object_schema?}};
{op:"remove_field",fieldIndex,expectName:string|null};
{op:"add_column",fieldIndex,expectName:string|null,after:number|null,column:{heading,description,data_type}};
{op:"update_column",fieldIndex,expectName:string|null,columnIndex,expectHeading:string|null,set:{heading?,description?,data_type?}};
{op:"remove_column",fieldIndex,expectName:string|null,columnIndex,expectHeading:string|null}.
Every target index addresses the BASE draft, and expectName/expectHeading must exactly equal the raw base value (null only for missing values). after is a base index, -1 to prepend, or null to append. Do not supply ids or keys; identities derive from names/headings. object_schema is {mode?:"table",data_type?:"object"|"array<object>",columns:[{heading,description,data_type}]} or null to remove it. Field types: string, number, boolean, date, object, array, array<object>. Column types: string, number, boolean, date. Plain instructions must never contain internal OBJECT_SCHEMA/OBJECT_TABLE_GUIDANCE markers. At most 20 groups, 25 operations per group, 100 operations total, 50 resulting fields, 20 table columns and one table-shaped field. Metadata changes require the user's request. Table conversions and explicit schema addition/removal must be in the SAME atomic group. No overlapping writes, removed targets, schema replacement mixed with column edits, unknown dependencies or cycles. Independent edits go in independently selectable groups; only inseparable edits go together. Preserve unrelated raw values and order. Do not repair unrelated issues silently. If unsupported or ambiguous, explain the limitation and return no groups. Keep the response below 64 KiB.`;

export const SUGGESTION_LIMITS = Object.freeze({
  suggestions: 6,
  labelCharacters: 80,
  requestCharacters: 300,
  reasonCharacters: 160,
});

export type RequestSuggestion = { label: string; request: string; reason: string };

export const SUGGESTION_OUTPUT_CONTRACT = `Return exactly a JSON object {"suggestions":[{"label":string,"request":string,"reason":string}]} with 0 to ${SUGGESTION_LIMITS.suggestions} suggestions. Return an empty array when no grounded suggestions are available. No additional properties anywhere. label: a short, specific request the user could make about THIS draft (at most ${SUGGESTION_LIMITS.labelCharacters} characters). request: the full request text that will be sent if chosen (at most ${SUGGESTION_LIMITS.requestCharacters} characters). reason: why it is relevant, citing the draft field, column, problem or evidence it is based on (at most ${SUGGESTION_LIMITS.reasonCharacters} characters).`;

/** Suggested requests only prefill the user's request box; they never change the draft. */
export function validateSuggestionOutput(value: JsonValue | undefined): RequestSuggestion[] {
  const record = object(value, "suggestion output", ["suggestions"]);

  if (!isJsonArray(record.suggestions) || record.suggestions.length > SUGGESTION_LIMITS.suggestions)
    fail(`Return between 0 and ${SUGGESTION_LIMITS.suggestions} suggestions`);
  const seen = new Set<string>();

  return record.suggestions.map((item: JsonValue | undefined) => {
    const suggestion = object(item, "suggestion", ["label", "request", "reason"]);

    textValue(suggestion.label, "suggestion label", SUGGESTION_LIMITS.labelCharacters);
    textValue(suggestion.request, "suggestion request", SUGGESTION_LIMITS.requestCharacters);
    textValue(suggestion.reason, "suggestion reason", SUGGESTION_LIMITS.reasonCharacters);

    if (seen.has(suggestion.label.trim())) fail("Suggestion labels must be unique");
    seen.add(suggestion.label.trim());

    return { label: suggestion.label.trim(), request: suggestion.request.trim(), reason: suggestion.reason.trim() };
  });
}

function draftRecord(value: JsonValue | undefined): DraftRecord {
  return isRecord(value) ? value : {};
}

function draftField(base: DraftRecord, index: number): DraftRecord {
  return isJsonArray(base.fields) ? draftRecord(base.fields[index]) : {};
}
