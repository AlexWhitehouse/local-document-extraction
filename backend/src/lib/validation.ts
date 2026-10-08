import {
  isString,
  isNumber,
  isBoolean,
  isJsonObject,
  isJsonArray,
  parseJson,
  type JsonValue,
} from "../../../shared/json";
import { diagnoseTemplateDraft } from "../../../shared/templateDiagnostics";
import {
  OBJECT_GUIDANCE_END,
  OBJECT_GUIDANCE_START,
  OBJECT_SCHEMA_END,
  OBJECT_SCHEMA_START,
  readObjectSchemaBlock,
  stripObjectMarkers,
} from "../../../shared/templateMarkers";
import { normalizeTemplateTags } from "../../../shared/templateTags";
import { HttpError } from "./http";
import type { DataType, FieldDefinition } from "./types";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

const OBJECT_SCHEMA_DATA_TYPES: ReadonlySet<DataType> = new Set(["string", "number", "boolean", "date"]);

export const MAX_TEMPLATE_OBJECT_COLUMNS = 20;

type ObjectColumnInput = {
  heading: string;
  data_type: string;
  description: string;
};

type ObjectSchemaInput = {
  data_type: string;
  columns: ObjectColumnInput[];
};

export function parseJsonBody(body: string): JsonValue {
  try {
    return parseJson(body);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

type ValidatedTemplate = { name?: string; description?: string | null; fields?: FieldDefinition[]; tags?: string[] };

function isDataType(value: JsonValue | undefined): value is DataType {
  return (
    value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "date" ||
    value === "object" ||
    value === "array" ||
    value === "array<object>"
  );
}

export function validateTemplatePayload(input: JsonValue | undefined, allowPartial = false) {
  const diagnostics = diagnoseTemplateDraft(input, { allowPartial });

  if (diagnostics.length) {
    const first = diagnostics[0]!;

    const code =
      first.code === "template.name_required"
        ? "invalid_name"
        : first.code === "template.description_invalid"
          ? "invalid_description"
          : "invalid_fields";

    throw Object.assign(new HttpError(400, code, first.title), { diagnostics });
  }

  if (!isJsonObject(input)) throw new HttpError(400, "invalid_fields", "Template JSON must be an object");
  const output: ValidatedTemplate = {};

  if (input.tags !== undefined) {
    try {
      output.tags = normalizeTemplateTags(input.tags);
    } catch (error) {
      throw new HttpError(400, "invalid_tags", error instanceof Error ? error.message : "Invalid template tags");
    }
  }

  if (input.name !== undefined) {
    if (!isString(input.name) || input.name.trim().length === 0) {
      throw new HttpError(400, "invalid_name", "Template name is required");
    }

    output.name = input.name.trim();
  } else if (!allowPartial) {
    throw new HttpError(400, "invalid_name", "Template name is required");
  }

  if (input.description !== undefined) {
    if (input.description === null) {
      output.description = null;
    } else if (isString(input.description)) {
      output.description = input.description.trim();
    } else {
      throw new HttpError(400, "invalid_description", "Template description must be a string");
    }
  }

  if (input.fields !== undefined) {
    if (!isJsonArray(input.fields)) {
      throw new HttpError(400, "invalid_fields", "fields must be an array");
    }

    if (input.fields.length === 0 || input.fields.length > 50) {
      throw new HttpError(400, "invalid_fields", "fields must contain 1 to 50 items");
    }

    const ids = new Set<string>();
    const names = new Set<string>();
    output.fields = input.fields.map((item, index) => {
      if (!isJsonObject(item)) throw new HttpError(400, "invalid_fields", `Field ${index + 1} must be an object`);
      const field = item;
      const name = normalizeFieldName(field.name);
      const id = toFieldId(name);
      const description = isString(field.description) ? field.description.trim() : "";
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

      if (!isDataType(dataType)) {
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
        data_type: dataType,
      };
    });

    const tableFieldCount = output.fields.filter(
      (field) => field.data_type === "object" || field.data_type === "array<object>",
    ).length;

    if (tableFieldCount > 1) {
      throw new HttpError(400, "invalid_fields", "A Template may contain at most one table-shaped Template field");
    }
  } else if (!allowPartial) {
    throw new HttpError(400, "invalid_fields", "fields are required");
  }

  if (
    allowPartial &&
    output.name === undefined &&
    output.description === undefined &&
    output.fields === undefined &&
    output.tags === undefined
  ) {
    throw new HttpError(400, "empty_patch", "PATCH body must include at least one field");
  }

  return output;
}

function normalizeFieldName(value: JsonValue | undefined): string {
  return isString(value)
    ? value
        .replace(/[^a-zA-Z0-9 ]+/g, "")
        .trim()
        .replace(/\s+/g, " ")
    : "";
}

function toFieldId(name: string): string {
  return normalizeFieldName(name).toLowerCase().replace(/\s+/g, "_");
}

function normalizeObjectMetadata(
  description: string,
  schemaInput: JsonValue | undefined,
  fieldIndex: number,
  fieldDataType: "object" | "array<object>",
): string {
  const { baseDescription, objectSchema: descriptionObjectSchema } = extractObjectMetadata(description);
  const objectSchema = normalizeObjectSchemaInput(schemaInput) || descriptionObjectSchema;

  if (!objectSchema) {
    return baseDescription;
  }

  const fieldError = (message: string) => new HttpError(400, "invalid_fields", `Field ${fieldIndex + 1}${message}`);

  if (objectSchema.columns.length === 0) {
    throw fieldError(": object fields require at least one table column");
  }

  if (objectSchema.columns.length > MAX_TEMPLATE_OBJECT_COLUMNS) {
    throw fieldError(`: object fields may contain at most ${MAX_TEMPLATE_OBJECT_COLUMNS} table columns`);
  }

  if (objectSchema.data_type && objectSchema.data_type !== fieldDataType) {
    throw fieldError(": object schema data_type must match field data_type");
  }

  const normalizedColumns = objectSchema.columns.map((column, columnIndex) => {
    const columnError = (message: string) => fieldError(`, column ${columnIndex + 1}: ${message}`);
    const heading = normalizeFieldName(column.heading);
    const rawHeading = column.heading.trim();
    const dataType = column.data_type.trim();
    const key = toFieldId(heading);

    if (!rawHeading) throw columnError("heading is required");

    if (!heading) throw columnError("heading must include letters or numbers");

    if (heading !== rawHeading) throw columnError("heading contains unsupported characters");

    if (!key) throw columnError("key must include letters or numbers");

    if (!isDataType(dataType) || !OBJECT_SCHEMA_DATA_TYPES.has(dataType)) throw columnError("unsupported column type");

    return { key, heading, data_type: dataType, description: column.description.trim() };
  });

  const seenKeys = new Set<string>();

  for (const [columnIndex, column] of normalizedColumns.entries()) {
    if (seenKeys.has(column.key)) {
      throw fieldError(`: duplicate object column key "${column.key}"`);
    }

    seenKeys.add(column.key);

    if (!column.description) {
      throw fieldError(`, column ${columnIndex + 1}: description is required`);
    }
  }

  return appendObjectMetadata(baseDescription, normalizedColumns, fieldDataType);
}

function normalizeObjectSchemaInput(value: JsonValue | undefined): ObjectSchemaInput | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const schema = value;
  const rawColumns = isJsonArray(schema.columns) ? schema.columns : [];

  return {
    data_type: String(schema.data_type || ""),
    columns: rawColumns.map((column) => {
      const item = isJsonObject(column) ? column : {};

      return {
        heading: String(item.heading || ""),
        data_type: String(item.data_type || ""),
        description: String(item.description || ""),
      };
    }),
  };
}

function appendObjectMetadata(
  baseDescription: string,
  columns: Array<{ key: string; heading: string; data_type: string; description: string }>,
  dataType: string,
): string {
  const schema = {
    mode: "table",
    data_type: dataType,
    columns,
  };

  const compactColumns = columns.map((column) => ({
    key: column.key,
    heading: column.heading,
    type: column.data_type,
  }));

  const guidance = [
    "Return this field in table form with `columns` and `rows`.",
    "Use `columns` as the heading list in order.",
    "Use `rows` as objects that include every column key.",
    "If a row value is missing, set the value to null.",
    "Preserve row order from the source document.",
    `Expected columns: ${JSON.stringify(compactColumns)}`,
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
    OBJECT_SCHEMA_END,
  ].join("\n");
}

function extractObjectMetadata(description: string) {
  const schemaJson = readObjectSchemaBlock(description);
  let objectSchema: ObjectSchemaInput | null = null;

  if (schemaJson) {
    try {
      const parsed = parseJson(schemaJson);

      if (!isJsonObject(parsed))
        return {
          baseDescription: stripObjectMarkers(description),
          objectSchema: null,
        };
      objectSchema = normalizeObjectSchemaInput({
        data_type: parsed.data_type,
        columns: parsed.columns,
      });
    } catch {
      objectSchema = null;
    }
  }

  const baseDescription = stripObjectMarkers(description);

  return {
    baseDescription,
    objectSchema,
  };
}

export async function validateExtractRequest(
  request: Request,
  maxSourceFileBytes: number,
): Promise<ExtractSubmissionMetadata & { source: File }> {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Use multipart/form-data");
  }

  const form = await request.formData();

  for (const field of ["template_id", "template_tags", "pages", "document", "options"]) {
    if (form.getAll(field).length > 1)
      throw new HttpError(400, "invalid_multipart", `Duplicate multipart field: ${field}`);
  }

  for (const field of ["enable_smart_splitting", "exclude_blank_pages", "smart_split"]) {
    if (form.has(field))
      throw new HttpError(400, "invalid_options", "Document processing policy is configured in workspace settings");
  }

  const sourcePart = form.get("document");

  if (!(sourcePart instanceof File)) {
    throw new HttpError(400, "invalid_document", "document is required");
  }

  const metadata = validateExtractSubmissionMetadata({
    hasInlineFields: form.has("fields"),
    maxSourceFileBytes,
    optionsRaw: form.get("options"),
    sourceMimeType: sourcePart.type,
    sourceSize: sourcePart.size,
    templateIdRaw: form.get("template_id"),
    templateTagsRaw: form.get("template_tags"),
    pagesRaw: form.get("pages"),
  });

  return { ...metadata, source: sourcePart };
}

