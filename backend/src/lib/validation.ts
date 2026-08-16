import { HttpError } from "./http";
import type { DataType, FieldDefinition, ExtractOptions } from "./types";

const ALLOWED_DATA_TYPES: ReadonlySet<DataType> = new Set([
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
  "array<object>"
]);

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const OBJECT_GUIDANCE_START = "[[OBJECT_TABLE_GUIDANCE]]";
const OBJECT_GUIDANCE_END = "[[/OBJECT_TABLE_GUIDANCE]]";
const OBJECT_SCHEMA_START = "[[OBJECT_SCHEMA]]";
const OBJECT_SCHEMA_END = "[[/OBJECT_SCHEMA]]";
const OBJECT_SCHEMA_DATA_TYPES: ReadonlySet<DataType> = new Set(["string", "number", "boolean", "date"]);
export const MAX_TEMPLATE_OBJECT_COLUMNS = 20;

type TemplateInput = {
  name?: unknown;
  description?: unknown;
  fields?: unknown;
};

type ObjectColumnInput = {
  heading: string;
  data_type: string;
  description: string;
};

type ObjectSchemaInput = {
  data_type: string;
  columns: ObjectColumnInput[];
};

export function parseJsonBody<T>(body: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export function validateTemplatePayload(input: TemplateInput, allowPartial = false): {
  name?: string;
  description?: string | null;
  fields?: FieldDefinition[];
} {
  const output: {
    name?: string;
    description?: string | null;
    fields?: FieldDefinition[];
  } = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new HttpError(400, "invalid_name", "Template name is required");
    }
    output.name = input.name.trim();
  } else if (!allowPartial) {
    throw new HttpError(400, "invalid_name", "Template name is required");
  }

  if (input.description !== undefined) {
    if (input.description === null) {
      output.description = null;
    } else if (typeof input.description === "string") {
      output.description = input.description.trim();
    } else {
      throw new HttpError(400, "invalid_description", "Template description must be a string");
    }
  }

  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields)) {
      throw new HttpError(400, "invalid_fields", "fields must be an array");
    }
    if (input.fields.length === 0 || input.fields.length > 50) {
      throw new HttpError(400, "invalid_fields", "fields must contain 1 to 50 items");
    }

    const ids = new Set<string>();
    const names = new Set<string>();
    output.fields = input.fields.map((item, index) => {
      const field = item as Record<string, unknown>;
      const name = normalizeFieldName(field.name);
      const id = toFieldId(name);
      const description = typeof field.description === "string" ? field.description.trim() : "";
      const dataType = field.data_type;
      if (!name) {
        throw new HttpError(400, "invalid_fields", `Field ${index + 1} is missing name`);
      }
      if (!id) {
        throw new HttpError(400, "invalid_fields", `Field ${index + 1} name must include letters or numbers`);
      }
      if (!description) {
        throw new HttpError(400, "invalid_fields", `Field ${index + 1} is missing description`);
      }
      if (typeof dataType !== "string" || !ALLOWED_DATA_TYPES.has(dataType as DataType)) {
        throw new HttpError(400, "invalid_fields", `Field ${index + 1} has unsupported data_type`);
      }

      const normalizedDescription =
        dataType === "object" || dataType === "array<object>"
          ? normalizeObjectMetadata(description, field.object_schema, index, dataType)
          : description;

      if (ids.has(id)) {
        throw new HttpError(400, "invalid_fields", `Duplicate field id: ${id}`);
      }
      if (names.has(name)) {
        throw new HttpError(400, "invalid_fields", `Duplicate field name: ${name}`);
      }

      ids.add(id);
      names.add(name);

      return {
        id,
        name,
        description: normalizedDescription,
        data_type: dataType as DataType
      };
    });
    const tableShapedFieldCount = output.fields.filter(
      (field) => field.data_type === "object" || field.data_type === "array<object>",
    ).length;
    if (tableShapedFieldCount > 1) {
      throw new HttpError(400, "invalid_fields", "A Template may contain at most one table-shaped Template field");
    }
  } else if (!allowPartial) {
    throw new HttpError(400, "invalid_fields", "fields are required");
  }

  if (allowPartial && output.name === undefined && output.description === undefined && output.fields === undefined) {
    throw new HttpError(400, "empty_patch", "PATCH body must include at least one field");
  }

  return output;
}

