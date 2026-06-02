import type { WorkspaceBillingSummary } from "./workspaceBilling";
import { countAcceptedWorkspaceMemberships } from "./workspaceBillingAuthority";
import type { WorkspacePlanLimitUsage } from "./workspaceProductStoreClient";

type WorkspaceProductPlanLimitUsageRpc = {
  summarizePlanLimitUsage?(input?: { templateId?: string }): Promise<WorkspacePlanLimitUsage>;
};

export async function appendBillingPlanLimitOperationalReasons(
  env: Env,
  workspaceId: string,
  billing: WorkspaceBillingSummary,
  blockingReasons: string[],
): Promise<void> {
  const planLimits = billing.plan_limits;

  const memberCount = await countAcceptedWorkspaceMemberships(env.DB, workspaceId);
  if (isLimitExceeded(memberCount, planLimits.members)) {
    blockingReasons.push("Member limit overage");
  }

  const productStore = env.WORKSPACE_PRODUCT_STORE?.getByName(workspaceId) as
    | WorkspaceProductPlanLimitUsageRpc
    | undefined;
  const usage = await productStore?.summarizePlanLimitUsage?.();
  if (!usage) {
    return;
  }

  if (isLimitExceeded(usage.active_template_count, planLimits.templates)) {
    blockingReasons.push("Template limit overage");
  }
  if (
    usage.templates.some(
      (template) =>
        isLimitExceeded(template.top_level_template_fields, planLimits.top_level_template_fields) ||
        isLimitExceeded(template.table_shaped_fields, planLimits.table_shaped_fields) ||
        isLimitExceeded(template.max_table_columns_per_field, planLimits.table_columns_per_field),
    )
  ) {
    blockingReasons.push("Template schema limit overage");
  }
}

function isLimitExceeded(value: number, limit: number | null): boolean {
  return limit !== null && value > limit;
}
