import { isString, isJsonObject, isJsonArray, parseJson, type JsonValue, type JsonObject } from "./json";

/** Authoritative, non-mutating schema diagnostics shared by saving and draft assistance. */
export const TEMPLATE_DATA_TYPES = ["string", "number", "boolean", "date", "object", "array", "array<object>"] as const;

export const COLUMN_DATA_TYPES = ["string", "number", "boolean", "date"] as const;

export const MAX_TEMPLATE_FIELDS = 50;

export const MAX_TEMPLATE_OBJECT_COLUMNS = 20;

export type DraftRecord = JsonObject;

export type DiagnosticLocation = {
  scope: "template" | "field" | "column";
  property: string;
  fieldIndex?: number;
  columnIndex?: number;
  relatedFieldIndex?: number;
  relatedColumnIndex?: number;
};

export type TemplateDiagnostic = {
  id: string;
  code: string;
  severity: "error";
  location: DiagnosticLocation;
  title: string;
  explanation: string;
  remedy: string;
};

export const isRecord = (value: JsonValue | undefined): value is DraftRecord => isJsonObject(value);

export const normalizeTemplateName = (value: JsonValue | undefined): string =>
  isString(value)
    ? value
        .replace(/[^a-zA-Z0-9 ]+/g, "")
        .trim()
        .replace(/\s+/g, " ")
    : "";

export const templateIdentity = (value: JsonValue | undefined): string =>
  normalizeTemplateName(value).toLowerCase().replace(/\s+/g, "_");

export const isTableType = (value: JsonValue | undefined): boolean => value === "object" || value === "array<object>";

type TemplateObjectMetadata = { description: string; schema: JsonValue | undefined; malformed: boolean };

/** Read persisted metadata without normalizing or dropping malformed input. */
export function templateObjectMetadata(field: JsonValue | undefined): TemplateObjectMetadata {
  if (!isRecord(field)) return { description: "", schema: undefined, malformed: false };
  const raw = isString(field.description) ? field.description : "";
  const pattern = /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/;
  const match = raw.match(pattern);
  let embedded: JsonValue | undefined;
  let malformed = raw.includes("[[OBJECT_SCHEMA]]") && !match;

  if (match) {
    try {
      embedded = parseJson(match[1]!);
    } catch {
      malformed = true;
    }
  }

  return {
    description: raw
      .replace(pattern, "")
      .replace(/\[\[OBJECT_TABLE_GUIDANCE\]\][\s\S]*?\[\[\/OBJECT_TABLE_GUIDANCE\]\]\s*/g, "")
      .trim(),
    schema: field.object_schema !== undefined ? field.object_schema : embedded,
    malformed: field.object_schema === undefined && malformed,
  };
}

export function templateColumns(field: JsonValue | undefined): JsonValue[] {
  const { schema } = templateObjectMetadata(field);

  return isRecord(schema) && isJsonArray(schema.columns) ? schema.columns : [];
}

export function locationKey(location: DiagnosticLocation): string {
  if (location.scope === "template") return `template:${location.property}`;

  if (location.scope === "field") return `field:${location.fieldIndex}:${location.property}`;

  return `column:${location.fieldIndex}:${location.columnIndex}:${location.property}`;
}