export type ExtractSubmissionMetadata = { templateId: string | null; templateTags: string[]; pages: number[] | null };

export function validateExtractSubmissionMetadata({
  hasInlineFields,
  maxSourceFileBytes,
  optionsRaw,
  sourceMimeType,
  sourceSize,
  templateIdRaw,
  templateTagsRaw = null,
  pagesRaw = null,
}: {
  hasInlineFields: boolean;
  maxSourceFileBytes: number;
  optionsRaw: FormDataEntryValue | null;
  sourceMimeType: string;
  sourceSize: number;
  templateIdRaw: FormDataEntryValue | null;
  templateTagsRaw?: FormDataEntryValue | null;
  pagesRaw?: FormDataEntryValue | null;
}): ExtractSubmissionMetadata {
  if (hasInlineFields) {
    throw new HttpError(400, "inline_fields_forbidden", "Inline fields are not allowed");
  }

  if (templateIdRaw !== null && (!isString(templateIdRaw) || !templateIdRaw.trim())) {
    throw new HttpError(400, "invalid_template_id", "template_id must be a nonempty string");
  }

  validateSourceFileMetadata(sourceMimeType, sourceSize, maxSourceFileBytes);
  validateOptions(optionsRaw);
  const templateTags = validateExtractTemplateTags(templateTagsRaw);
  const templateId = isString(templateIdRaw) ? templateIdRaw.trim() : null;

  if (!templateId && !templateTags.length)
    throw new HttpError(400, "invalid_template_id", "Provide template_id or a nonempty template_tags array");
  let pages: number[] | null = null;

  if (pagesRaw !== null) {
    if (sourceMimeType !== "application/pdf")
      throw new HttpError(400, "invalid_pages", "Page selection is supported only for PDFs");

    try {
      const parsed = isString(pagesRaw) ? parseJson(pagesRaw) : null;

      if (
        !isJsonArray(parsed) ||
        !parsed.length ||
        parsed.length > 10000 ||
        parsed.some((page) => !isNumber(page) || !Number.isSafeInteger(page) || page < 1) ||
        new Set(parsed).size !== parsed.length
      )
        throw new Error();

      if (!parsed.every(isNumber)) throw new Error();
      pages = parsed.sort((a, b) => a - b);
    } catch {
      throw new HttpError(
        400,
        "invalid_pages",
        "pages must be a nonempty JSON array of unique positive physical page numbers",
      );
    }
  }

  return { templateId, templateTags, pages };
}

