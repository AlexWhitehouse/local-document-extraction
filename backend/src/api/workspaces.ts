import { HttpError, json } from "../lib/http";
import { deleteWorkspaceCascade } from "../lib/cascadeDelete";
import { getWorkspaceBillingControl } from "../lib/workspaceBillingControl";
import { summarizeWorkspaceBilling } from "../lib/workspaceBilling";
import {
  reconcileActivePlanOverrideIncludedCredits,
  type IncludedCreditGrantLedger,
} from "../lib/workspaceBillingIncludedCredits";
import {
  countAcceptedWorkspaceMemberships,
  getWorkspaceBillingAuthorityForSession,
} from "../lib/workspaceBillingAuthority";
import { appendBillingPlanLimitOperationalReasons } from "../lib/workspaceBillingOperationalStatus";
import { newId, nowIso } from "../lib/ids";
import {
  acceptWorkspaceInvitation as acceptWorkspaceInvitationPolicy,
  approveWorkspaceDeletionForUser as approveWorkspaceDeletionForUserPolicy,
  cancelWorkspaceInvitationForUser as cancelWorkspaceInvitationForUserPolicy,
  createWorkspaceForUser as createWorkspaceForUserPolicy,
  declineWorkspaceInvitation as declineWorkspaceInvitationPolicy,
  inviteWorkspaceMember as inviteWorkspaceMemberPolicy,
  leaveWorkspaceForUser as leaveWorkspaceForUserPolicy,
  listManageableWorkspaceInvitationsForUser as listManageableWorkspaceInvitationsForUserPolicy,
  listPendingWorkspaceInvitationsForEmail as listPendingWorkspaceInvitationsForEmailPolicy,
  listWorkspaceUsersForUser as listWorkspaceUsersForUserPolicy,
  listWorkspacesForUser as listWorkspacesForUserPolicy,
  rotateWorkspaceApiKeyForUser as rotateWorkspaceApiKeyForUserPolicy,
  bootstrapWorkspaceForNewUser as bootstrapWorkspaceForNewUserPolicy,
  updateWorkspaceSettingsForUser as updateWorkspaceSettingsForUserPolicy,
  updateWorkspaceUserRoleForUser as updateWorkspaceUserRoleForUserPolicy,
  WorkspacePolicyError
} from "../lib/workspacePolicy";
import type { WorkspaceListing } from "../lib/workspacePolicy";
import { parseJsonBody } from "../lib/validation";
import { createWorkspaceProductStarterInvoiceTemplate } from "../lib/starterTemplateAdapter";

type BillingLedgerSummaryRpc = IncludedCreditGrantLedger & {
  summarizeOwnerBilling(input?: {
    billingPeriodStart: string;
    billingPeriodEnd: string;
    monthlyPageLimit: number | null;
  }): Promise<{
    credits: {
      included_available: number;
      total_available: number;
    };
    current_period?: {
      pages_remaining: number | null;
    };
  }>;
};

type CreateWorkspaceBody = {
  name?: unknown;
};

type UpdateWorkspaceBody = {
  name?: unknown;
};

type InviteBody = {
  email?: unknown;
  role?: unknown;
};

type WorkspaceUserActionBody = {
  action?: unknown;
};

const WORKSPACE_USER_ACTIONS = new Set(["remove_user", "make_admin", "make_owner"]);

function mapWorkspacePolicyError(error: unknown): never {
  if (error instanceof WorkspacePolicyError) {
    const status = error.code === "invite_exists" || error.code === "owner_transfer_required" || error.code === "last_workspace" ? 409 : error.code === "not_found" ? 404 : error.code === "invite_expired" ? 410 : 403;
    throw new HttpError(status, error.code, error.message);
  }
  throw error;
}

