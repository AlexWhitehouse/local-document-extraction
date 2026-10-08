import { buildEvaluationEvidence } from "../../../../shared/evaluationEvidence.ts";
import { candidateAccuracy, fieldIdentity, linkAlignments, scoreCandidate, tableColumns } from "./evaluationScoring.js";

// Template assistance from Evaluation results: failing fields with their verified Expected answers,
// and before/after accuracy when an edited copy of a candidate is tested on the same documents.

/** The result a candidate shows for one document, or null when there is none or its details are gone. */
export function shownRecord(pair, { previous = true } = {}) {
  const record = pair?.result || (previous ? pair?.previous : null) || null;

  return record && record === pair.result && pair.detail === "unavailable" ? null : record;
}

/** Scores one candidate result against a document's working copy of its Expected answers. */
export function scoreResult(state, document, candidateId, result) {
  const alignments = { ...linkAlignments(document.links, result.fields), ...state.alignments?.[candidateId] };
  const { references, definitions } = document.reference;

  return {
    alignments,
    score: scoreCandidate({ result }, references, definitions, alignments, state.columns?.[candidateId]),
  };
}

function cellEvidence(field, reference, definition, verdict) {
  const keys = new Map(tableColumns(definition || field).map((column) => [column.heading, column.key]));
  const mismatches = [];

  for (const cell of verdict.cells || []) {
    if (cell.match) continue;
    const absent = reference.cellStates?.[cell.row - 1]?.[keys.get(cell.column)] === "absent";

    mismatches.push({
      row: cell.row,
      column: cell.column,
      expected: absent ? null : (cell.expected ?? null),
      expected_absent: absent,
      extracted: cell.actual ?? null,
    });
  }

  return {
    matched: verdict.matched,
    total: verdict.total,
    mismatches,
    omitted_mismatches: 0,
    missing_rows: verdict.missing || [],
    extra_rows: verdict.extra || [],
  };
}

/** Failing fields with a verified Expected answer; unverified answers are never scored, so never sent. */
export function documentFailures(document, result, { score, alignments }) {
  const { references, definitions } = document.reference;
  const failures = [];

  for (const field of result.fields) {
    const verdict = score.byField[field.id];

    if (verdict?.state !== "Mismatch") continue;
    const identity = alignments[field.id] || fieldIdentity(field);
    const reference = references[identity];

    if (!reference?.verified) continue;
    const raw = result.raw.find((row) => row.field_id === field.id);
    const table = field.data_type === "array<object>";

    failures.push({
      field_id: String(field.id),
      field_name: field.name,
      data_type: field.data_type,
      verdict: "Mismatch",
      expected_verified: true,
      extracted_status: raw?.status ?? null,
      extracted: table ? null : (raw?.answer ?? null),
      expected: table || reference.absent ? null : (reference.value ?? null),
      expected_absent: reference.absent === true,
      cells: table && !reference.absent ? cellEvidence(field, reference, definitions[identity], verdict) : null,
    });
  }

  return failures;
}

/** Failing field names for the open document's candidates, read from details already on screen. */
export function failingFieldNames(state, document, candidate) {
  if (!document || !candidate.result) return [];
  const scored = scoreResult(state, document, candidate.id, candidate.result);

  return documentFailures(document, candidate.result, scored).map((failure) => failure.field_name);
}

const loadDetail = async (evaluation, recordId) =>
  evaluation.detail(recordId) || (await evaluation.readDetail(recordId));

function originalFor(evaluation, document) {
  return {
    name: document.name,
    load: async () => {
      if (document.file) return document.file;
      const blob = await evaluation.library.source(document.entry.id);

      return new File([blob], document.name, { type: blob.type || document.entry.mime_type || "" });
    },
  };
}

const quoted = (names) =>
  names.length > 12
    ? `${names
        .slice(0, 12)
        .map((name) => `“${name}”`)
        .join(", ")} and ${names.length - 12} more`
    : names.map((name) => `“${name}”`).join(", ");

/** The request prefilled by "Improve failing fields". */
export const improvementRequest = (names) =>
  `Improve the instructions for ${quoted(names)} so the extracted values match the verified expected answers.`;

/**
 * Collects one candidate's failing fields across every document with a result. Details are read one at
 * a time without displacing the open document. Resolves to null when nothing fails.
 */
