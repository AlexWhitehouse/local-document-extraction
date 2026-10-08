import { isBoolean, isJsonArray, isJsonObject, isNumber, isString, type JsonObject, type JsonValue } from "./json";

/**
 * Evaluation evidence for Template assistance: the failing fields of one Evaluation candidate,
 * each with the candidate's extracted value and the user-verified Expected answer it missed.
 * The browser builds it from verified answers only; the server re-validates the whole shape.
 */
export const EVALUATION_EVIDENCE_LIMITS = Object.freeze({
  bytes: 131_072,
  documents: 50,
  failuresPerDocument: 100,
  cellsPerField: 40,
  rowsPerList: 100,
  valueCharacters: 1_000,
  nameCharacters: 255,
  labelCharacters: 300,
});

export const SCORED_EVIDENCE_TYPES = ["string", "number", "boolean", "date", "array<object>"] as const;

type ScoredType = (typeof SCORED_EVIDENCE_TYPES)[number];

type Scalar = string | number | boolean | null;

type Accuracy = { matched: number; total: number };

export type EvaluationCellEvidence = {
  row: number;
  column: string;
  expected: Scalar;
  expected_absent: boolean;
  extracted: Scalar;
};

export type EvaluationTableEvidence = Accuracy & {
  mismatches: EvaluationCellEvidence[];
  omitted_mismatches: number;
  missing_rows: number[];
  extra_rows: number[];
};

export type EvaluationFailure = {
  field_id: string;
  field_name: string;
  data_type: ScoredType;
  verdict: "Mismatch";
  expected_verified: true;
  extracted_status: string | null;
  extracted: Scalar;
  expected: Scalar;
  expected_absent: boolean;
  cells: EvaluationTableEvidence | null;
};

export type EvaluationDocumentEvidence = { name: string; accuracy: Accuracy; failures: EvaluationFailure[] };

export type EvaluationCandidateIdentity = {
  label: string;
  model: string;
  template_name: string;
  template_id: string | null;
  template_version: number | null;
  modified: boolean;
};

export type EvaluationEvidence = {
  candidate: EvaluationCandidateIdentity;
  accuracy: Accuracy;
  documents: EvaluationDocumentEvidence[];
  omitted: { documents: number; failures: number };
  sample_document: string | null;
};

export class EvaluationEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationEvidenceError";
  }
}

function fail(message: string): never {
  throw new EvaluationEvidenceError(message);
}

const encodedBytes = (value: JsonValue) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

// Scoring adds properties such as ratio; evidence carries only the counts the server accepts.
const counts = ({ matched, total }: Accuracy): Accuracy => ({ matched, total });

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Long answers keep their opening text; non-scalar answers become capped JSON text. */
export function evidenceValue(value: JsonValue | undefined): Scalar {
  if (value === undefined || value === null || isNumber(value) || isBoolean(value)) return value ?? null;

  return cap(isString(value) ? value : JSON.stringify(value), EVALUATION_EVIDENCE_LIMITS.valueCharacters);
}

function capFailure(failure: EvaluationFailure): EvaluationFailure {
  const next: EvaluationFailure = {
    ...failure,
    field_name: cap(failure.field_name, EVALUATION_EVIDENCE_LIMITS.nameCharacters),
    extracted: evidenceValue(failure.extracted),
    expected: evidenceValue(failure.expected),
  };

  if (failure.cells) {
    const kept = failure.cells.mismatches.slice(0, EVALUATION_EVIDENCE_LIMITS.cellsPerField);

    next.cells = {
      ...failure.cells,
      mismatches: kept.map((cell) => ({
        ...cell,
        column: cap(cell.column, EVALUATION_EVIDENCE_LIMITS.nameCharacters),
        expected: evidenceValue(cell.expected),
        extracted: evidenceValue(cell.extracted),
      })),
      omitted_mismatches: failure.cells.omitted_mismatches + failure.cells.mismatches.length - kept.length,
      missing_rows: failure.cells.missing_rows.slice(0, EVALUATION_EVIDENCE_LIMITS.rowsPerList),
      extra_rows: failure.cells.extra_rows.slice(0, EVALUATION_EVIDENCE_LIMITS.rowsPerList),
    };
  }

  return next;
}

