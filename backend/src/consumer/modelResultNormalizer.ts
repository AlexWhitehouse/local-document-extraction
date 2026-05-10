import type { DataType, FieldDefinition } from "../lib/types";

export type ModelFieldResult = {
  field_id: string;
  status: string;
  answer: unknown;
  confidence?: number | null;
  evidence?: string | null;
};

export type NormalizedModelField = {
  field_id: string;
  status: "ok" | "not_found" | "invalid_type" | "unreadable" | "error";
  answer: unknown;
  normalized_value: string | null;
  confidence: number | null;
  evidence: string | null;
};

export function normalizeModelResults(
  fields: FieldDefinition[],
  rawResults: ModelFieldResult[],
): NormalizedModelField[] {
  const rawByField = new Map<string, ModelFieldResult>();
  for (const row of rawResults) {
    if (typeof row.field_id === "string") {
      rawByField.set(row.field_id, row);
    }
  }

  return fields.map((field) =>
    normalizeSingle(field, rawByField.get(field.id)),
  );
}

function normalizeSingle(
  field: FieldDefinition,
  raw?: ModelFieldResult,
): NormalizedModelField {
  if (!raw) {
    return {
      field_id: field.id,
      status: "not_found",
      answer: null,
      normalized_value: null,
      confidence: null,
      evidence: null,
    };
  }

  const safeStatus = normalizeStatus(raw.status);
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? raw.confidence
      : null;
  const evidence = typeof raw.evidence === "string" ? raw.evidence : null;

  const typed = normalizeByType(field.data_type, raw.answer);
  if (!typed.ok) {
    return {
      field_id: field.id,
      status: "invalid_type",
      answer: raw.answer ?? null,
      normalized_value: null,
      confidence,
      evidence,
    };
  }

  return {
    field_id: field.id,
    status:
      safeStatus === "ok"
        ? "ok"
        : typed.value === null
          ? "not_found"
          : safeStatus,
    answer: typed.value,
    normalized_value: typed.normalized,
    confidence,
    evidence,
  };
}

function normalizeStatus(
  input: string,
): "ok" | "not_found" | "invalid_type" | "unreadable" | "error" {
  if (
    input === "ok" ||
    input === "not_found" ||
    input === "invalid_type" ||
    input === "unreadable"
  ) {
    return input;
  }
  return "error";
}

function normalizeByType(
  dataType: DataType,
  value: unknown,
): { ok: boolean; value: unknown; normalized: string | null } {
  if (value === null || value === undefined) {
    return { ok: true, value: null, normalized: null };
  }

  switch (dataType) {
    case "string":
      return typeof value === "string"
        ? { ok: true, value, normalized: value }
        : { ok: false, value: null, normalized: null };
    case "number": {
      const num =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value.replace(/[^\d.-]/g, ""))
            : Number.NaN;
      return Number.isFinite(num)
        ? { ok: true, value: num, normalized: String(num) }
        : { ok: false, value: null, normalized: null };
    }
    case "boolean": {
      if (typeof value === "boolean")
        return { ok: true, value, normalized: String(value) };
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true" || lower === "yes")
          return { ok: true, value: true, normalized: "true" };
        if (lower === "false" || lower === "no")
          return { ok: true, value: false, normalized: "false" };
      }
      return { ok: false, value: null, normalized: null };
    }
    case "date": {
      if (typeof value !== "string")
        return { ok: false, value: null, normalized: null };
      const formatted = formatDateAnswer(value);
      if (!formatted)
        return { ok: false, value: null, normalized: null };
      return { ok: true, value: formatted, normalized: formatted };
    }
    case "object": {
      const ok =
        typeof value === "object" && value !== null && !Array.isArray(value);
      return ok
        ? { ok: true, value, normalized: null }
        : { ok: false, value: null, normalized: null };
    }
    case "array": {
      return Array.isArray(value)
        ? { ok: true, value, normalized: null }
        : { ok: false, value: null, normalized: null };
    }
    case "array<object>": {
      if (
        Array.isArray(value) &&
        value.every(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
      ) {
        return { ok: true, value, normalized: null };
      }

      const tableRows = extractRowsFromTableObject(value);
      if (tableRows) {
        return {
          ok: true,
          value: {
            ...(value as Record<string, unknown>),
            rows: tableRows,
          },
          normalized: null,
        };
      }

      return { ok: false, value: null, normalized: null };
    }
    default:
      return { ok: false, value: null, normalized: null };
  }
}

function formatDateAnswer(value: string): string | null {
  const raw = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    return raw;
  }

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function extractRowsFromTableObject(value: unknown): Array<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const rows = (value as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) {
    return null;
  }

  const validRows = rows.every(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );

  if (!validRows) {
    return null;
  }

  return rows as Array<Record<string, unknown>>;
}