export async function createWorkspaceForUser(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const payload = parseJsonBody<CreateWorkspaceBody>(await request.text());

  if (payload.name !== undefined && (typeof payload.name !== "string" || payload.name.trim().length === 0)) {
    throw new HttpError(400, "invalid_name", "name must be a non-empty string");
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : undefined;
  return json(await createWorkspaceForUserPolicy(env.DB, { userId, name }), 201);
}

export async function listWorkspacesForUser(env: Env, userId: string, userName?: string | null): Promise<Response> {
  let workspaces = await listWorkspacesForUserPolicy(env.DB, { userId });
  if (workspaces.length === 0) {
    await bootstrapWorkspaceForNewUserPolicy(
      env.DB,
      { userId, userName: userName ?? null },
      createWorkspaceProductStarterInvoiceTemplate(env)
    );
    workspaces = await listWorkspacesForUserPolicy(env.DB, { userId });
  }
  return json({ workspaces: await attachBillingOperationalStatus(env, workspaces) });
}

async function attachBillingOperationalStatus(env: Env, workspaces: WorkspaceListing[]): Promise<WorkspaceListing[]> {
  return Promise.all(
    workspaces.map(async (workspace) => {
      const billingControl = await getWorkspaceBillingControl(env.DB, workspace.id);
      const billingWorkspace = {
        id: workspace.id,
        api_key_hash: null,
        name: workspace.name,
        created_at: workspace.created_at,
        created_by_user_id: null,
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: workspace.max_source_file_bytes,
      };
      const now = new Date();
      const billing = summarizeWorkspaceBilling(billingWorkspace, billingControl, now);
      const workspaceWithPlanLimits = {
        ...workspace,
        billing_plan_limits: billing.plan_limits,
        billing_usage_summary: {
          remaining_credits: isCreditLimitedPlan(billing.active_entitlement.plan)
            ? billing.credits.total_available
            : null,
          remaining_pages: billing.current_period.pages_remaining,
        },
      };

      if (!env.WORKSPACE_BILLING_LEDGER) {
        return workspaceWithPlanLimits;
      }

      const ledger = env.WORKSPACE_BILLING_LEDGER.getByName(workspace.id) as unknown as BillingLedgerSummaryRpc;
      await reconcileActivePlanOverrideIncludedCredits({
        workspace: billingWorkspace,
        control: billingControl,
        ledger,
        now,
      });
      const ledgerSummary = await ledger.summarizeOwnerBilling({
        billingPeriodStart: billing.current_period.start,
        billingPeriodEnd: billing.current_period.end,
        monthlyPageLimit: billing.current_period.monthly_page_limit,
      });
      const blockingReasons: string[] = [];
      const isCreditLimited = isCreditLimitedPlan(billing.active_entitlement.plan);
      if (isCreditLimited && Number(ledgerSummary.credits.total_available || 0) <= 0) {
        blockingReasons.push("Insufficient Credits");
      }
      const pagesRemaining = ledgerSummary.current_period?.pages_remaining ?? billing.current_period.pages_remaining;
      if (isCreditLimited && pagesRemaining !== null && Number(pagesRemaining) <= 0) {
        blockingReasons.push("Plan page capacity reached");
      }
      await appendBillingPlanLimitOperationalReasons(env, workspace.id, billing, blockingReasons);

      return {
        ...workspaceWithPlanLimits,
        billing_usage_summary: {
          remaining_credits: isCreditLimited
            ? Number(ledgerSummary.credits.total_available || 0)
            : null,
          remaining_pages: pagesRemaining,
        },
        billing_operational_status: {
          status: blockingReasons.length ? "blocked" : "active",
          blocking_reasons: blockingReasons,
        },
      };
    }),
  );
}

function isCreditLimitedPlan(plan: string): boolean {
  return plan === "free" || plan === "pro" || plan === "max";
}

export async function updateWorkspaceForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  userId: string
): Promise<Response> {
  const payload = parseJsonBody<UpdateWorkspaceBody>(await request.text());
  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new HttpError(400, "invalid_name", "name must be a non-empty string");
  }

  const name = payload.name.trim();
  try {
    return json(await updateWorkspaceSettingsForUserPolicy(env.DB, { workspaceId, userId, name }));
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function deleteWorkspaceForUser(env: Env, workspaceId: string, userId: string): Promise<Response> {
  try {
    await approveWorkspaceDeletionForUserPolicy(env.DB, { workspaceId, userId });
  } catch (error) {
    mapWorkspacePolicyError(error);
  }

  const billingControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  if (billingControl?.self_service_subscription_status === "unpaid") {
    throw new HttpError(402, "workspace_billing_unpaid", "Resolve unpaid billing invoices before deleting this Workspace");
  }
  if (hasActiveEnterpriseDealTerms(billingControl?.enterprise_deal_status)) {
    throw new HttpError(
      409,
      "enterprise_deletion_requires_admin",
      "Workspace has active Enterprise deal terms and requires Application admin handling before deletion",
    );
  }
  await stopFutureSelfServiceSubscriptionBillingForWorkspaceDeletion(env, workspaceId, billingControl);
  if (billingControl) {
    const deletedAt = nowIso();
    await deactivateWorkspaceBillingEntitlementForDeletion(env.DB, workspaceId, deletedAt);
    await retainWorkspaceBillingRecordForDeletion(env.DB, {
      workspaceId,
      actorUserId: userId,
      billingControl,
      retainedAt: deletedAt,
    });
  }

  await deleteWorkspaceCascade(env, workspaceId);
  return json({ ok: true, workspace_id: workspaceId });
}

function hasActiveEnterpriseDealTerms(status: unknown): boolean {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "active" ||
    normalized === "ramp_up" ||
    normalized === "annual_commitment";
}

async function stopFutureSelfServiceSubscriptionBillingForWorkspaceDeletion(
  env: Env,
  workspaceId: string,
  billingControl: Awaited<ReturnType<typeof getWorkspaceBillingControl>>,
): Promise<void> {
  const stripeSubscriptionId = String(billingControl?.stripe_subscription_id || "").trim();
  const subscriptionStatus = String(billingControl?.self_service_subscription_status || "").trim();
  if (!stripeSubscriptionId || subscriptionStatus === "canceled" || subscriptionStatus === "deleted") {
    return;
  }

  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("invoice_now", "false");
  body.set("prorate", "false");

  const response = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubscriptionId)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": "2026-05-27.dahlia",
        "idempotency-key": `workspace-delete-subscription:${workspaceId}:${stripeSubscriptionId}`,
      },
      body: body.toString(),
    },
  );

  if (!response.ok) {
    throw new HttpError(502, "stripe_subscription_cancellation_failed", "Stripe subscription cancellation failed");
  }
}