/** Invalid and incomplete drafts are diagnostic inputs, never exceptions. */
export function diagnoseTemplateDraft(
  draft: JsonValue | undefined,
  options: { allowPartial?: boolean } = {},
): TemplateDiagnostic[] {
  const issues: TemplateDiagnostic[] = [];

  const push = (code: string, location: DiagnosticLocation, title: string, explanation: string, remedy: string) => {
    issues.push({
      id: `${code}@${locationKey(location)}`,
      code,
      severity: "error",
      location,
      title,
      explanation,
      remedy,
    });
  };

  if (!isRecord(draft)) {
    push(
      "template.invalid",
      { scope: "template", property: "fields" },
      "Template JSON must be an object",
      "A Template needs named properties and a fields array.",
      "Use an object containing name, description and fields.",
    );

    return issues;
  }

  if ((!options.allowPartial || draft.name !== undefined) && (!isString(draft.name) || !draft.name.trim())) {
    push(
      "template.name_required",
      { scope: "template", property: "name" },
      "Template name is required",
      "A saved Template needs a name so people can find it.",
      "Enter a short name such as Supplier Invoice.",
    );
  }

  if (draft.description !== undefined && draft.description !== null && !isString(draft.description)) {
    push(
      "template.description_invalid",
      { scope: "template", property: "description" },
      "Template description must be a string",
      "The description is plain text.",
      "Enter text or leave the description empty.",
    );
  }

  if (options.allowPartial && draft.fields === undefined) return issues;

  if (!isJsonArray(draft.fields)) {
    push(
      "template.fields_invalid",
      { scope: "template", property: "fields" },
      "fields must be an array",
      "Template fields must be a list of field definitions.",
      "Use a JSON array or add fields in the editor.",
    );

    return issues;
  }

  const fields = draft.fields;

  if (!fields.length)
    push(
      "template.fields_required",
      { scope: "template", property: "fields" },
      "Add at least one field",
      "A Template must contain 1 to 50 fields.",
      "Add one field and describe the value to extract.",
    );

  if (fields.length > MAX_TEMPLATE_FIELDS)
    push(
      "template.too_many_fields",
      { scope: "template", property: "fields" },
      "fields must contain 1 to 50 items",
      `This draft contains ${fields.length} top-level fields.`,
      `Remove ${fields.length - MAX_TEMPLATE_FIELDS} fields.`,
    );
  const ids = new Map<string, number>();
  const tables: number[] = [];
  fields.forEach((field: JsonValue | undefined, fieldIndex: number) => {
    const at = (property: string, extra: Partial<DiagnosticLocation> = {}): DiagnosticLocation => ({
      scope: "field",
      fieldIndex,
      property,
      ...extra,
    });

    const label = `Field ${fieldIndex + 1}`;

    if (!isRecord(field)) {
      push(
        "field.invalid",
        at("name"),
        `${label}: must be an object`,
        "Every field needs a name, instructions and type.",
        "Replace this entry with a field definition.",
      );

      return;
    }

    const id = templateIdentity(field.name);

    if (!isString(field.name) || !field.name.trim()) {
      push(
        "field.name_required",
        at("name"),
        `${label}: name is required`,
        "The name determines the output key.",
        "Give this field a short, unique name.",
      );
    } else if (!id) {
      push(
        "field.name_unusable",
        at("name"),
        `${label}: name must include letters or numbers`,
        "This name cannot produce an output key.",
        "Use letters, numbers and spaces.",
      );
    } else if (ids.has(id)) {
      const first = ids.get(id)!;
      push(
        "field.duplicate_identity",
        at("name", { relatedFieldIndex: first }),
        `Duplicate field ID: ${id}`,
        `Fields ${first + 1} and ${fieldIndex + 1} produce the same output key after normalization.`,
        "Rename or remove one of these fields.",
      );
    } else ids.set(id, fieldIndex);
    const metadata = templateObjectMetadata(field);

    if (!isString(field.description) || !metadata.description) {
      push(
        "field.description_required",
        at("description"),
        `${label}: description is required`,
        "Extraction instructions must describe the requested value.",
        "Describe what to extract and where it appears.",
      );
    }

    if (!TEMPLATE_DATA_TYPES.some((type) => type === field.data_type)) {
      push(
        "field.type_unsupported",
        at("data_type"),
        `${label}: unsupported data_type`,
        "This type is not supported by the extractor.",
        `Choose one of: ${TEMPLATE_DATA_TYPES.join(", ")}.`,
      );
    }

    if (!isTableType(field.data_type)) return;
    tables.push(fieldIndex);

    if (metadata.malformed)
      push(
        "table.schema_invalid",
        at("object_schema"),
        `${label}: invalid embedded object schema`,
        "The saved column schema is not valid JSON.",
        "Repair the schema JSON or define the columns in the editor.",
      );

    // Historical table-shaped fields without an explicit column schema remain supported.
    if (metadata.schema === undefined) return;

    if (!isRecord(metadata.schema) || !isJsonArray(metadata.schema.columns)) {
      push(
        "table.schema_invalid",
        at("object_schema"),
        `${label}: object schema columns must be an array`,
        "A table schema must contain a columns list.",
        "Define the table columns in the schema editor.",
      );

      return;
    }

    const schema = metadata.schema;
    const columns = schema.columns;

    if (!isJsonArray(columns)) return;

    if (schema.data_type !== undefined && schema.data_type !== "" && schema.data_type !== field.data_type)
      push(
        "table.type_mismatch",
        at("object_schema"),
        `${label}: object schema data_type must match field data_type`,
        "The field and its schema describe different table shapes.",
        "Use the same type in the field and its schema.",
      );

    if (!columns.length)
      push(
        "table.columns_required",
        at("object_schema"),
        `${label}: object fields require at least one table column`,
        "This explicit schema contains no columns.",
        "Add a column with a name, scalar type and instructions.",
      );

    if (columns.length > MAX_TEMPLATE_OBJECT_COLUMNS)
      push(
        "table.too_many_columns",
        at("object_schema"),
        `${label}: object fields may contain at most 20 table columns`,
        `This schema contains ${columns.length} columns.`,
        `Remove ${columns.length - MAX_TEMPLATE_OBJECT_COLUMNS} columns.`,
      );
    const keys = new Map<string, number>();
    columns.forEach((column: JsonValue | undefined, columnIndex: number) => {
      const cat = (property: string, extra: Partial<DiagnosticLocation> = {}): DiagnosticLocation => ({
        scope: "column",
        fieldIndex,
        columnIndex,
        property,
        ...extra,
      });

      const where = `${label}, column ${columnIndex + 1}`;

      if (!isRecord(column)) {
        push(
          "column.invalid",
          cat("heading"),
          `${where}: must be an object`,
          "Every column needs a heading, type and description.",
          "Replace this column with a complete definition.",
        );

        return;
      }

      const heading = isString(column.heading) ? column.heading.trim() : "";
      const normalized = normalizeTemplateName(column.heading);
      const key = templateIdentity(column.heading);

      if (!heading)
        push(
          "column.heading_required",
          cat("heading"),
          `${where}: heading is required`,
          "Each column needs a name to form its output key.",
          "Give the column a unique name.",
        );
      else if (!key)
        push(
          "column.heading_unusable",
          cat("heading"),
          `${where}: heading must include letters or numbers`,
          "This heading cannot form an output key.",
          "Use letters, numbers and spaces.",
        );
      else if (heading !== normalized)
        push(
          "column.heading_characters",
          cat("heading"),
          `${where}: heading contains unsupported characters`,
          "Column headings must use letters, numbers and single spaces.",
          `Use “${normalized}” instead.`,
        );

      if (key) {
        if (keys.has(key))
          push(
            "column.duplicate_key",
            cat("heading", { relatedColumnIndex: keys.get(key) }),
            `${label}: duplicate object column key "${key}"`,
            "These headings produce the same output key.",
            "Rename or remove one column.",
          );
        else keys.set(key, columnIndex);
      }

      if (!COLUMN_DATA_TYPES.some((type) => type === column.data_type))
        push(
          "column.type_unsupported",
          cat("data_type"),
          `${where}: unsupported column type`,
          "Table columns must use scalar types; nested tables are unsupported.",
          "Choose string, number, boolean or date.",
        );

      if (!isString(column.description) || !column.description.trim())
        push(
          "column.description_required",
          cat("description"),
          `${where}: description is required`,
          "A column needs instructions explaining each row's value.",
          "Describe the value to extract for each row.",
        );
    });
  });
  tables
    .slice(1)
    .forEach((fieldIndex) =>
      push(
        "template.multiple_tables",
        { scope: "field", fieldIndex, property: "data_type", relatedFieldIndex: tables[0] },
        "A Template may contain at most one table-shaped Template field",
        "Another field already defines a table or group of fields.",
        "Combine the tables or change one field to a scalar type.",
      ),
    );

  return issues;
}