/**
 * Caps values, documents and failures, then removes failures from the end (last document first)
 * until the evidence fits the byte budget. The same input always produces the same evidence.
 */
export function buildEvaluationEvidence(
  candidate: EvaluationCandidateIdentity,
  accuracy: Accuracy,
  documents: EvaluationDocumentEvidence[],
  sampleDocument: string | null = null,
): EvaluationEvidence {
  const failing = documents.filter((document) => document.failures.length);
  const kept = failing.slice(0, EVALUATION_EVIDENCE_LIMITS.documents);
  let omittedFailures = 0;

  for (const document of failing.slice(EVALUATION_EVIDENCE_LIMITS.documents))
    omittedFailures += document.failures.length;

  const evidence: EvaluationEvidence = {
    candidate: {
      ...candidate,
      label: cap(candidate.label, EVALUATION_EVIDENCE_LIMITS.labelCharacters),
      model: cap(candidate.model, EVALUATION_EVIDENCE_LIMITS.nameCharacters),
      template_name: cap(candidate.template_name, EVALUATION_EVIDENCE_LIMITS.labelCharacters),
    },
    accuracy: counts(accuracy),
    documents: kept.map((document) => {
      omittedFailures += Math.max(0, document.failures.length - EVALUATION_EVIDENCE_LIMITS.failuresPerDocument);

      return {
        name: cap(document.name, EVALUATION_EVIDENCE_LIMITS.nameCharacters),
        accuracy: counts(document.accuracy),
        failures: document.failures.slice(0, EVALUATION_EVIDENCE_LIMITS.failuresPerDocument).map(capFailure),
      };
    }),
    omitted: { documents: failing.length - kept.length, failures: omittedFailures },
    sample_document: sampleDocument === null ? null : cap(sampleDocument, EVALUATION_EVIDENCE_LIMITS.nameCharacters),
  };

  // Sizes are measured once per failure; the final encode below corrects any separator rounding.
  const sizes = evidence.documents.map((document) => document.failures.map((failure) => encodedBytes(failure) + 1));
  let total = encodedBytes(evidence);

  const dropLast = () => {
    const index = evidence.documents.length - 1;
    const document = evidence.documents[index]!;
    document.failures.pop();
    total -= sizes[index]!.pop() ?? 0;
    evidence.omitted.failures += 1;

    if (!document.failures.length) {
      evidence.documents.pop();
      sizes.pop();
      evidence.omitted.documents += 1;
    }
  };

  while (total > EVALUATION_EVIDENCE_LIMITS.bytes && evidence.documents.length) dropLast();

  while (encodedBytes(evidence) > EVALUATION_EVIDENCE_LIMITS.bytes && evidence.documents.length) dropLast();

  return evidence;
}