async function deactivateWorkspaceBillingEntitlementForDeletion(
  db: D1Database,
  workspaceId: string,
  updatedAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE workspace_billing_controls
       SET self_service_subscription_plan = NULL,
           self_service_subscription_status = 'deleted',
           scheduled_entitlement_plan = NULL,
           scheduled_entitlement_effective_at = NULL,
           updated_at = ?
       WHERE workspace_id = ?`,
    )
    .bind(updatedAt, workspaceId)
    .run();
}

async function retainWorkspaceBillingRecordForDeletion(
  db: D1Database,
  input: {
    workspaceId: string;
    actorUserId: string;
    billingControl: NonNullable<Awaited<ReturnType<typeof getWorkspaceBillingControl>>>;
    retainedAt: string;
  },
): Promise<void> {
  const snapshot = {
    self_service_subscription_plan: input.billingControl.self_service_subscription_plan ?? null,
    self_service_subscription_status: input.billingControl.self_service_subscription_status ?? null,
    scheduled_entitlement_plan: input.billingControl.scheduled_entitlement_plan ?? null,
    scheduled_entitlement_effective_at: input.billingControl.scheduled_entitlement_effective_at ?? null,
    stripe_subscription_current_period_start: input.billingControl.stripe_subscription_current_period_start ?? null,
    stripe_subscription_current_period_end: input.billingControl.stripe_subscription_current_period_end ?? null,
  };

  await db
    .prepare(
      `INSERT INTO workspace_billing_retained_records (
         id,
         workspace_id,
         actor_user_id,
         ledger_object_name,
         stripe_customer_id,
         stripe_subscription_id,
         self_service_subscription_status,
         final_billing_state,
         retained_reason,
         snapshot_json,
         retained_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("retained_billing"),
      input.workspaceId,
      input.actorUserId,
      input.billingControl.ledger_object_name || input.workspaceId,
      input.billingControl.stripe_customer_id || null,
      input.billingControl.stripe_subscription_id || null,
      input.billingControl.self_service_subscription_status || null,
      "deleted",
      "workspace_deletion",
      JSON.stringify(snapshot),
      input.retainedAt,
    )
    .run();
}

