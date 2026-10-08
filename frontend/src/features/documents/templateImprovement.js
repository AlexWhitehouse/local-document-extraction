// "Improve template" from a completed document: the request prefilled in the Templates assistant.

const WEAK_STATUSES = new Set(["not_found", "invalid_type", "unreadable", "error"]);

export const LOW_CONFIDENCE = 0.6;

/** Fields the template may extract poorly: not found, invalid, unreadable or failed, or below 0.6 confidence. */
export function weakResultFields(results) {
  const names = [];

  for (const result of Array.isArray(results) ? results : []) {
    const confidence = result?.confidence;

    if (WEAK_STATUSES.has(result?.status) || (Number.isFinite(confidence) && confidence < LOW_CONFIDENCE))
      names.push(String(result.name || result.field_id));
  }

  return names;
}

/** Names weak fields when there are any; otherwise a general request about this document's results. */
export function templateImprovementRequest(results) {
  const names = weakResultFields(results);

  if (!names.length) return "Suggest improvements to the field instructions based on this document’s results.";
  const shown = names.slice(0, 12).map((name) => `“${name}”`);
  const more = names.length > shown.length ? ` and ${names.length - shown.length} more` : "";

  return `Improve the instructions for ${shown.join(", ")}${more}. In this document they were missing, unreadable or low confidence.`;
}

/** The job's template, when it still exists in the workspace. */
export const improvableTemplate = (job, templates) =>
  job?.status === "completed" && job.template_id ? (templates || []).find((t) => t.id === job.template_id) || null : null;
