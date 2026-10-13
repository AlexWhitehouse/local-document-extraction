import { validateAssistantOutput } from "../../../../../shared/templateAssistant.ts";
import { normalizeTemplateTags } from "../../../../../shared/templateTags.ts";
import {
  hydrateFieldFromTemplate,
  serializeTemplatePayload,
  validateTemplateJsonPayload,
} from "../../templates/templateFields.js";
import { describeError } from "../../../lib/describeError";

// Shared by the edit and create template flows. Requests and payloads match the template editor's.

export const EMPTY_DRAFT = Object.freeze({ name: "", description: "", fields: [] });

/** The draft the editor builds after loading a saved Template, so proposals refer to the same positions. */
export function editorDraft(template) {
  return {
    name: template.name || "",
    description: template.description || "",
    fields: (Array.isArray(template.fields) ? template.fields : []).map(hydrateFieldFromTemplate),
  };
}

let requestCount = 0;

/**
 * One assistant request over `draft`: the "edit" action the editor's assistant sends, without evidence.
 * The response is checked against the request and the draft before any change is shown.
 */
export async function requestProposal({ request, draft, templateId, instructions, signal }) {
  const base = {
    editorId: crypto.randomUUID(),
    revision: 0,
    requestId: ++requestCount,
    scopeGeneration: 0,
    templateId,
  };

  const body = new FormData();
  body.append("payload", JSON.stringify({ draft, action: "edit", instructions, base }));
  const answer = await request("/templates/assist", { method: "POST", body, signal });

  if (!answer || JSON.stringify(answer.base) !== JSON.stringify(base))
    throw new Error("The response belongs to a different request.");

  const output = { explanation: answer.explanation, observations: answer.observations, groups: answer.groups };

  return validateAssistantOutput(output, draft, "edit", { sampleSupplied: false });
}

/** Up to three short requests for the open draft, from the model. Empty when it can't suggest any. */
export async function requestSuggestions({ request, draft, signal }) {
  const data = await request("/templates/assist/suggestions", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft }),
  });

  return Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 3) : [];
}

/**
 * The PATCH body the editor would send after applying `draft` to the saved `template`:
 * only the members that changed, so unchanged fields keep their version.
 */
export function templateSavePayload(template, draft) {
  const tags = normalizeTemplateTags(template.tags ?? []);
  const payload = validateTemplateJsonPayload({ ...draft, tags });
  const saved = JSON.parse(serializeTemplatePayload({ ...template, tags }));

  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => JSON.stringify(saved[key]) !== JSON.stringify(value)),
  );
}

/** Inline text for a failed request; the model's "not configured" reason is shown as written. */
export function proposalError(error) {
  return describeError(error, "Couldn't get a proposal. Try again.");
}

// Selecting a change also selects the changes it needs; clearing one clears the changes that need it.
export function toggleGroup(groups, selectedIds, id) {
  const next = new Set(selectedIds);
  const adding = !next.has(id);
  const visited = new Set();
  const pending = [id];

  while (pending.length) {
    const current = pending.pop();

    if (visited.has(current)) continue;
    visited.add(current);

    if (adding) {
      next.add(current);
      pending.push(...(groups.find((group) => group.id === current)?.dependsOn ?? []));
    } else {
      next.delete(current);

      for (const group of groups) if (group.dependsOn.includes(current)) pending.push(group.id);
    }
  }

  return next;
}
