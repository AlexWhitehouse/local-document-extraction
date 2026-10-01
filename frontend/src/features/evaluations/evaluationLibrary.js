import { documentCompatibility, fieldIdentity, referenceCompatibility, verifiedIdentities } from "./evaluationScoring.js";
import { display } from "./evaluationFormat.js";
import { hydrateFieldFromTemplate } from "../templates/templateFields.js";

// Saved Expected answer sets use one versioned, lossless JSON shape shared with the backend.
export const emptyReferenceSet = () => ({ definitions: {}, references: {} });
const text = value => typeof value === "string" ? value : "";

// Tables carry an explicit object_schema; a schema embedded in a Template description is hydrated first.
function definitionFor(field) {
  const hydrated = field.data_type === "array<object>" && !field.object_schema?.columns ? hydrateFieldFromTemplate(field) : field;
  const definition = { id: String(field.id || fieldIdentity(field)), name: field.name, data_type: field.data_type, description: text(hydrated.description) };
  const columns = hydrated.object_schema?.columns;
  if (field.data_type === "array<object>" && Array.isArray(columns)) {
    definition.object_schema = { mode: "table", columns: columns.map(column => ({ key: column.key, heading: column.heading, data_type: column.data_type, description: text(column.description) })) };
  }
  return definition;
}
function referenceFor(reference, definition) {
  const next = { verified: reference.verified === true, absent: reference.absent === true, exact: reference.exact === true };
  if (!next.absent) {
    const value = reference.value;
    next.value = definition.data_type === "array<object>" ? (Array.isArray(value) ? value : []) : ["string", "number", "boolean"].includes(typeof value) ? value : "";
    if (definition.data_type === "array<object>" && Array.isArray(reference.cellStates) && reference.cellStates.some(states => Object.keys(states).length)) next.cellStates = structuredClone(reference.cellStates);
  }
  const rows = reference.rows;
  if (rows?.mode === "position") next.rows = { mode: "position" };
  else if (rows?.mode === "key" && rows.key) next.rows = { mode: "key", key: rows.key };
  return next;
}

// Only reference inputs are serialized: never candidate settings, alignments, outputs or scores.
export function serializeReferenceSet(set) {
  const definitions = {}, references = {};
  for (const [identity, field] of Object.entries(set?.definitions || {})) if (field && fieldIdentity(field) === identity) definitions[identity] = definitionFor(field);
  for (const [identity, reference] of Object.entries(set?.references || {})) {
    if (!reference || !definitions[identity]) continue;
    references[identity] = referenceFor(reference, definitions[identity]);
  }
  return { version: 1, definitions, references };
}
export function parseReferenceSet(value) {
  if (!value || value.version !== 1) return emptyReferenceSet();
  return structuredClone({ definitions: value.definitions || {}, references: value.references || {} });
}
// Serialized comparison, so an untouched working copy is never reported as changed.
export const sameReferenceSet = (a, b) => JSON.stringify(serializeReferenceSet(a)) === JSON.stringify(serializeReferenceSet(b));
export const documentDirty = document => document.kind === "saved" && !!document.base && !sameReferenceSet(document.reference, document.base);

// Verification progress of a saved entry's field summary against the Template fields in use.
export function summaryCompatibility(summary, fields) {
  const references = {}, definitions = {};
  for (const field of summary?.fields || []) {
    definitions[field.identity] = { name: field.name, data_type: field.data_type };
    if (field.verified) references[field.identity] = { verified: true };
  }
  if (!fields?.length) {
    const verified = verifiedIdentities({ references });
    return { verified: verified.length, total: Object.keys(definitions).length, review: 0, omitted: [] };
  }
  return referenceCompatibility({ references, definitions }, fields);
}

export const SAVE_UNAVAILABLE = {
  storage_unconfigured: "Saving needs original-document storage, which isn’t configured for this installation.",
  retention_disabled: "Saving needs original-document retention. An owner or admin can turn it on in Workspace settings.",
  workspace_opted_out: "This Workspace doesn’t keep original documents, so documents can’t be saved to the library.",
};
// Unknown status (still loading) doesn't block; the server enforces save eligibility at acceptance.
export const saveUnavailableMessage = status => !status || status.save_available ? "" : SAVE_UNAVAILABLE[status?.reason] || "Saving to the Evaluation library is unavailable right now.";