/** Normalize the explicit tag scope; unknown names never broaden template selection. */
function validateExtractTemplateTags(value: FormDataEntryValue | null): string[] {
  if (value === null) return [];

  if (!isString(value)) throw new HttpError(400, "invalid_template_tags", "template_tags must be a JSON string array");
  let parsed: JsonValue | undefined;

  try {
    parsed = parseJson(value);
  } catch {
    throw new HttpError(400, "invalid_template_tags", "template_tags must be valid JSON");
  }

  try {
    return normalizeTemplateTags(parsed);
  } catch (error) {
    throw new HttpError(400, "invalid_template_tags", error instanceof Error ? error.message : "Invalid template tags");
  }
}

/** `options` is part of the documented API contract; the pipeline does not read it, but malformed values are rejected. */
function validateOptions(value: FormDataEntryValue | null): void {
  if (value === null) return;

  if (!isString(value)) {
    throw new HttpError(400, "invalid_options", "options must be a JSON string");
  }

  if (value.trim().length === 0) return;

  let parsed: JsonValue | undefined;

  try {
    parsed = parseJson(value);
  } catch {
    throw new HttpError(400, "invalid_options", "options must be valid JSON");
  }

  if (!isJsonObject(parsed) && !isJsonArray(parsed)) {
    throw new HttpError(400, "invalid_options", "options must be an object");
  }

  for (const name of ["enable_smart_splitting", "exclude_blank_pages", "smart_split"]) {
    if (name in parsed)
      throw new HttpError(400, "invalid_options", "Document processing policy is configured in workspace settings");
  }

  for (const name of ["include_confidence", "include_evidence"]) {
    const option = isJsonObject(parsed) ? parsed[name] : undefined;

    if (option !== undefined && !isBoolean(option)) {
      throw new HttpError(400, "invalid_options", `${name} must be boolean`);
    }
  }
}

export function validateSourceFileMetadata(
  sourceMimeType: string,
  sourceSize: number,
  maxSourceFileBytes: number,
): void {
  if (!ALLOWED_MIME_TYPES.has(sourceMimeType)) {
    throw new HttpError(400, "invalid_document", `Unsupported Document MIME type: ${sourceMimeType}`);
  }

  if (sourceSize > maxSourceFileBytes) {
    throw new HttpError(400, "source_file_too_large", `Source file exceeds max size of ${maxSourceFileBytes} bytes`);
  }
}
