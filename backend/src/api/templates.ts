import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { parseJsonBody, validateTemplatePayload } from "../lib/validation";
import { emitWorkspaceProductAnalytics } from "../lib/workspaceProductAnalytics";
import { summarizeTemplatePlanLimitUsage, summarizeWorkspaceBilling } from "../lib/workspaceBilling";
import { getWorkspaceBillingControl } from "../lib/workspaceBillingControl";
import { getWorkspaceProductStore, isWorkspaceProductStoreFailure } from "../lib/workspaceProductStoreClient";
import type { Workspace } from "../lib/types";
import type { WorkspaceBillingSummary } from "../lib/workspaceBilling";
import type { WorkspacePlanLimitTemplateUsage } from "../lib/workspaceProductStoreClient";

export async function createTemplate(request: Request, env: Env, workspace: Workspace): Promise<Response> {
  const payload = validateTemplatePayload(parseJsonBody(await request.text()));
  if (!payload.name) {
    throw new HttpError(400, "invalid_name", "Template name is required");
  }

  const templateId = newId("tpl");
  const now = nowIso();
  const fields = payload.fields || [];

  const productStore = getWorkspaceProductStore(env, workspace.id);
  const billing = await summarizeActiveWorkspaceBilling(env, workspace);
  const planLimits = billing.plan_limits;
  const usage = await productStore.summarizePlanLimitUsage?.();
  if (usage && planLimits.templates !== null && usage.active_template_count >= planLimits.templates) {
    throw new HttpError(
      402,
      "template_limit_exceeded",
      `Workspace has reached the ${billing.active_entitlement.display_name} plan limit of ${planLimits.templates} Templates`,
    );
  }
  assertTemplateUsageWithinPlan(summarizeTemplatePlanLimitUsage(templateId, fields), billing);

  const created = await productStore.createTemplate({
    templateId,
    name: payload.name,
    description: payload.description || null,
    fields,
    createdAt: now,
    maxTemplates: workspace.max_templates ?? planLimits.templates,
    maxFieldsPerTemplate: workspace.max_fields_per_template ?? planLimits.top_level_template_fields,
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
  const billing = await summarizeActiveWorkspaceBilling(env, workspace);
  const planLimits = billing.plan_limits;
  if (!patch.fields) {
    const usage = await productStore.summarizePlanLimitUsage?.({ templateId: id });
    const templateUsage = usage?.templates.find((candidate) => candidate.template_id === id);
    if (templateUsage) {
      assertTemplateUsageWithinPlan(templateUsage, billing);
    }
  } else {
    assertTemplateUsageWithinPlan(summarizeTemplatePlanLimitUsage(id, patch.fields), billing);
  }

  const updated = await productStore.updateTemplate({
    templateId: id,
    name: patch.name,
    description: patch.description,
    fields: patch.fields,
    updatedAt: now,
    maxFieldsPerTemplate: workspace.max_fields_per_template ?? planLimits.top_level_template_fields,
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

async function summarizeActiveWorkspaceBilling(env: Env, workspace: Workspace): Promise<WorkspaceBillingSummary> {
  const billingControl = await getWorkspaceBillingControl(env.DB, workspace.id);
  return summarizeWorkspaceBilling(workspace, billingControl);
}

export async function deleteTemplate(env: Env, workspace: Workspace, id: string): Promise<Response> {
  const productStore = getWorkspaceProductStore(env, workspace.id);
  const deleted = await productStore.deleteTemplate(id);
  if (!deleted) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  return new Response(null, { status: 204 });
}

function assertTemplateUsageWithinPlan(
  templateUsage: WorkspacePlanLimitTemplateUsage,
  billing: WorkspaceBillingSummary,
): void {
  const limits = billing.plan_limits;
  const planName = billing.active_entitlement.display_name;
  if (templateUsage.top_level_template_fields > limits.top_level_template_fields) {
    throw new HttpError(
      402,
      "template_field_limit_exceeded",
      `Template has exceeded the ${planName} plan limit of ${limits.top_level_template_fields} top-level fields`,
    );
  }
  if (templateUsage.table_shaped_fields > limits.table_shaped_fields) {
    throw new HttpError(
      402,
      "template_table_limit_exceeded",
      `Template has exceeded the ${planName} plan limit of ${limits.table_shaped_fields} table-shaped field`,
    );
  }
  if (templateUsage.max_table_columns_per_field > limits.table_columns_per_field) {
    throw new HttpError(
      402,
      "template_table_column_limit_exceeded",
      `Template has exceeded the ${planName} plan limit of ${limits.table_columns_per_field} table columns`,
    );
  }
}