export async function collectEvaluationEvidence(evaluation, candidate, label, preferredDocumentKey) {
  const { state } = evaluation;
  const documents = [];
  const names = new Set();

  let matched = 0,
    total = 0,
    sampleDocument = null;

  for (const document of state.documents) {
    const record = shownRecord(state.pairs[document.key]?.[candidate.id]);

    if (!record) continue;
    const detail = await loadDetail(evaluation, record.recordId);
    const result = { ...record, raw: detail?.raw || [] };
    const scored = scoreResult(state, document, candidate.id, result);
    const accuracy = candidateAccuracy(scored.score);
    const failures = documentFailures(document, result, scored);

    if (accuracy) {
      matched += accuracy.matched;
      total += accuracy.total;
    }

    for (const failure of failures) names.add(failure.field_name);

    if (failures.length && (document.availability || "ok") === "ok" && (!sampleDocument || document.key === preferredDocumentKey))
      sampleDocument = document;
    documents.push({ name: document.name, accuracy: accuracy || { matched: 0, total: 0 }, failures });
  }

  if (!names.size) return null;

  const evidence = buildEvaluationEvidence(
    {
      label,
      model: candidate.model,
      template_name: candidate.template.name,
      template_id: candidate.template.source?.id ?? null,
      template_version: candidate.template.source?.version ?? null,
      modified: candidate.template.source?.modified === true,
    },
    { matched, total },
    documents,
  );

  return {
    evidence,
    sample: sampleDocument && (sampleDocument.file || sampleDocument.entry) ? originalFor(evaluation, sampleDocument) : null,
    fieldNames: [...names],
  };
}

const ratio = (counts) => (counts?.total ? counts.matched / counts.total : null);

/** Improved, regressed or unchanged; "unscored" when either side has nothing verified to compare. */
export function accuracyVerdict(before, after) {
  const a = ratio(before),
    b = ratio(after);

  if (a === null || b === null) return "unscored";

  return Math.abs(b - a) < 1e-9 ? "unchanged" : b > a ? "improved" : "regressed";
}

const add = (counts, matched) => ({ matched: counts.matched + (matched ? 1 : 0), total: counts.total + 1 });

/**
 * Before/after accuracy for an original candidate and its tested copy, over the documents where both
 * have results. Fields are matched by name; a renamed field shows on one side only.
 */
export async function compareCandidates(evaluation, originalId, copyId, documentKeys) {
  const { state } = evaluation;
  const fields = new Map();

  let before = { matched: 0, total: 0 },
    after = { matched: 0, total: 0 },
    compared = 0;

  const tally = (side, document, candidateId, result) => {
    const { score } = scoreResult(state, document, candidateId, result);

    for (const field of result.fields) {
      const verdict = score.byField[field.id]?.state;

      if (verdict !== "Match" && verdict !== "Mismatch") continue;
      const entry = fields.get(field.name) || { name: field.name, before: null, after: null };
      entry[side] = add(entry[side] || { matched: 0, total: 0 }, verdict === "Match");
      fields.set(field.name, entry);
    }

    return candidateAccuracy(score);
  };

  for (const document of state.documents) {
    if (!documentKeys.includes(document.key)) continue;
    const pairs = state.pairs[document.key] || {};

    const original = shownRecord(pairs[originalId]),
      copy = shownRecord(pairs[copyId], { previous: false });

    if (!original || !copy) continue;

    const [originalDetail, copyDetail] = await Promise.all([
      loadDetail(evaluation, original.recordId),
      loadDetail(evaluation, copy.recordId),
    ]);

    const beforeAccuracy = tally("before", document, originalId, { ...original, raw: originalDetail?.raw || [] });
    const afterAccuracy = tally("after", document, copyId, { ...copy, raw: copyDetail?.raw || [] });
    compared += 1;

    if (beforeAccuracy) before = { matched: before.matched + beforeAccuracy.matched, total: before.total + beforeAccuracy.total };

    if (afterAccuracy) after = { matched: after.matched + afterAccuracy.matched, total: after.total + afterAccuracy.total };
  }

  return {
    documents: compared,
    overall: { before, after, verdict: accuracyVerdict(before, after) },
    fields: [...fields.values()].map((entry) => ({ ...entry, verdict: accuracyVerdict(entry.before, entry.after) })),
  };
}