export async function leaveWorkspaceForUser(env: Env, workspaceId: string, userId: string, userName?: string | null): Promise<Response> {
  try {
    return json(
      await leaveWorkspaceForUserPolicy(
        env.DB,
        { workspaceId, userId, userName },
        createWorkspaceProductStarterInvoiceTemplate(env)
      )
    );
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function inviteUserToWorkspace(
  request: Request,
  env: Env,
  workspaceId: string,
  inviterUserId: string
): Promise<Response> {
  const payload = parseJsonBody<InviteBody>(await request.text());
  if (typeof payload.email !== "string") {
    throw new HttpError(400, "invalid_email", "email is required");
  }

  const email = payload.email.trim();
  if (!email || !email.includes("@")) {
    throw new HttpError(400, "invalid_email", "email must be a valid address");
  }

  try {
    await assertPlanLimitsAllowWorkspaceInvitation(env, workspaceId, inviterUserId);
    return json(await inviteWorkspaceMemberPolicy(env.DB, { workspaceId, inviterUserId, email: payload.email, role: payload.role }), 201);
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

async function assertPlanLimitsAllowWorkspaceInvitation(
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner" && authority.role !== "admin") {
    throw new HttpError(403, "forbidden", "Only owners/admins can invite users");
  }

  const billingControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const billing = summarizeWorkspaceBilling(authority.workspace, billingControl);
  const memberCount = await countAcceptedWorkspaceMemberships(env.DB, workspaceId);
  if (billing.plan_limits.members !== null && memberCount >= billing.plan_limits.members) {
    throw new HttpError(
      402,
      "member_limit_exceeded",
      `Workspace has reached the ${billing.active_entitlement.display_name} plan limit of ${billing.plan_limits.members} members`,
    );
  }
}

export async function listInvitationsForUser(env: Env, email: string): Promise<Response> {
  return json({ invitations: await listPendingWorkspaceInvitationsForEmailPolicy(env.DB, { email }) });
}

export async function listWorkspaceUsersForUser(env: Env, workspaceId: string, userId: string): Promise<Response> {
  try {
    return json({ users: await listWorkspaceUsersForUserPolicy(env.DB, { workspaceId, userId }) });
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function listWorkspaceInvitationsForUser(env: Env, workspaceId: string, userId: string): Promise<Response> {
  try {
    return json({ invitations: await listManageableWorkspaceInvitationsForUserPolicy(env.DB, { workspaceId, userId }) });
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function cancelWorkspaceInvitationForUser(
  env: Env,
  workspaceId: string,
  invitationId: string,
  userId: string
): Promise<Response> {
  try {
    return json(await cancelWorkspaceInvitationForUserPolicy(env.DB, { workspaceId, invitationId, userId }));
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function updateWorkspaceUserRoleForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  actingUserId: string,
  targetUserId: string
): Promise<Response> {
  if (!targetUserId.trim()) {
    throw new HttpError(404, "not_found", "User not found");
  }

  const payload = parseJsonBody<WorkspaceUserActionBody>(await request.text());
  const action = typeof payload.action === "string" ? payload.action.trim() : "";
  if (!WORKSPACE_USER_ACTIONS.has(action)) {
    throw new HttpError(400, "invalid_action", "action must be one of remove_user, make_admin, make_owner");
  }

  try {
    const result = await updateWorkspaceUserRoleForUserPolicy(env.DB, {
        workspaceId,
        actingUserId,
        targetUserId,
        action: action as "remove_user" | "make_admin" | "make_owner"
      });
    if (action === "make_owner" && "role" in result && result.role === "owner") {
      await updateStripeCustomerContactForNewWorkspaceOwner(env, workspaceId, targetUserId);
    }
    return json(result);
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

async function updateStripeCustomerContactForNewWorkspaceOwner(
  env: Env,
  workspaceId: string,
  newOwnerUserId: string,
): Promise<void> {
  const stripeCustomerId = await getStripeCustomerIdForWorkspace(env.DB, workspaceId);
  if (!stripeCustomerId) {
    return;
  }
  const ownerEmail = await getUserEmail(env.DB, newOwnerUserId);
  if (!ownerEmail) {
    return;
  }

  const apiKey = getConfiguredStripeValue(env, "STRIPE_API_KEY");
  const body = new URLSearchParams();
  body.set("email", ownerEmail);
  body.set("metadata[current_workspace_owner_user_id]", newOwnerUserId);

  const response = await fetch(
    `https://api.stripe.com/v1/customers/${encodeURIComponent(stripeCustomerId)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": "2026-05-27.dahlia",
        "idempotency-key": `stripe-customer-owner:${workspaceId}:${newOwnerUserId}`,
      },
      body: body.toString(),
    },
  );
  if (!response.ok) {
    throw new HttpError(502, "stripe_customer_update_failed", "Stripe Customer billing contact update failed");
  }
}

async function getStripeCustomerIdForWorkspace(db: D1Database, workspaceId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT stripe_customer_id
       FROM workspace_billing_controls
       WHERE workspace_id = ?
       LIMIT 1`,
    )
    .bind(workspaceId)
    .first<{ stripe_customer_id?: string | null }>();
  return String(row?.stripe_customer_id || "").trim() || null;
}

async function getUserEmail(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT email FROM user WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ email?: string | null }>();
  return String(row?.email || "").trim() || null;
}

function getConfiguredStripeValue(env: Env, key: string): string {
  const value = String((env as Env & Record<string, unknown>)[key] || "").trim();
  if (!value) {
    throw new HttpError(500, "stripe_configuration_missing", `${key} is not configured`);
  }
  return value;
}

export async function rotateWorkspaceApiKeyForUser(
  _request: Request,
  env: Env,
  workspaceId: string,
  userId: string
): Promise<Response> {
  try {
    await assertPlanLimitsAllowWorkspaceApiKeyRotation(env, workspaceId, userId);
    return json(await rotateWorkspaceApiKeyForUserPolicy(env.DB, { workspaceId, userId }));
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

async function assertPlanLimitsAllowWorkspaceApiKeyRotation(
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const authority = await getWorkspaceBillingAuthorityForSession(env.DB, { workspaceId, userId });
  if (!authority) {
    throw new HttpError(403, "forbidden", "You do not have access to this workspace");
  }
  if (authority.role !== "owner" && authority.role !== "admin") {
    throw new HttpError(403, "forbidden", "Only owners/admins can rotate workspace API keys");
  }
  const billingControl = await getWorkspaceBillingControl(env.DB, workspaceId);
  const billing = summarizeWorkspaceBilling(authority.workspace, billingControl);
  if (!billing.active_entitlement.api_access) {
    throw new HttpError(
      402,
      "api_access_entitlement_inactive",
      "Workspace plan does not include API access",
    );
  }
}

export async function acceptInvitation(
  env: Env,
  invitationId: string,
  userId: string,
  userEmail: string
): Promise<Response> {
  try {
    return json(await acceptWorkspaceInvitationPolicy(env.DB, { invitationId, userId, userEmail }));
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function declineInvitation(env: Env, invitationId: string, userEmail: string): Promise<Response> {
  try {
    return json(await declineWorkspaceInvitationPolicy(env.DB, { invitationId, userEmail }));
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}
