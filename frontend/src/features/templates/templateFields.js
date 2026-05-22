export const DATA_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
  "array<object>",
];

export const OBJECT_SCHEMA_DATA_TYPES = ["string", "number", "boolean", "date"];

const OBJECT_GUIDANCE_START = "[[OBJECT_TABLE_GUIDANCE]]";
const OBJECT_GUIDANCE_END = "[[/OBJECT_TABLE_GUIDANCE]]";
const OBJECT_SCHEMA_START = "[[OBJECT_SCHEMA]]";
const OBJECT_SCHEMA_END = "[[/OBJECT_SCHEMA]]";

export const EMPTY_OBJECT_COLUMN = {
  key: "",
  heading: "",
  data_type: "string",
  description: "",
};

export const EMPTY_FIELD = {
  id: "",
  name: "",
  description: "",
  data_type: "string",
  required: false,
};

function normalizeFields(fields, options = {}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("Add at least one field");
  }

  const ids = new Set();
  const names = new Set();

  return fields.map((field, index) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw new Error(`Field ${index + 1}: must be an object`);
    }

    const name = normalizeFieldName(field.name);
    const id = toFieldId(name);
    const description = String(field.description || "").trim();
    const dataType = normalizeDataType(field.data_type);
    const required = Boolean(field.required);
    const { baseDescription, objectSchema: descriptionObjectSchema } =
      extractObjectMetadata(description);
    const objectSchema = isObjectLikeType(dataType)
      ? normalizeObjectSchema(field.object_schema || descriptionObjectSchema)
      : null;

    if (!name) {
      throw new Error(`Field ${index + 1}: name is required`);
    }
    if (!id) {
      throw new Error(
        `Field ${index + 1}: name must include letters or numbers`,
      );
    }
    if (!baseDescription) {
      throw new Error(`Field ${index + 1}: description is required`);
    }
    if (!DATA_TYPES.includes(dataType)) {
      throw new Error(`Field ${index + 1}: unsupported type \"${dataType}\"`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate field ID: ${id}`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate field name: ${name}`);
    }

    ids.add(id);
    names.add(name);

    const objectColumns = objectSchema
      ? validateObjectColumns(objectSchema.columns, index)
      : null;
    const finalDescription = objectColumns
      ? appendObjectMetadata(baseDescription, objectColumns, dataType)
      : baseDescription;

    const normalizedField = {
      name,
      description: finalDescription,
      data_type: dataType,
      required,
    };

    if (options.includeFieldIds) {
      normalizedField.id = id;
    }

    if (options.includeObjectSchema && objectColumns) {
      normalizedField.object_schema = {
        mode: "table",
        columns: objectColumns.map(({ heading, data_type, description }) => ({
          heading,
          data_type,
          description,
        })),
      };
    }

    return normalizedField;
  });
}

export function isObjectLikeType(dataType) {
  const normalized = normalizeDataType(dataType);
  return normalized === "object" || normalized === "array<object>";
}

export function normalizeDataType(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^array\s*<\s*object\s*>$/i.test(raw)) {
    return "array<object>";
  }

  const lowered = raw.toLowerCase();
  if (DATA_TYPES.includes(lowered)) {
    return lowered;
  }

  return raw;
}

export function sanitizeFieldName(value) {
  return String(value || "").replace(/[^a-zA-Z0-9 ]+/g, "");
}

function normalizeFieldName(value) {
  return sanitizeFieldName(value).trim().replace(/\s+/g, " ");
}

export function toFieldId(name) {
  return normalizeFieldName(name).toLowerCase().replace(/\s+/g, "_");
}

export function normalizeObjectSchema(schema) {
  const rawColumns = Array.isArray(schema?.columns) ? schema.columns : [];
  const columns = rawColumns.map((column) => ({
    heading: sanitizeFieldName(String(column?.heading || "")).replace(
      /\s+/g,
      " ",
    ),
    key: toFieldId(String(column?.heading || "")),
    data_type: OBJECT_SCHEMA_DATA_TYPES.includes(String(column?.data_type || ""))
      ? String(column.data_type)
      : "string",
    description: String(column?.description || ""),
  }));

  return {
    mode: "table",
    columns,
  };
}

function validateObjectColumns(columns, fieldIndex) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(
      `Field ${fieldIndex + 1}: object fields require at least one table column`,
    );
  }

  const keys = new Set();
  const normalized = columns.map((column, columnIndex) => {
    const heading = String(column.heading || "").trim();
    const key = toFieldId(heading);
    const description = String(column.description || "").trim();
    const dataType = String(column.data_type || "").trim();

    if (!heading) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading is required`,
      );
    }
    if (!key) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: heading must include letters or numbers`,
      );
    }
    if (!OBJECT_SCHEMA_DATA_TYPES.includes(dataType)) {
      throw new Error(
        `Field ${fieldIndex + 1}, column ${columnIndex + 1}: unsupported column type`,
      );
    }
    if (keys.has(key)) {
      throw new Error(
        `Field ${fieldIndex + 1}: duplicate object column heading "${heading}"`,
      );
    }

    keys.add(key);

    return {
      key,
      heading,
      data_type: dataType,
      description,
    };
  });

  return normalized;
}

function appendObjectMetadata(baseDescription, columns, dataType) {
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

function extractObjectMetadata(description) {
  const raw = String(description || "");
  const schemaPattern =
    /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/;
  const guidancePattern =
    /\[\[OBJECT_TABLE_GUIDANCE\]\][\s\S]*?\[\[\/OBJECT_TABLE_GUIDANCE\]\]\s*/g;

  const schemaMatch = raw.match(schemaPattern);
  let objectSchema = null;

  if (schemaMatch?.[1]) {
    try {
      const parsed = JSON.parse(schemaMatch[1]);
      objectSchema = normalizeObjectSchema(parsed);
    } catch {
      objectSchema = null;
    }
  }

  const baseDescription = raw
    .replace(schemaPattern, "")
    .replace(guidancePattern, "")
    .trim();

  return {
    baseDescription,
    objectSchema,
  };
}

export function hydrateFieldFromTemplate(field) {
  const { baseDescription, objectSchema } = extractObjectMetadata(
    field.description,
  );
  const sanitizedName = normalizeFieldName(field.name);
  const normalizedDataType = normalizeDataType(field.data_type);

  return {
    ...field,
    id: toFieldId(sanitizedName),
    name: sanitizedName,
    description: baseDescription,
    data_type: normalizedDataType || "string",
    required: Boolean(field.required),
    ...(objectSchema ? { object_schema: objectSchema } : {}),
  };
}

export function validateTemplateJsonPayload(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Template JSON must be an object");
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new Error("Template name is required");
  }

  if (
    input.description !== undefined &&
    input.description !== null &&
    typeof input.description !== "string"
  ) {
    throw new Error("Template description must be a string");
  }

  return {
    name: input.name.trim(),
    description:
      input.description === null ? null : String(input.description || "").trim(),
    fields: normalizeFields(input.fields, options),
  };
}

export function serializeTemplatePayload(payload) {
  return JSON.stringify(validateTemplateJsonPayload(payload));
}