function record(value: JsonValue | undefined, label: string, keys: readonly string[]): JsonObject {
  if (!isJsonObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail(`${label} must be an object`);

  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label} has unsupported property “${key}”`);

  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);

  return value;
}

function text(value: JsonValue | undefined, label: string, max: number, allowEmpty = false): string {
  if (!isString(value) || (!allowEmpty && !value.trim()) || value.length > max)
    fail(`${label} must be ${allowEmpty ? "text" : "non-empty text"} of at most ${max} characters`);

  return value;
}

function count(value: JsonValue | undefined, label: string, minimum = 0): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < minimum) fail(`${label} must be a whole number`);

  return value;
}

function accuracy(value: JsonValue | undefined, label: string): Accuracy {
  const entry = record(value, label, ["matched", "total"]);

  const matched = count(entry.matched, `${label}.matched`),
    total = count(entry.total, `${label}.total`);

  if (matched > total) fail(`${label}.matched cannot exceed ${label}.total`);

  return { matched, total };
}

function scalar(value: JsonValue | undefined, label: string): Scalar {
  if (value === null || isNumber(value) || isBoolean(value)) return value ?? null;

  return text(value, label, EVALUATION_EVIDENCE_LIMITS.valueCharacters, true);
}

function rows(value: JsonValue | undefined, label: string): number[] {
  if (!isJsonArray(value) || value.length > EVALUATION_EVIDENCE_LIMITS.rowsPerList)
    fail(`${label} must list at most ${EVALUATION_EVIDENCE_LIMITS.rowsPerList} rows`);

  return value.map((row) => count(row, label, 1));
}

function isScoredType(value: JsonValue | undefined): value is ScoredType {
  return SCORED_EVIDENCE_TYPES.some((type) => type === value);
}

function table(value: JsonValue | undefined): EvaluationTableEvidence {
  const cells = record(value, "failure.cells", [
    "matched",
    "total",
    "mismatches",
    "omitted_mismatches",
    "missing_rows",
    "extra_rows",
  ]);

  const matched = count(cells.matched, "failure.cells.matched"),
    total = count(cells.total, "failure.cells.total");

  if (matched > total) fail("failure.cells.matched cannot exceed failure.cells.total");

  if (!isJsonArray(cells.mismatches) || cells.mismatches.length > EVALUATION_EVIDENCE_LIMITS.cellsPerField)
    fail(`failure.cells.mismatches must list at most ${EVALUATION_EVIDENCE_LIMITS.cellsPerField} cells`);

  return {
    matched,
    total,
    mismatches: cells.mismatches.map((item) => {
      const cell = record(item, "mismatched cell", ["row", "column", "expected", "expected_absent", "extracted"]);

      if (!isBoolean(cell.expected_absent)) fail("mismatched cell.expected_absent must be a boolean");

      const expected = scalar(cell.expected, "mismatched cell.expected");

      if (cell.expected_absent && expected !== null) fail("An absent expected cell has no value");

      return {
        row: count(cell.row, "mismatched cell.row", 1),
        column: text(cell.column, "mismatched cell.column", EVALUATION_EVIDENCE_LIMITS.nameCharacters),
        expected,
        expected_absent: cell.expected_absent,
        extracted: scalar(cell.extracted, "mismatched cell.extracted"),
      };
    }),
    omitted_mismatches: count(cells.omitted_mismatches, "failure.cells.omitted_mismatches"),
    missing_rows: rows(cells.missing_rows, "failure.cells.missing_rows"),
    extra_rows: rows(cells.extra_rows, "failure.cells.extra_rows"),
  };
}

function failure(value: JsonValue | undefined): EvaluationFailure {
  const entry = record(value, "failure", [
    "field_id",
    "field_name",
    "data_type",
    "verdict",
    "expected_verified",
    "extracted_status",
    "extracted",
    "expected",
    "expected_absent",
    "cells",
  ]);

  const fieldId = text(entry.field_id, "failure.field_id", 160);

  if (!/^[a-zA-Z0-9_.-]+$/.test(fieldId)) fail("failure.field_id must be a field identity");

  if (!isScoredType(entry.data_type)) fail("failure.data_type must be a scored field type");

  if (entry.verdict !== "Mismatch") fail("failure.verdict must be Mismatch; send only failing fields");

  if (entry.expected_verified !== true) fail("Only verified expected answers can be sent");

  if (entry.extracted_status !== null) text(entry.extracted_status, "failure.extracted_status", 32);

  if (!isBoolean(entry.expected_absent)) fail("failure.expected_absent must be a boolean");
  const isTable = entry.data_type === "array<object>";
  const extracted = scalar(entry.extracted, "failure.extracted");
  const expected = scalar(entry.expected, "failure.expected");

  if (isTable ? extracted !== null || expected !== null : entry.cells !== null)
    fail("Table failures carry cells only; other failures carry values only");

  if (entry.expected_absent && expected !== null) fail("An absent expected answer has no value");

  return {
    field_id: fieldId,
    field_name: text(entry.field_name, "failure.field_name", EVALUATION_EVIDENCE_LIMITS.nameCharacters),
    data_type: entry.data_type,
    verdict: "Mismatch",
    expected_verified: true,
    extracted_status: entry.extracted_status === null ? null : String(entry.extracted_status),
    extracted,
    expected,
    expected_absent: entry.expected_absent,
    cells: isTable ? (entry.expected_absent && entry.cells === null ? null : table(entry.cells)) : null,
  };
}

/** Strict server-side check: unknown properties, unverified answers and passing fields are rejected. */
export function validateEvaluationEvidence(value: JsonValue | undefined): EvaluationEvidence {
  if (encodedBytes(value ?? null) > EVALUATION_EVIDENCE_LIMITS.bytes)
    fail("Evaluation evidence exceeds the 128 KiB assistance evidence limit");
  const entry = record(value, "evaluation", ["candidate", "accuracy", "documents", "omitted", "sample_document"]);

  const candidate = record(entry.candidate, "evaluation.candidate", [
    "label",
    "model",
    "template_name",
    "template_id",
    "template_version",
    "modified",
  ]);

  if (candidate.template_id !== null) text(candidate.template_id, "evaluation.candidate.template_id", 160);

  if (candidate.template_version !== null) count(candidate.template_version, "evaluation.candidate.template_version", 1);

  if (!isBoolean(candidate.modified)) fail("evaluation.candidate.modified must be a boolean");

  if (
    !isJsonArray(entry.documents) ||
    !entry.documents.length ||
    entry.documents.length > EVALUATION_EVIDENCE_LIMITS.documents
  )
    fail(`evaluation.documents must list 1 to ${EVALUATION_EVIDENCE_LIMITS.documents} documents with failing fields`);

  const documents = entry.documents.map((item) => {
    const document = record(item, "evaluation document", ["name", "accuracy", "failures"]);

    if (
      !isJsonArray(document.failures) ||
      !document.failures.length ||
      document.failures.length > EVALUATION_EVIDENCE_LIMITS.failuresPerDocument
    )
      fail(`Each evaluation document lists 1 to ${EVALUATION_EVIDENCE_LIMITS.failuresPerDocument} failing fields`);
    const failures = document.failures.map(failure);

    if (new Set(failures.map((item) => item.field_id)).size !== failures.length)
      fail("Each failing field appears once per evaluation document");

    return {
      name: text(document.name, "evaluation document.name", EVALUATION_EVIDENCE_LIMITS.nameCharacters),
      accuracy: accuracy(document.accuracy, "evaluation document.accuracy"),
      failures,
    };
  });

  const omitted = record(entry.omitted, "evaluation.omitted", ["documents", "failures"]);

  if (entry.sample_document !== null)
    text(entry.sample_document, "evaluation.sample_document", EVALUATION_EVIDENCE_LIMITS.nameCharacters);

  return {
    candidate: {
      label: text(candidate.label, "evaluation.candidate.label", EVALUATION_EVIDENCE_LIMITS.labelCharacters),
      model: text(candidate.model, "evaluation.candidate.model", EVALUATION_EVIDENCE_LIMITS.nameCharacters, true),
      template_name: text(
        candidate.template_name,
        "evaluation.candidate.template_name",
        EVALUATION_EVIDENCE_LIMITS.labelCharacters,
        true,
      ),
      template_id: candidate.template_id === null ? null : String(candidate.template_id),
      template_version: candidate.template_version === null ? null : Number(candidate.template_version),
      modified: candidate.modified,
    },
    accuracy: accuracy(entry.accuracy, "evaluation.accuracy"),
    documents,
    omitted: {
      documents: count(omitted.documents, "evaluation.omitted.documents"),
      failures: count(omitted.failures, "evaluation.omitted.failures"),
    },
    sample_document: entry.sample_document === null ? null : String(entry.sample_document),
  };
}

/** Field identities the model may cite with an evaluation evidence reference. */
export const evaluationFieldIds = (evidence: EvaluationEvidence) => [
  ...new Set(evidence.documents.flatMap((document) => document.failures.map((item) => item.field_id))),
];
