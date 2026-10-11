import type { JsonValue } from "../../shared/json";
import { HttpError } from "./lib/http";
import { newId, nowIso } from "./lib/ids";
import { validateTemplatePayload } from "./lib/validation";
import type { LocalWorkspaceProductStore } from "./localWorkspaceProductStore";

type TemplateStore = Pick<LocalWorkspaceProductStore, "createTemplate" | "updateTemplate" | "getTemplate">;

export function createWorkspaceTemplate(store: TemplateStore, input: JsonValue, templateId = newId("tpl")) {
  const payload = validateTemplatePayload(input);

  const create: Parameters<TemplateStore["createTemplate"]>[0] = { templateId, name: payload.name!, description: payload.description || null,
    fields: payload.fields || [], createdAt: nowIso() };

  if (payload.tags) create.tags = payload.tags;

  return store.createTemplate(create);
}

export function updateWorkspaceTemplate(store: TemplateStore, templateId: string, input: JsonValue, expectedVersion?: number, expectedUpdatedAt?: string) {
  const patch = validateTemplatePayload(input, true);
  const current = store.getTemplate(templateId);

  if (!current) throw new HttpError(404, "not_found", "Template not found.");

  if (expectedVersion !== undefined && (current.current_version !== expectedVersion || (expectedUpdatedAt !== undefined && current.updated_at !== expectedUpdatedAt))) {
    throw new HttpError(409, "mcp_template_conflict", "The template changed. Read it again before saving.");
  }

  const update: Parameters<LocalWorkspaceProductStore["updateTemplate"]>[0] = { templateId, updatedAt: nowIso() };

  if (patch.name !== undefined) update.name = patch.name;

  if (patch.description !== undefined) update.description = patch.description;

  if (patch.fields !== undefined) update.fields = patch.fields;

  if (patch.tags !== undefined) update.tags = patch.tags;
  const result = store.updateTemplate(update);

  if (!result) throw new HttpError(404, "not_found", "Template not found.");

  return result;
}
