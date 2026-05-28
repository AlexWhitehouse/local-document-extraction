import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { parseJsonBody, validateTemplatePayload } from "../lib/validation";
import { emitWorkspaceProductAnalytics } from "../lib/workspaceProductAnalytics";
import { getWorkspaceProductStore, isWorkspaceProductStoreFailure } from "../lib/workspaceProductStoreClient";
import type { Workspace } from "../lib/types";

export async function createTemplate(request: Request, env: Env, workspace: Workspace): Promise<Response> {
  const payload = validateTemplatePayload(parseJsonBody(await request.text()));
  if (!payload.name) {
    throw new HttpError(400, "invalid_name", "Template name is required");
  }

  const templateId = newId("tpl");
  const now = nowIso();
  const fields = payload.fields || [];

  const productStore = getWorkspaceProductStore(env, workspace.id);
  const created = await productStore.createTemplate({
    templateId,
    name: payload.name,
    description: payload.description || null,
    fields,
    createdAt: now,
    maxTemplates: workspace.max_templates,
    maxFieldsPerTemplate: workspace.max_fields_per_template,
  });
  if (isWorkspaceProductStoreFailure(created)) {
    throw new HttpError(created.error.status, created.error.code, created.error.message);
  }

  emitWorkspaceProductAnalytics(env, {
    type: "template_created",
    workspaceId: workspace.id,
    templateId: created.template_id,
    templateVersion: created.version,
    status: created.status,
    fieldCount: fields.length,
  });

  return json(created, 201);
}

export async function listTemplates(env: Env, workspace: Workspace): Promise<Response> {
  const productStore = getWorkspaceProductStore(env, workspace.id);
  return json({ templates: await productStore.listTemplates() });
}

export async function getTemplate(env: Env, workspace: Workspace, id: string): Promise<Response> {
  const productStore = getWorkspaceProductStore(env, workspace.id);
  const template = await productStore.getTemplate(id);
  if (!template) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  return json(template);
}

export async function updateTemplate(
  request: Request,
  env: Env,
  workspace: Workspace,
  id: string
): Promise<Response> {
  const patch = validateTemplatePayload(parseJsonBody(await request.text()), true);
  const now = nowIso();

  const productStore = getWorkspaceProductStore(env, workspace.id);
  const updated = await productStore.updateTemplate({
    templateId: id,
    name: patch.name,
    description: patch.description,
    fields: patch.fields,
    updatedAt: now,
    maxFieldsPerTemplate: workspace.max_fields_per_template,
  });

  if (isWorkspaceProductStoreFailure(updated)) {
    throw new HttpError(updated.error.status, updated.error.code, updated.error.message);
  }

  if (!updated) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  emitWorkspaceProductAnalytics(env, {
    type: "template_updated",
    workspaceId: workspace.id,
    templateId: updated.template_id,
    templateVersion: updated.version,
    status: updated.status,
    fieldCount: patch.fields?.length || 0,
  });

  return json(updated);
}

export async function deleteTemplate(env: Env, workspace: Workspace, id: string): Promise<Response> {
  const productStore = getWorkspaceProductStore(env, workspace.id);
  const deleted = await productStore.deleteTemplate(id);
  if (!deleted) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  return new Response(null, { status: 204 });
}