function sanitizeFieldName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[^a-zA-Z0-9 ]+/g, "");
}

function normalizeFieldName(value: unknown): string {
  return sanitizeFieldName(value).trim().replace(/\s+/g, " ");
}

function toFieldId(name: string): string {
  return normalizeFieldName(name).toLowerCase().replace(/\s+/g, "_");
}

function normalizeObjectMetadata(
  description: string,
  schemaInput: unknown,
  fieldIndex: number,
  fieldDataType: "object" | "array<object>"
): string {
  const { baseDescription, objectSchema: descriptionObjectSchema } = extractObjectMetadata(description);
  const inputObjectSchema = normalizeObjectSchemaInput(schemaInput);
  const objectSchema = inputObjectSchema || descriptionObjectSchema;

  if (!objectSchema) {
    return baseDescription;
  }

  if (objectSchema.columns.length === 0) {
    throw new HttpError(
      400,
      "invalid_fields",
      `Field ${fieldIndex + 1}: object fields require at least one table column`
    );
  }

  if (objectSchema.columns.length > MAX_TEMPLATE_OBJECT_COLUMNS) {
    throw new HttpError(
      400,
      "invalid_fields",
      `Field ${fieldIndex + 1}: object fields may contain at most ${MAX_TEMPLATE_OBJECT_COLUMNS} table columns`,
    );
  }

  if (objectSchema.data_type && objectSchema.data_type !== fieldDataType) {
    throw new HttpError(
      400,
      "invalid_fields",
      `Field ${fieldIndex + 1}: object schema data_type must match field data_type`
    );
  }

  const normalizedColumns = objectSchema.columns.map((column, columnIndex) => {
    const heading = normalizeFieldName(column.heading);
    const rawHeading = String(column.heading || "").trim();
    const dataType = String(column.data_type || "").trim();
    const normalizedKey = toFieldId(heading);
    const descriptionText = String(column.description || "").trim();

    if (!rawHeading) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading is required`
      );
    }
    if (!heading) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading must include letters or numbers`
      );
    }
    if (heading !== rawHeading) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading contains unsupported characters`
      );
    }
    if (!normalizedKey) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: key must include letters or numbers`
      );
    }
    if (!OBJECT_SCHEMA_DATA_TYPES.has(dataType as DataType)) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: unsupported column type`
      );
    }

    return {
      key: normalizedKey,
      heading,
      data_type: dataType,
      description: descriptionText
    };
  });

  const seenKeys = new Set<string>();
  for (const [columnIndex, column] of normalizedColumns.entries()) {
    if (seenKeys.has(column.key)) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}: duplicate object column key "${column.key}"`
      );
    }
    seenKeys.add(column.key);

    if (!column.description) {
      throw new HttpError(
        400,
        "invalid_fields",
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: description is required`
      );
    }
  }

  return appendObjectMetadata(baseDescription, normalizedColumns, fieldDataType);
}

function normalizeObjectSchemaInput(value: unknown): ObjectSchemaInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const schema = value as Record<string, unknown>;
  const rawColumns = Array.isArray(schema.columns) ? schema.columns : [];
  return {
    data_type: String(schema.data_type || ""),
    columns: rawColumns.map((column) => {
      const item = (column || {}) as Record<string, unknown>;
      return {
        heading: String(item.heading || ""),
        data_type: String(item.data_type || ""),
        description: String(item.description || "")
      };
    })
  };
}

function appendObjectMetadata(
  baseDescription: string,
  columns: Array<{ key: string; heading: string; data_type: string; description: string }>,
  dataType: string
): string {
  const schema = {
    mode: "table",
    data_type: dataType,
    columns
  };

  const compactColumns = columns.map((column) => ({
    key: column.key,
    heading: column.heading,
    type: column.data_type
  }));

  const guidance = [
    "Return this field in table form with `columns` and `rows`.",
    "Use `columns` as the heading list in order.",
    "Use `rows` as objects that include every column key.",
    "If a row value is missing, set the value to null.",
    "Preserve row order from the source document.",
    `Expected columns: ${JSON.stringify(compactColumns)}`
  ].join(" ");

  return [
    baseDescription,
    "",
    OBJECT_GUIDANCE_START,
    guidance,
    OBJECT_GUIDANCE_END,
    "",
    OBJECT_SCHEMA_START,
    JSON.stringify(schema),
    OBJECT_SCHEMA_END
  ].join("\n");
}

function extractObjectMetadata(description: string): {
  baseDescription: string;
  objectSchema: {
    mode: string;
    data_type: string;
    columns: ObjectColumnInput[];
  } | null;
} {
  const schemaPattern = /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/;
  const guidancePattern = /\[\[OBJECT_TABLE_GUIDANCE\]\][\s\S]*?\[\[\/OBJECT_TABLE_GUIDANCE\]\]\s*/g;

  const schemaMatch = description.match(schemaPattern);
  let objectSchema: {
    mode: string;
    data_type: string;
    columns: ObjectColumnInput[];
  } | null = null;

  if (schemaMatch?.[1]) {
    try {
      const parsed = JSON.parse(schemaMatch[1]) as Record<string, unknown>;
      const rawColumns = Array.isArray(parsed.columns) ? parsed.columns : [];
      objectSchema = {
        mode: "table",
        data_type: String(parsed.data_type || ""),
        columns: rawColumns.map((column) => {
          const value = (column || {}) as Record<string, unknown>;
          return {
            heading: String(value.heading || ""),
            data_type: String(value.data_type || ""),
            description: String(value.description || "")
          };
        })
      };
    } catch {
      objectSchema = null;
    }
  }

  const baseDescription = description.replace(schemaPattern, "").replace(guidancePattern, "").trim();

  return {
    baseDescription,
    objectSchema
  };
}

export async function validateExtractRequest(
  request: Request,
  maxSourceFileBytes: number
): Promise<{ templateId: string; source: File; options: ExtractOptions }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Use multipart/form-data");
  }

  const form = await request.formData();
  const sourcePart = form.get("document");
  if (!(sourcePart instanceof File)) {
    throw new HttpError(400, "invalid_document", "document is required");
  }
  const { templateId, options } = validateExtractSubmissionMetadata({
    hasInlineFields: form.has("fields"),
    maxSourceFileBytes,
    optionsRaw: form.get("options"),
    sourceMimeType: sourcePart.type,
    sourceSize: sourcePart.size,
    templateIdRaw: form.get("template_id"),
  });

  return {
    templateId,
    source: sourcePart,
    options
  };
}

export function validateExtractSubmissionMetadata({
  hasInlineFields,
  maxSourceFileBytes,
  optionsRaw,
  sourceMimeType,
  sourceSize,
  templateIdRaw,
}: {
  hasInlineFields: boolean;
  maxSourceFileBytes: number;
  optionsRaw: FormDataEntryValue | null;
  sourceMimeType: string;
  sourceSize: number;
  templateIdRaw: FormDataEntryValue | null;
}): { templateId: string; options: ExtractOptions } {
  if (hasInlineFields) {
    throw new HttpError(400, "inline_fields_forbidden", "Inline fields are not allowed");
  }
  if (typeof templateIdRaw !== "string" || templateIdRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_template_id", "template_id is required");
  }
  if (!ALLOWED_MIME_TYPES.has(sourceMimeType)) {
    throw new HttpError(400, "invalid_document", `Unsupported Document MIME type: ${sourceMimeType}`);
  }
  if (sourceSize > maxSourceFileBytes) {
    throw new HttpError(400, "source_file_too_large", `Source file exceeds max size of ${maxSourceFileBytes} bytes`);
  }
  return {
    templateId: templateIdRaw.trim(),
    options: parseOptions(optionsRaw),
  };
}

function parseOptions(value: FormDataEntryValue | null): ExtractOptions {
  if (value === null) {
    return {};
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_options", "options must be a JSON string");
  }

  if (value.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(400, "invalid_options", "options must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new HttpError(400, "invalid_options", "options must be an object");
  }

  const obj = parsed as Record<string, unknown>;
  const options: ExtractOptions = {};

  if (obj.include_confidence !== undefined) {
    if (typeof obj.include_confidence !== "boolean") {
      throw new HttpError(400, "invalid_options", "include_confidence must be boolean");
    }
    options.include_confidence = obj.include_confidence;
  }

  if (obj.include_evidence !== undefined) {
    if (typeof obj.include_evidence !== "boolean") {
      throw new HttpError(400, "invalid_options", "include_evidence must be boolean");
    }
    options.include_evidence = obj.include_evidence;
  }

  return options;
}