const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
// Session-only library routes. `api` adds the Workspace header and access-loss handling.
export function createLibraryClient(api) {
  const read = async response => response.status === 204 ? null : response.json();
  return {
    status: async () => read(await api("/evaluations/documents/status")),
    list: async ({ cursor, query, limit = 50 } = {}) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set("cursor", cursor);
      if (query?.trim()) params.set("q", query.trim());
      return read(await api(`/evaluations/documents?${params}`));
    },
    read: async id => read(await api(`/evaluations/documents/${encodeURIComponent(id)}`)),
    save: async ({ file, name, reference, operationId }) => {
      const form = new FormData();
      form.append("document", file);
      form.append("metadata", JSON.stringify({ operation_id: operationId, name, reference: serializeReferenceSet(reference) }));
      return read(await api("/evaluations/documents", { method: "POST", body: form }));
    },
    // Conditional update: a stale revision rejects with `code: "revision_conflict"` and `current`.
    update: async (id, { expectedRevision, name, reference }) => read(await api(`/evaluations/documents/${encodeURIComponent(id)}`, { ...json({ expected_revision: expectedRevision, ...(name !== undefined ? { name } : {}), ...(reference ? { reference: serializeReferenceSet(reference) } : {}) }), method: "PATCH" })),
    remove: async id => read(await api(`/evaluations/documents/${encodeURIComponent(id)}`, { method: "DELETE" })),
    checkSource: async id => { await api(`/evaluations/documents/${encodeURIComponent(id)}/source`, { method: "HEAD" }); return true; },
    source: async id => (await api(`/evaluations/documents/${encodeURIComponent(id)}/source`)).blob(),
  };
}

// ---------- Presentation helpers shared by the setup and comparison views ----------
export const kilobytes = bytes => `${Math.max(1, Math.round((bytes || 0) / 1024)).toLocaleString()} KB`;
export const updatedLabel = entry => `${entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : ""}${entry.updated_by_name ? ` · ${entry.updated_by_name}` : ""}`;
export const refText = (reference, definition) => !reference ? "—" : reference.absent ? "Not in document" : definition?.data_type === "array<object>" && Array.isArray(reference.value) ? `${reference.value.length} ${reference.value.length === 1 ? "row" : "rows"}` : display(reference.value);
export const newerAvailable = document => document.newerRevision > (document.loadedRevision ?? Infinity);
export const unavailableText = document => document.availability === "deleted" ? "Deleted from the library. It can’t run again; results already shown stay visible."
  : document.availability === "missing" ? "The saved original is missing, so it can’t run. Its answers are kept."
    : "The saved original can’t be read right now, so it won’t run. Other documents still run.";

// Saved/new, local changes, freshness, availability and review status for one selected document.
export function documentChips(document, fields) {
  const compatibility = documentCompatibility(document, fields), chips = [];
  if (document.kind === "upload") chips.push(document.save === "saving" ? ["busy", "Saving…"] : document.save === "failed" ? ["bad", "Save failed · still in this tab"] : ["warn", "Not saved · this tab only"]);
  else if (document.availability === "deleted") chips.push(["bad", "Deleted from library"]);
  else if (documentDirty(document)) chips.push(["warn", "Local changes"]);
  else chips.push(["good", newerAvailable(document) ? "Saved · newer version available" : "Saved"]);
  if (["missing", "unavailable"].includes(document.availability)) chips.push(["bad", "Original unavailable"]);
  if (compatibility.review) chips.push(["warn", `${compatibility.review} needs review`]);
  return chips;
}

// A starting draft for a saved answer whose field type changed; it still has to be verified.
export const reviewDraft = reference => ({ value: typeof reference?.value === "string" || typeof reference?.value === "number" ? String(reference.value) : "", absent: false, exact: false });

// Template fields a saved answer can be linked to: same type, and no verified answer of their own.
// Links are always chosen by the user, never inferred from names or positions.
export function linkableFields(document, fields, savedIdentity) {
  const definition = document.reference.definitions[savedIdentity];
  const unique = [...new Map(fields.map(field => [fieldIdentity(field), field])).values()];
  return documentCompatibility(document, unique).rows
    .filter(row => row.state === "unverified" && !document.links?.[fieldIdentity(row.field)] && row.field.data_type === definition?.data_type)
    .map(row => row.field);
}
