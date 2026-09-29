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

type TypedAnswer = { ok: boolean; value: unknown; normalized: string | null };

const INVALID: TypedAnswer = { ok: false, value: null, normalized: null };

export function normalizeModelResults(
  fields: FieldDefinition[],
  rawResults: ModelFieldResult[],
): NormalizedModelField[] {
  const rawByField = new Map(rawResults.map((row) => [row.field_id, row]));
  return fields.map((field) => normalizeSingle(field, rawByField.get(field.id)));
}

function normalizeSingle(field: FieldDefinition, raw?: ModelFieldResult): NormalizedModelField {
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

  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : null;
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

  const status = normalizeStatus(raw.status);
  return {
    field_id: field.id,
    status: status === "ok" ? "ok" : typed.value === null ? "not_found" : status,
    answer: typed.value,
    normalized_value: typed.normalized,
    confidence,
    evidence,
  };
}

function normalizeStatus(input: string): NormalizedModelField["status"] {
  return input === "ok" || input === "not_found" || input === "invalid_type" || input === "unreadable"
    ? input
    : "error";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeByType(dataType: DataType, value: unknown): TypedAnswer {
  if (value === null || value === undefined) return { ok: true, value: null, normalized: null };

  switch (dataType) {
    case "string":
      return typeof value === "string" ? { ok: true, value, normalized: value } : INVALID;
    case "number": {
      const text = typeof value === "string" ? value.trim() : "";
      const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text);
      // Currency prefixes and comma thousands groups are accepted only as a
      // complete format; never strip arbitrary text into a different number.
      const amount = /^[+-]?[$£€]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text);
      const num = typeof value === "number"
        ? value
        : decimal || amount ? Number(text.replace(/[$£€,]/g, "")) : Number.NaN;
      return Number.isFinite(num) ? { ok: true, value: num, normalized: String(num) } : INVALID;
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value, normalized: String(value) };
      const lower = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (lower === "true" || lower === "yes") return { ok: true, value: true, normalized: "true" };
      if (lower === "false" || lower === "no") return { ok: true, value: false, normalized: "false" };
      return INVALID;
    }
    case "date": {
      const formatted = typeof value === "string" ? formatDateAnswer(value) : null;
      return formatted ? { ok: true, value: formatted, normalized: formatted } : INVALID;
    }
    case "object":
      return isPlainObject(value) ? { ok: true, value, normalized: null } : INVALID;
    case "array":
      return Array.isArray(value) ? { ok: true, value, normalized: null } : INVALID;
    case "array<object>":
      if (Array.isArray(value) && value.every(isPlainObject)) return { ok: true, value, normalized: null };
      // Table fields are requested as { columns, rows } under structured output.
      if (isPlainObject(value) && Array.isArray(value.rows) && value.rows.every(isPlainObject)) {
        return { ok: true, value, normalized: null };
      }
      return INVALID;
    default:
      return INVALID;
  }
}

function formatDateAnswer(value: string): string | null {
  const raw = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}
