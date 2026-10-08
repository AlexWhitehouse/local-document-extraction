import {
  fieldIdentity,
  linkAlignments,
  normalizeReferenceDates,
  scoreField,
  validateReference,
  VERIFIABLE_TYPES,
} from "./evaluationScoring.js";

const baseName = (identity) => identity.slice(0, identity.lastIndexOf(":"));

const FOUND = ["ok", "found"];

// The expected answer one candidate answer stands for, or null when it can't be accepted without review.
// "Not found" is the explicit absence the expected-answer model already has. Errors, unreadable values and
// tables with rows are left for review: absence never stands in for an error, and tables need row matching.
export function acceptedReference(definition, raw, existing) {
  if (raw?.status === "not_found") return { verified: true, absent: true, exact: false, value: "" };

  if (!FOUND.includes(raw?.status) || definition.data_type === "array<object>") return null;

  // Candidates read ambiguous numeric dates day first, so the accepted day is the one they were scored on.
  const next = normalizeReferenceDates(
    definition,
    { verified: true, absent: false, exact: existing?.exact || false, value: raw.answer },
    "dmy",
  );

  return validateReference(definition, next) ? null : next;
}

// Sorts one candidate's answers on one document into answers to set, verified answers that already match,
// verified answers that differ (kept unless the user chooses to overwrite them) and answers that need review.
// `candidate.result` carries the candidate's fields and raw answers; `candidates` decide which saved answers
// are still requested, exactly as the comparison matrix does.
export function planAcceptAnswers({ document, candidate, candidates = [candidate], alignments = {} }) {
  const plan = { set: [], matching: [], conflicts: [], review: [] };

  if (!candidate.result) return plan;
  const { references, definitions } = document.reference;

  const alignFor = (c, fields) => ({ ...linkAlignments(document.links, fields), ...alignments[c.id] });

  const requested = new Set(
    candidates.flatMap((c) => {
      const fields = c.result?.fields || c.template?.fields || [];
      const align = alignFor(c, fields);

      return fields.map((field) => align[field.id] || fieldIdentity(field));
    }),
  );

  const fields = candidate.result.fields;
  const align = alignFor(candidate, fields);
  const identities = fields.map((field) => align[field.id] || fieldIdentity(field));

  for (const [index, field] of fields.entries()) {
    if (!VERIFIABLE_TYPES.includes(field.data_type)) continue;
    const identity = identities[index];
    const definition = definitions[identity] || field;
    const item = { identity, name: definition.name, definition };

    // A saved answer linked to two candidate fields can't take both answers.
    if (identities.indexOf(identity) !== index || identities.lastIndexOf(identity) !== index) {
      plan.review.push(item);
      continue;
    }

    const raw = candidate.result.raw?.find((r) => r.field_id === field.id);
    const existing = references[identity];
    const value = acceptedReference(definition, raw, existing);

    if (!value) {
      plan.review.push(item);
      continue;
    }

    if (existing?.verified) {
      if (scoreField(field, raw, existing, definition).state === "Match") plan.matching.push(item);
      else plan.conflicts.push({ ...item, value, current: existing, currentDefinition: definition });
      continue;
    }

    // A verified answer saved for this field's earlier type is replaced the same way a review replaces it.
    const from = Object.keys(references).find(
      (id) => references[id]?.verified && !requested.has(id) && baseName(id) === baseName(identity),
    );

    if (from)
      plan.conflicts.push({
        ...item,
        from,
        value,
        current: references[from],
        currentDefinition: definitions[from] || definition,
      });
    else plan.set.push({ ...item, value });
  }

  return plan;
}

// The answers a plan writes: new answers, plus differing verified answers when the user chose to overwrite them.
export const planChanges = (plan, overwrite) => (overwrite ? [...plan.set, ...plan.conflicts] : plan.set);
