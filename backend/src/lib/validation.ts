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

type TemplateInput = {
  name?: unknown;
  description?: unknown;
  fields?: unknown;
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
      const required = Boolean(field.required);

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
        description,
        data_type: dataType as DataType,
        required
      };
    });
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

export async function validateExtractRequest(
  request: Request,
  maxImageBytes: number
): Promise<{ templateId: string; source: File; options: ExtractOptions }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    throw new HttpError(415, "unsupported_media_type", "Use multipart/form-data");
  }

  const form = await request.formData();
  if (form.has("fields")) {
    throw new HttpError(400, "inline_fields_forbidden", "Inline fields are not allowed");
  }

  const templateIdRaw = form.get("template_id");
  if (typeof templateIdRaw !== "string" || templateIdRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_template_id", "template_id is required");
  }

  const sourcePart = form.get("image") ?? form.get("file") ?? form.get("document");
  if (!(sourcePart instanceof File)) {
    throw new HttpError(400, "invalid_image", "image, file, or document is required");
  }

  if (!ALLOWED_MIME_TYPES.has(sourcePart.type)) {
    throw new HttpError(400, "invalid_image", `Unsupported file MIME type: ${sourcePart.type}`);
  }

  if (sourcePart.size > maxImageBytes) {
    throw new HttpError(400, "image_too_large", `File exceeds max size of ${maxImageBytes} bytes`);
  }

  const optionsRaw = form.get("options");
  const options = parseOptions(optionsRaw);

  return {
    templateId: templateIdRaw.trim(),
    source: sourcePart,
    options
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