export function groupIssuesByLocation(issues: TemplateDiagnostic[]) {
  const byField = new Map<number, TemplateDiagnostic[]>();
  const byKey = new Map<string, TemplateDiagnostic[]>();

  for (const issue of issues) {
    const key = locationKey(issue.location);
    byKey.set(key, [...(byKey.get(key) || []), issue]);

    if (issue.location.fieldIndex !== undefined)
      byField.set(issue.location.fieldIndex, [...(byField.get(issue.location.fieldIndex) || []), issue]);
  }

  return { byField, byKey, template: issues.filter((issue) => issue.location.scope === "template") };
}

export function describeLocation(location: DiagnosticLocation, draft: JsonValue | undefined): string {
  if (location.scope === "template") return `Template ${location.property}`;
  const field = isRecord(draft) && isJsonArray(draft.fields) ? draft.fields[location.fieldIndex!] : undefined;
  const label = `Field ${location.fieldIndex! + 1}${(isRecord(field) ? field.name : undefined) ? ` “${isRecord(field) ? field.name : ""}”` : ""}`;

  if (location.scope === "field") return label;
  const column = templateColumns(field)[location.columnIndex!];

  return `${label} › column ${location.columnIndex! + 1}${(isRecord(column) ? column.heading : undefined) ? ` “${isRecord(column) ? column.heading : ""}”` : ""}`;
}
