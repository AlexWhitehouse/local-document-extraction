import { describe, expect, it, vi } from "vitest";
import {
  cancelWorkspaceInvitationForUser,
  createWorkspaceForUser,
  declineInvitation,
  deleteWorkspaceForUser,
  leaveWorkspaceForUser,
  inviteUserToWorkspace,
  listWorkspacesForUser,
  rotateWorkspaceApiKeyForUser,
  updateWorkspaceUserRoleForUser
} from "./workspaces";
import { HttpError } from "../lib/http";
import type { Workspace } from "../lib/types";

type MembershipFixture = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
};

type WorkspaceInvitationFixture = {
  id: string;
  workspace_id: string;
  email: string;
  status: "pending" | "accepted" | "cancelled" | "expired";
};

type CreatedWorkspaceResponse = {
  workspace_id: string;
  has_api_key: boolean;
  name: string;
  role: "owner";
  created_at: string;
};

type IssuedWorkspaceApiKeyResponse = {
  workspace_id: string;
  api_key: string;
  has_api_key: boolean;
  rotated_at: string;
};

type WorkspaceListingResponse = {
  workspaces: Array<{
    id: string;
    name: string | null;
    created_at: string;
    max_source_file_bytes: number | null;
    has_api_key: boolean;
    role: "owner" | "admin" | "member";
    billing_plan_limits?: {
      templates: number | null;
      top_level_template_fields: number;
      table_shaped_fields: number;
      table_columns_per_field: number;
      members: number | null;
      monthly_pages: number | null;
      api_access: boolean;
    };
    billing_usage_summary?: {
      remaining_credits: number | null;
      remaining_pages: number | null;
    };
    billing_operational_status?: {
      status: "active" | "blocked";
      blocking_reasons: string[];
    };
  }>;
};

type LeftWorkspaceResponse = {
  ok: true;
  workspace_id: string;
  replacement_workspace?: CreatedWorkspaceResponse;
};

type TemplateFixture = {
  workspace_id: string;
  name: string;
  fields?: Array<{ id: string; name: string }>;
};

type TemplateFieldFixture = {
  field_id: string;
  name: string;
};

type ResidualSourceFileFixture = {
  job_id: string;
  source_file_key: string;
};

type PlanLimitUsageFixture = {
  active_template_count: number;
  templates: Array<{
    template_id: string;
    top_level_template_fields: number;
    table_shaped_fields: number;
    max_table_columns_per_field: number;
  }>;
};

type BillingLedgerSummaryFixture = {
  credits: {
    total_available: number;
  };
  current_period?: {
    pages_remaining: number | null;
  };
};

type BillingControlFixture = {
  ledger_object_name?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_subscription_item_id?: string | null;
  self_service_subscription_plan?: "pro" | "max" | null;
  self_service_subscription_status?: string | null;
  stripe_subscription_current_period_start?: string;
  stripe_subscription_current_period_end?: string;
  scheduled_entitlement_plan?: "free" | "pro" | "max" | null;
  scheduled_entitlement_effective_at?: string | null;
  enterprise_deal_status?: string | null;
  no_billing_enabled?: number;
  no_billing_reason?: string | null;
  no_billing_updated_by_user_id?: string | null;
  no_billing_updated_at?: string | null;
};

type RetainedBillingRecordFixture = {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  ledger_object_name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  self_service_subscription_status: string | null;
  final_billing_state: string;
  retained_reason: string;
  snapshot: Record<string, unknown>;
  retained_at: string;
};

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace_delete",
    api_key_hash: "hash_delete",
    name: "Research",
    created_at: "2026-05-04T00:00:00.000Z",
    created_by_user_id: "user_owner",
    rate_limit_per_minute: null,
    max_templates: null,
    max_fields_per_template: null,
    max_source_file_bytes: null,
    ...overrides
  };
}

function freePlanLimits() {
  return {
    templates: 3,
    top_level_template_fields: 5,
    table_shaped_fields: 1,
    table_columns_per_field: 5,
    members: 3,
    monthly_pages: 500,
    api_access: false,
  };
}

function freeBillingUsageSummary() {
  return {
    remaining_credits: 0,
    remaining_pages: 500,
  };
}

function createEnvFixture(input: {
  workspaces: Workspace[];
  memberships: MembershipFixture[];
  invitations?: WorkspaceInvitationFixture[];
  jobSourceFileKeys?: string[];
  residualSourceFiles?: ResidualSourceFileFixture[];
  productStoreEraseError?: Error;
  planLimitUsageByWorkspace?: Record<string, PlanLimitUsageFixture>;
  billingLedgerSummariesByWorkspace?: Record<string, BillingLedgerSummaryFixture>;
  stripeCustomerIdByWorkspace?: Record<string, string>;
  billingControlByWorkspace?: Record<string, BillingControlFixture>;
  users?: Array<{ id: string; email: string; name?: string | null }>;
}): Env & {
  deletedSourceFileKeys: string[];
  cleanedSourceFiles: ResidualSourceFileFixture[];
  erasedProductStoreWorkspaces: string[];
  deletionEvents: string[];
  billingLedgerMutationCalls: string[];
  retainedBillingRecords: RetainedBillingRecordFixture[];
  createdTemplates: TemplateFixture[];
  createdTemplateFields: TemplateFieldFixture[];
  createdProductStoreTemplates: TemplateFixture[];
} {
  const deletedSourceFileKeys: string[] = [];
  const cleanedSourceFiles: ResidualSourceFileFixture[] = [];
  const erasedProductStoreWorkspaces: string[] = [];
  const deletionEvents: string[] = [];
  const billingLedgerMutationCalls: string[] = [];
  const retainedBillingRecords: RetainedBillingRecordFixture[] = [];
  const createdTemplates: TemplateFixture[] = [];
  const createdTemplateFields: TemplateFieldFixture[] = [];
  const createdProductStoreTemplates: TemplateFixture[] = [];
  const residualSourceFiles = [...(input.residualSourceFiles ?? [])];
  return {
    WORKSPACE_PRODUCT_STORE: {
      getByName(workspaceId: string) {
        return {
          async createTemplate(template: { name: string; fields: Array<{ id: string; name: string }> }) {
            createdProductStoreTemplates.push({
              workspace_id: workspaceId,
              name: template.name,
              fields: template.fields,
            });
            return { template_id: "tpl_starter", version: 1, status: "active" };
          },
          async summarizePlanLimitUsage() {
            return input.planLimitUsageByWorkspace?.[workspaceId] ?? {
              active_template_count: 0,
              templates: [],
            };
          },
          async listResidualSourceFilesForCleanup({ limit }: { limit: number }) {
            return residualSourceFiles.slice(0, limit);
          },
          async markSourceFileCleaned(input: { jobId: string; sourceFileKey: string }) {
            const index = residualSourceFiles.findIndex(
              (candidate) => candidate.job_id === input.jobId && candidate.source_file_key === input.sourceFileKey,
            );
            if (index >= 0) {
              const [cleaned] = residualSourceFiles.splice(index, 1);
              if (cleaned) {
                cleanedSourceFiles.push(cleaned);
                deletionEvents.push(`source-file-cleaned:${cleaned.source_file_key}`);
              }
              return true;
            }
            return false;
          },
          async eraseWorkspaceProductData() {
            if (input.productStoreEraseError) {
              throw input.productStoreEraseError;
            }
            erasedProductStoreWorkspaces.push(workspaceId);
            deletionEvents.push(`product-data-erased:${workspaceId}`);
          },
        };
      },
    } as unknown as DurableObjectNamespace,
    DB: {
      async batch(statements: D1PreparedStatement[]) {
        deletionEvents.push("control-data-delete");
        await Promise.all(statements.map((statement) => statement.run()));
        return [];
      },
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async run() {
                if (sql.includes("INSERT INTO workspaces")) {
                  const [id, apiKeyHash, name, createdAt, createdByUserId] = params;
                  input.workspaces.push({
                    id: String(id),
                    api_key_hash: typeof apiKeyHash === "string" ? apiKeyHash : null,
                    name: String(name),
                    created_at: String(createdAt),
                    created_by_user_id: String(createdByUserId),
                    rate_limit_per_minute: null,
                    max_templates: null,
                    max_fields_per_template: null,
                    max_source_file_bytes: null
                  });
                  return { success: true };
                }

                if (sql.includes("INSERT INTO workspace_memberships")) {
                  const [workspaceId, userId] = params;
                  const createdAt = params[params.length - 1];
                  input.memberships.push({
                    workspace_id: String(workspaceId),
                    user_id: String(userId),
                    role: "owner"
                  });
                  expect(createdAt).toEqual(expect.any(String));
                  return { success: true };
                }

                if (sql.includes("INSERT INTO templates")) {
                  const [, workspaceId, name] = params;
                  createdTemplates.push({ workspace_id: String(workspaceId), name: String(name) });
                  return { success: true };
                }

                if (sql.includes("INSERT INTO template_fields")) {
                  const match = sql.match(/VALUES \(\?, 1, '([^']+)', '([^']+)'/);
                  if (!match) {
                    throw new Error(`Unhandled template field SQL: ${sql}`);
                  }
                  const [, fieldId, name] = match;
                  createdTemplateFields.push({ field_id: fieldId, name });
                  return { success: true };
                }

                if (sql.includes("UPDATE workspaces SET api_key_hash = ? WHERE id = ?")) {
                  const [apiKeyHash, workspaceId] = params;
                  const workspace = input.workspaces.find((candidate) => candidate.id === workspaceId);
                  if (workspace) {
                    workspace.api_key_hash = String(apiKeyHash);
                  }
                  return { success: true };
                }

                if (sql.includes("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND role = 'owner'")) {
                  const [workspaceId] = params;
                  input.memberships.forEach((membership) => {
                    if (membership.workspace_id === workspaceId && membership.role === "owner") {
                      membership.role = "admin";
                    }
                  });
                  return { success: true };
                }

                if (sql.includes("UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?")) {
                  const [workspaceId, userId] = params;
                  const membership = input.memberships.find(
                    (candidate) => candidate.workspace_id === workspaceId && candidate.user_id === userId
                  );
                  if (membership) {
                    membership.role = "owner";
                  }
                  return { success: true };
                }

                if (sql.includes("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?")) {
                  const [workspaceId, userId] = params;
                  const membership = input.memberships.find(
                    (candidate) => candidate.workspace_id === workspaceId && candidate.user_id === userId
                  );
                  if (membership) {
                    membership.role = "admin";
                  }
                  return { success: true };
                }

                if (sql.includes("UPDATE workspaces SET created_by_user_id = ? WHERE id = ?")) {
                  const [userId, workspaceId] = params;
                  const workspace = input.workspaces.find((candidate) => candidate.id === workspaceId);
                  if (workspace) {
                    workspace.created_by_user_id = String(userId);
                  }
                  return { success: true };
                }

                if (sql.includes("UPDATE workspace_billing_controls") && sql.includes("self_service_subscription_status = 'deleted'")) {
                  const [updatedAt, workspaceId] = params;
                  const control = input.billingControlByWorkspace?.[String(workspaceId)];
                  if (control) {
                    control.self_service_subscription_plan = null;
                    control.self_service_subscription_status = "deleted";
                    control.scheduled_entitlement_plan = null;
                    control.scheduled_entitlement_effective_at = null;
                  }
                  expect(updatedAt).toEqual(expect.any(String));
                  deletionEvents.push(`billing-entitlement-deactivated:${String(workspaceId)}`);
                  return { success: true };
                }

                if (sql.includes("INSERT INTO workspace_billing_retained_records")) {
                  const [
                    id,
                    workspaceId,
                    actorUserId,
                    ledgerObjectName,
                    stripeCustomerId,
                    stripeSubscriptionId,
                    selfServiceSubscriptionStatus,
                    finalBillingState,
                    retainedReason,
                    snapshotJson,
                    retainedAt,
                  ] = params;
                  retainedBillingRecords.push({
                    id: String(id),
                    workspace_id: String(workspaceId),
                    actor_user_id: String(actorUserId),
                    ledger_object_name: String(ledgerObjectName),
                    stripe_customer_id: stripeCustomerId ? String(stripeCustomerId) : null,
                    stripe_subscription_id: stripeSubscriptionId ? String(stripeSubscriptionId) : null,
                    self_service_subscription_status: selfServiceSubscriptionStatus
                      ? String(selfServiceSubscriptionStatus)
                      : null,
                    final_billing_state: String(finalBillingState),
                    retained_reason: String(retainedReason),
                    snapshot: JSON.parse(String(snapshotJson || "{}")) as Record<string, unknown>,
                    retained_at: String(retainedAt),
                  });
                  deletionEvents.push(`billing-record-retained:${String(workspaceId)}`);
                  return { success: true };
                }

                if (sql.includes("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")) {
                  const [workspaceId, userId] = params;
                  const index = input.memberships.findIndex(
                    (membership) => membership.workspace_id === workspaceId && membership.user_id === userId
                  );
                  if (index >= 0) {
                    input.memberships.splice(index, 1);
                  }
                  return { success: true };
                }

                if (sql.includes("DELETE FROM workspace_memberships WHERE workspace_id = ?")) {
                  const [workspaceId] = params;
                  for (let index = input.memberships.length - 1; index >= 0; index -= 1) {
                    if (input.memberships[index]?.workspace_id === workspaceId) {
                      input.memberships.splice(index, 1);
                    }
                  }
                  return { success: true };
                }

                if (sql.includes("DELETE FROM workspaces WHERE id = ?")) {
                  const [workspaceId] = params;
                  const index = input.workspaces.findIndex((workspace) => workspace.id === workspaceId);
                  if (index >= 0) {
                    input.workspaces.splice(index, 1);
                  }
                  return { success: true };
                }

                if (sql.includes("DELETE FROM")) {
                  return { success: true };
                }

                if (sql.includes("UPDATE workspace_invitations SET status = 'cancelled'")) {
                  const [updatedAt, invitationId] = params;
                  const invitation = input.invitations?.find((candidate) => candidate.id === invitationId);
                  if (invitation) {
                    invitation.status = "cancelled";
                  }
                  expect(updatedAt).toEqual(expect.any(String));
                  return { success: true };
                }

                if (sql.includes("INSERT INTO workspace_invitations")) {
                  const [id, workspaceId, email] = params;
                  input.invitations?.push({
                    id: String(id),
                    workspace_id: String(workspaceId),
                    email: String(email),
                    status: "pending",
                  });
                  return { success: true };
                }

                throw new Error(`Unhandled fixture SQL: ${sql}`);
              },
              async first<T>() {
                if (sql.includes("SELECT role FROM workspace_memberships")) {
                  const [workspaceId, userId] = params;
                  const membership = input.memberships.find(
                    (candidate) => candidate.workspace_id === workspaceId && candidate.user_id === userId
                  );
                  return (membership ? { role: membership.role } : null) as T | null;
                }

                if (sql.includes("SELECT workspace_id FROM workspace_memberships WHERE user_id = ? LIMIT 1")) {
                  const [userId] = params;
                  const membership = input.memberships.find((candidate) => candidate.user_id === userId);
                  return (membership ? { workspace_id: membership.workspace_id } : null) as T | null;
                }

                if (sql.includes("SELECT COUNT(*) AS count FROM workspace_memberships WHERE user_id = ?")) {
                  const [userId] = params;
                  const count = input.memberships.filter((membership) => membership.user_id === userId).length;
                  return { count } as T;
                }

                if (sql.includes("SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ?")) {
                  const [workspaceId] = params;
                  const count = input.memberships.filter((membership) => membership.workspace_id === workspaceId).length;
                  return { count } as T;
                }

                if (sql.includes("SELECT stripe_customer_id") && sql.includes("FROM workspace_billing_controls")) {
                  const [workspaceId] = params;
                  const customerId = input.stripeCustomerIdByWorkspace?.[String(workspaceId)];
                  return (customerId ? { stripe_customer_id: customerId } : null) as T | null;
                }

                if (
                  sql.includes("self_service_subscription_plan") &&
                  sql.includes("FROM workspace_billing_controls")
                ) {
                  const [workspaceId] = params;
                  const control = input.billingControlByWorkspace?.[String(workspaceId)];
                  return (control ? { ...control } : null) as T | null;
                }

                if (sql.includes("SELECT email FROM user WHERE id = ?")) {
                  const [userId] = params;
                  const user = input.users?.find((candidate) => candidate.id === userId);
                  return (user ? { email: user.email } : null) as T | null;
                }

                if (
                  sql.includes("FROM workspaces w") &&
                  sql.includes("JOIN workspace_memberships m")
                ) {
                  const [workspaceId, userId] = params;
                  const workspace = input.workspaces.find((candidate) => candidate.id === workspaceId);
                  const membership = input.memberships.find(
                    (candidate) => candidate.workspace_id === workspaceId && candidate.user_id === userId,
                  );
                  return (workspace && membership ? { ...workspace, role: membership.role } : null) as T | null;
                }

                if (sql.includes("FROM workspace_invitations") && sql.includes("WHERE id = ? AND workspace_id = ?")) {
                  const [invitationId, workspaceId] = params;
                  const invitation = input.invitations?.find(
                    (candidate) => candidate.id === invitationId && candidate.workspace_id === workspaceId
                  );
                  return (invitation ?? null) as T | null;
                }

                if (sql.includes("FROM workspace_invitations") && sql.includes("WHERE id = ?")) {
                  const [invitationId] = params;
                  const invitation = input.invitations?.find((candidate) => candidate.id === invitationId);
                  return (invitation ?? null) as T | null;
                }

                if (
                  sql.includes("FROM workspace_memberships m") &&
                  sql.includes("JOIN user u") &&
                  sql.includes("lower(u.email)")
                ) {
                  return null;
                }

                if (
                  sql.includes("SELECT id FROM workspace_invitations") &&
                  sql.includes("status = 'pending'")
                ) {
                  const [workspaceId, email] = params;
                  const invitation = input.invitations?.find(
                    (candidate) =>
                      candidate.workspace_id === workspaceId &&
                      candidate.email === email &&
                      candidate.status === "pending",
                  );
                  return (invitation ? { id: invitation.id } : null) as T | null;
                }

                throw new Error(`Unhandled fixture SQL: ${sql}`);
              },
              async all<T>() {
                if (sql.includes("JOIN workspaces") && sql.includes("ORDER BY t.created_at DESC")) {
                  const [userId] = params;
                  return {
                    results: input.memberships
                      .filter((membership) => membership.user_id === userId)
                      .map((membership) => {
                        const workspace = input.workspaces.find((candidate) => candidate.id === membership.workspace_id);
                        if (!workspace) {
                          return null;
                        }
                        return {
                          id: workspace.id,
                          name: workspace.name,
                          created_at: workspace.created_at,
                          max_source_file_bytes: workspace.max_source_file_bytes,
                          has_api_key: workspace.api_key_hash !== null,
                          role: membership.role
                        };
                      })
                      .filter((workspace) => workspace !== null)
                      .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  } as T;
                }

                if (sql.includes("SELECT source_file_key") && sql.includes("FROM jobs")) {
                  return { results: (input.jobSourceFileKeys ?? []).map((source_file_key) => ({ source_file_key })) } as T;
                }

                throw new Error(`Unhandled fixture SQL: ${sql}`);
              }
            };
          }
        };
      }
    },
    WORKSPACE_BILLING_LEDGER: input.billingLedgerSummariesByWorkspace
      ? {
          getByName(workspaceId: string) {
            return {
              async summarizeOwnerBilling() {
                return input.billingLedgerSummariesByWorkspace?.[workspaceId] ?? {
                  credits: { total_available: 10 },
                  current_period: { pages_remaining: 100 },
                };
              },
              async refundReservation() {
                billingLedgerMutationCalls.push("refundReservation");
              },
              async recordCreditRefund() {
                billingLedgerMutationCalls.push("recordCreditRefund");
              },
              async correctPlanPageUsage() {
                billingLedgerMutationCalls.push("correctPlanPageUsage");
              },
            };
          },
        } as unknown as DurableObjectNamespace
      : undefined,
    SOURCE_FILES_BUCKET: { delete: async (key: string) => {
      deletedSourceFileKeys.push(key);
      deletionEvents.push(`source-file-deleted:${key}`);
    } },
    STRIPE_API_KEY: "stripe-secret-test-key",
    deletedSourceFileKeys,
    cleanedSourceFiles,
    erasedProductStoreWorkspaces,
    deletionEvents,
    billingLedgerMutationCalls,
    retainedBillingRecords,
    createdTemplates,
    createdTemplateFields,
    createdProductStoreTemplates,
  } as unknown as Env & {
    deletedSourceFileKeys: string[];
    cleanedSourceFiles: ResidualSourceFileFixture[];
    erasedProductStoreWorkspaces: string[];
    deletionEvents: string[];
    billingLedgerMutationCalls: string[];
    retainedBillingRecords: RetainedBillingRecordFixture[];
    createdTemplates: TemplateFixture[];
    createdTemplateFields: TemplateFieldFixture[];
    createdProductStoreTemplates: TemplateFixture[];
  };
}

describe("Workspace routes", () => {
  it("repairs a signed-in user's zero accepted Workspace state when listing Workspaces", async () => {
    const env = createEnvFixture({ workspaces: [], memberships: [] });

    const response = await listWorkspacesForUser(env, "user_new", "Alex");
    const body = await response.json<WorkspaceListingResponse>();

    expect(body).toEqual({
      workspaces: [
        {
          id: expect.stringMatching(/^workspace_/),
          name: "Alex Workspace",
          created_at: expect.any(String),
          max_source_file_bytes: null,
          has_api_key: false,
          role: "owner",
          billing_plan_limits: freePlanLimits(),
          billing_usage_summary: freeBillingUsageSummary(),
        }
      ]
    });
    expect(body.workspaces[0]).not.toHaveProperty("api_key");
    expect(env.createdTemplates).toEqual([]);
    expect(env.createdTemplateFields).toEqual([]);
    expect(env.createdProductStoreTemplates).toEqual([
      {
        workspace_id: body.workspaces[0].id,
        name: "Example Invoice",
        fields: [
          expect.objectContaining({ id: "invoice_number", name: "Invoice Number" }),
          expect.objectContaining({ id: "invoice_date", name: "Invoice Date" }),
          expect.objectContaining({ id: "vendor_name", name: "Vendor Name" }),
          expect.objectContaining({ id: "total_amount", name: "Total Amount" }),
          expect.objectContaining({ id: "currency", name: "Currency" }),
        ],
      },
    ]);
  });

  it("repairs a signed-in user's accepted Workspace state when they only have pending Workspace invitations", async () => {
    const invitedWorkspace = createWorkspace({ id: "workspace_invited", name: "Invited Workspace" });
    const env = createEnvFixture({
      workspaces: [invitedWorkspace],
      memberships: [{ workspace_id: invitedWorkspace.id, user_id: "user_owner", role: "owner" }],
      invitations: [{ id: "invite_123", workspace_id: invitedWorkspace.id, email: "alex@example.com", status: "pending" }]
    });

    const response = await listWorkspacesForUser(env, "user_invited", "Alex");
    const body = await response.json<WorkspaceListingResponse>();

    expect(body.workspaces).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^workspace_/),
        name: "Alex Workspace",
        has_api_key: false,
        role: "owner"
      })
    ]);
    expect(body.workspaces).not.toContainEqual(expect.objectContaining({ id: invitedWorkspace.id }));
  });

  it("creates a workspace response without one-time API key material", async () => {
    const env = createEnvFixture({ workspaces: [], memberships: [] });

    const response = await createWorkspaceForUser(
      new Request("https://example.test/v1/workspaces", { method: "POST", body: JSON.stringify({ name: "Research" }) }),
      env,
      "user_owner"
    );
    const body = await response.json<CreatedWorkspaceResponse>();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      workspace_id: expect.stringMatching(/^workspace_/),
      has_api_key: false,
      name: "Research",
      role: "owner",
      created_at: expect.any(String)
    });
    expect(body).not.toHaveProperty("api_key");
    await expect((await listWorkspacesForUser(env, "user_owner")).json()).resolves.toEqual({
      workspaces: [
        {
          id: body.workspace_id,
          name: "Research",
          created_at: body.created_at,
          max_source_file_bytes: null,
          has_api_key: false,
          role: "owner",
          billing_plan_limits: freePlanLimits(),
          billing_usage_summary: freeBillingUsageSummary(),
        }
      ]
    });
  });

  it("includes limited plan-overage operational status on Workspace listings", async () => {
    const workspace = createWorkspace({ id: "workspace_limits", name: "Limits Workspace" });
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [
        { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
        { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
        { workspace_id: workspace.id, user_id: "user_member", role: "member" },
        { workspace_id: workspace.id, user_id: "user_extra", role: "member" },
      ],
      billingLedgerSummariesByWorkspace: {
        [workspace.id]: {
          credits: { total_available: 10 },
          current_period: { pages_remaining: 100 },
        },
      },
      planLimitUsageByWorkspace: {
        [workspace.id]: {
          active_template_count: 4,
          templates: [
            {
              template_id: "tpl_over_limit",
              top_level_template_fields: 6,
              table_shaped_fields: 2,
              max_table_columns_per_field: 6,
            },
          ],
        },
      },
    });

    const body = await (await listWorkspacesForUser(env, "user_owner")).json<WorkspaceListingResponse>();

    expect(body.workspaces).toEqual([
      expect.objectContaining({
        id: workspace.id,
        billing_plan_limits: freePlanLimits(),
        billing_usage_summary: {
          remaining_credits: 10,
          remaining_pages: 100,
        },
        billing_operational_status: {
          status: "blocked",
          blocking_reasons: [
            "Member limit overage",
            "Template limit overage",
            "Template schema limit overage",
          ],
        },
      }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/invoice|payment|checkout/i);
  });

  it("uses No-billing entitlement for Workspace listing operational status", async () => {
    const workspace = createWorkspace({ id: "workspace_no_billing", name: "No Billing Workspace" });
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [
        { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
        { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
        { workspace_id: workspace.id, user_id: "user_member", role: "member" },
        { workspace_id: workspace.id, user_id: "user_extra", role: "member" },
      ],
      billingControlByWorkspace: {
        [workspace.id]: {
          no_billing_enabled: 1,
          no_billing_reason: "Internal evaluation workspace",
          no_billing_updated_by_user_id: "user_admin",
          no_billing_updated_at: "2026-05-31T12:00:00.000Z",
        },
      },
      billingLedgerSummariesByWorkspace: {
        [workspace.id]: {
          credits: { total_available: 0 },
          current_period: { pages_remaining: null },
        },
      },
      planLimitUsageByWorkspace: {
        [workspace.id]: {
          active_template_count: 20,
          templates: [
            {
              template_id: "tpl_enterprise_profile",
              top_level_template_fields: 25,
              table_shaped_fields: 1,
              max_table_columns_per_field: 20,
            },
          ],
        },
      },
    });

    const body = await (await listWorkspacesForUser(env, "user_owner")).json<WorkspaceListingResponse>();

    expect(body.workspaces).toEqual([
      expect.objectContaining({
        id: workspace.id,
        billing_plan_limits: expect.objectContaining({
          top_level_template_fields: 25,
          table_shaped_fields: 1,
          table_columns_per_field: 20,
        }),
        billing_usage_summary: {
          remaining_credits: null,
          remaining_pages: null,
        },
        billing_operational_status: {
          status: "active",
          blocking_reasons: [],
        },
      }),
    ]);
  });

  it("blocks Workspace API key generation when API access entitlement is inactive", async () => {
    const workspace = createWorkspace({ id: "workspace_key", api_key_hash: null });
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    await expect(rotateWorkspaceApiKeyForUser(
      new Request("https://example.test/v1/workspaces/workspace_key/api-key", { method: "POST" }),
      env,
      workspace.id,
      "user_owner"
    )).rejects.toMatchObject({
      status: 402,
      code: "api_access_entitlement_inactive",
      message: "Workspace plan does not include API access",
    } satisfies Partial<HttpError>);
    expect(workspace.api_key_hash).toBeNull();
  });

  it("allows Workspace API key generation when paid API access entitlement is active", async () => {
    const workspace = createWorkspace({ id: "workspace_key", api_key_hash: null });
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }],
      billingControlByWorkspace: {
        [workspace.id]: {
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "active",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2099-06-30T12:00:00.000Z",
        },
      },
    });

    const response = await rotateWorkspaceApiKeyForUser(
      new Request("https://example.test/v1/workspaces/workspace_key/api-key", { method: "POST" }),
      env,
      workspace.id,
      "user_owner",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      workspace_id: workspace.id,
      api_key: expect.stringMatching(/^key_/),
    });
    expect(workspace.api_key_hash).toEqual(expect.any(String));
  });

  it("blocks Workspace invitations when the accepted membership count is at the Active entitlement limit", async () => {
    const workspace = createWorkspace({ id: "workspace_team" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const invitations: WorkspaceInvitationFixture[] = [];
    const env = createEnvFixture({ workspaces: [workspace], memberships, invitations });

    await expect(inviteUserToWorkspace(
      new Request("https://example.test/v1/workspaces/workspace_team/invitations", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", role: "member" })
      }),
      env,
      workspace.id,
      "user_owner"
    )).rejects.toMatchObject({
      status: 402,
      code: "member_limit_exceeded",
      message: "Workspace has reached the Free plan limit of 3 members",
    } satisfies Partial<HttpError>);
    expect(memberships).toHaveLength(3);
    expect(invitations).toEqual([]);
  });

  it("does not immediately repair another user's accepted Workspace state when removing their last membership", async () => {
    const workspace = createWorkspace({ id: "workspace_team" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const workspaces = [workspace];
    const env = createEnvFixture({ workspaces, memberships });

    const response = await updateWorkspaceUserRoleForUser(
      new Request("https://example.test/v1/workspaces/workspace_team/users/user_member", {
        method: "PATCH",
        body: JSON.stringify({ action: "remove_user" })
      }),
      env,
      workspace.id,
      "user_owner",
      "user_member"
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      workspace_id: workspace.id,
      target_user_id: "user_member",
      action: "remove_user"
    });
    expect(memberships).toEqual([{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]);
    expect(workspaces.filter((candidate) => candidate.created_by_user_id === "user_member")).toEqual([]);
  });

  it("updates the Stripe Customer billing email when Workspace ownership transfers", async () => {
    const workspace = createWorkspace({ id: "workspace_team" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "cus_workspace_team" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships,
      stripeCustomerIdByWorkspace: { [workspace.id]: "cus_workspace_team" },
      users: [{ id: "user_member", email: "new-owner@example.com", name: "New Owner" }],
    });

    const response = await updateWorkspaceUserRoleForUser(
      new Request("https://example.test/v1/workspaces/workspace_team/users/user_member", {
        method: "PATCH",
        body: JSON.stringify({ action: "make_owner" })
      }),
      env,
      workspace.id,
      "user_owner",
      "user_member"
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      workspace_id: workspace.id,
      target_user_id: "user_member",
      role: "owner",
    });
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "admin" },
      { workspace_id: workspace.id, user_id: "user_member", role: "owner" },
    ]);
    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/customers/cus_workspace_team",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer stripe-secret-test-key",
          "content-type": "application/x-www-form-urlencoded",
          "stripe-version": "2026-05-27.dahlia",
          "idempotency-key": "stripe-customer-owner:workspace_team:user_member",
        }),
        body: expect.any(String),
      }),
    );
    const stripeBody = new URLSearchParams(String(stripeFetch.mock.calls[0]?.[1]?.body));
    expect(stripeBody.get("email")).toBe("new-owner@example.com");
    expect(stripeBody.get("metadata[current_workspace_owner_user_id]")).toBe("user_member");
    stripeFetch.mockRestore();
  });

  it("repairs a removed user's accepted Workspace state on their next Workspace listing", async () => {
    const workspace = createWorkspace({ id: "workspace_team" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const env = createEnvFixture({ workspaces: [workspace], memberships });

    await updateWorkspaceUserRoleForUser(
      new Request("https://example.test/v1/workspaces/workspace_team/users/user_member", {
        method: "PATCH",
        body: JSON.stringify({ action: "remove_user" })
      }),
      env,
      workspace.id,
      "user_owner",
      "user_member"
    );
    const response = await listWorkspacesForUser(env, "user_member", "Mina");
    const body = await response.json<WorkspaceListingResponse>();

    expect(body.workspaces).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^workspace_/),
        name: "Mina Workspace",
        has_api_key: false,
        role: "owner"
      })
    ]);
  });

  it("blocks Workspace deletion while the Workspace is in Unpaid billing state", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      billingControlByWorkspace: {
        [workspace.id]: {
          stripe_subscription_id: "sub_unpaid_workspace_delete",
          stripe_subscription_item_id: "si_unpaid_workspace_delete",
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "unpaid",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    });

    await expect(deleteWorkspaceForUser(env, workspace.id, "user_owner")).rejects.toMatchObject({
      status: 402,
      code: "workspace_billing_unpaid",
      message: "Resolve unpaid billing invoices before deleting this Workspace",
    } satisfies Partial<HttpError>);

    expect(env.deletedSourceFileKeys).toEqual([]);
    expect(env.erasedProductStoreWorkspaces).toEqual([]);
    expect(env.deletionEvents).toEqual([]);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ]);
  });

  it("stops future self-service subscription billing before deleting an active paid Workspace", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      billingControlByWorkspace: {
        [workspace.id]: {
          stripe_subscription_id: "sub_active_workspace_delete",
          stripe_subscription_item_id: "si_active_workspace_delete",
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "active",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      env.deletionEvents.push("stripe-subscription-canceled:sub_active_workspace_delete");
      return new Response(JSON.stringify({ id: "sub_active_workspace_delete", status: "canceled" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const response = await deleteWorkspaceForUser(env, workspace.id, "user_owner");

    await expect(response.json()).resolves.toEqual({ ok: true, workspace_id: workspace.id });
    expect(stripeFetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/subscriptions/sub_active_workspace_delete",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          authorization: "Bearer stripe-secret-test-key",
          "content-type": "application/x-www-form-urlencoded",
          "stripe-version": "2026-05-27.dahlia",
          "idempotency-key": "workspace-delete-subscription:workspace_delete:sub_active_workspace_delete",
        }),
        body: expect.any(String),
      }),
    );
    const stripeBody = new URLSearchParams(String(stripeFetch.mock.calls[0]?.[1]?.body));
    expect(stripeBody.get("invoice_now")).toBe("false");
    expect(stripeBody.get("prorate")).toBe("false");
    expect(stripeBody.has("payment_method_types[0]")).toBe(false);
    expect(env.deletionEvents).toEqual([
      "stripe-subscription-canceled:sub_active_workspace_delete",
      "billing-entitlement-deactivated:workspace_delete",
      "billing-record-retained:workspace_delete",
      "product-data-erased:workspace_delete",
      "control-data-delete",
    ]);
    stripeFetch.mockRestore();
  });

  it("keeps Workspace data intact when self-service subscription cancellation fails during deletion", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      billingControlByWorkspace: {
        [workspace.id]: {
          stripe_subscription_id: "sub_failing_workspace_delete",
          stripe_subscription_item_id: "si_failing_workspace_delete",
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "active",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Stripe unavailable" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(deleteWorkspaceForUser(env, workspace.id, "user_owner")).rejects.toMatchObject({
      status: 502,
      code: "stripe_subscription_cancellation_failed",
      message: "Stripe subscription cancellation failed",
    } satisfies Partial<HttpError>);

    expect(stripeFetch).toHaveBeenCalledTimes(1);
    expect(env.deletedSourceFileKeys).toEqual([]);
    expect(env.erasedProductStoreWorkspaces).toEqual([]);
    expect(env.deletionEvents).toEqual([]);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ]);
    stripeFetch.mockRestore();
  });

  it("deactivates Workspace billing entitlement and retains a minimal billing record before deletion completes", async () => {
    const workspace = createWorkspace({ name: "Sensitive Workspace Name" });
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      billingControlByWorkspace: {
        [workspace.id]: {
          ledger_object_name: "workspace_delete",
          stripe_customer_id: "cus_workspace_delete",
          stripe_subscription_id: "sub_active_workspace_delete",
          stripe_subscription_item_id: "si_active_workspace_delete",
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "active",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
          scheduled_entitlement_plan: "free",
          scheduled_entitlement_effective_at: "2026-06-30T12:00:00.000Z",
        },
      },
      users: [{ id: "user_owner", email: "owner@example.com", name: "Owner Name" }],
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      env.deletionEvents.push("stripe-subscription-canceled:sub_active_workspace_delete");
      return new Response(JSON.stringify({ id: "sub_active_workspace_delete", status: "canceled" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const response = await deleteWorkspaceForUser(env, workspace.id, "user_owner");

    await expect(response.json()).resolves.toEqual({ ok: true, workspace_id: workspace.id });
    expect(env.deletionEvents).toEqual([
      "stripe-subscription-canceled:sub_active_workspace_delete",
      "billing-entitlement-deactivated:workspace_delete",
      "billing-record-retained:workspace_delete",
      "product-data-erased:workspace_delete",
      "control-data-delete",
    ]);
    expect(env.retainedBillingRecords).toEqual([
      {
        id: expect.stringMatching(/^retained_billing_/),
        workspace_id: workspace.id,
        actor_user_id: "user_owner",
        ledger_object_name: workspace.id,
        stripe_customer_id: "cus_workspace_delete",
        stripe_subscription_id: "sub_active_workspace_delete",
        self_service_subscription_status: "active",
        final_billing_state: "deleted",
        retained_reason: "workspace_deletion",
        snapshot: {
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "active",
          scheduled_entitlement_plan: "free",
          scheduled_entitlement_effective_at: "2026-06-30T12:00:00.000Z",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
        },
        retained_at: expect.any(String),
      },
    ]);
    expect(JSON.stringify(env.retainedBillingRecords)).not.toContain("Sensitive Workspace Name");
    expect(JSON.stringify(env.retainedBillingRecords)).not.toContain("owner@example.com");
    expect(JSON.stringify(env.retainedBillingRecords)).not.toContain("Owner Name");
    expect(env.retainedBillingRecords[0]?.retained_at).toEqual(expect.any(String));
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    stripeFetch.mockRestore();
  });

  it("blocks normal owner deletion for Workspaces with active Enterprise deal terms", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      billingControlByWorkspace: {
        [workspace.id]: {
          ledger_object_name: workspace.id,
          stripe_customer_id: "cus_enterprise_workspace_delete",
          stripe_subscription_id: null,
          stripe_subscription_item_id: null,
          self_service_subscription_plan: null,
          self_service_subscription_status: null,
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
          enterprise_deal_status: "active",
        },
      },
    });

    await expect(deleteWorkspaceForUser(env, workspace.id, "user_owner")).rejects.toMatchObject({
      status: 409,
      code: "enterprise_deletion_requires_admin",
      message: "Workspace has active Enterprise deal terms and requires Application admin handling before deletion",
    } satisfies Partial<HttpError>);

    expect(env.deletedSourceFileKeys).toEqual([]);
    expect(env.erasedProductStoreWorkspaces).toEqual([]);
    expect(env.deletionEvents).toEqual([]);
    expect(env.retainedBillingRecords).toEqual([]);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ]);
  });

  it("deletes a paid Workspace without creating Billing ledger refunds or usage corrections", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      billingControlByWorkspace: {
        [workspace.id]: {
          ledger_object_name: workspace.id,
          stripe_customer_id: "cus_workspace_delete",
          stripe_subscription_id: "sub_active_workspace_delete",
          stripe_subscription_item_id: "si_active_workspace_delete",
          self_service_subscription_plan: "pro",
          self_service_subscription_status: "active",
          stripe_subscription_current_period_start: "2026-05-31T12:00:00.000Z",
          stripe_subscription_current_period_end: "2026-06-30T12:00:00.000Z",
        },
      },
      billingLedgerSummariesByWorkspace: {
        [workspace.id]: {
          credits: { total_available: 250 },
          current_period: { pages_remaining: 1234 },
        },
      },
    });
    const stripeFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "sub_active_workspace_delete", status: "canceled" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await deleteWorkspaceForUser(env, workspace.id, "user_owner");

    await expect(response.json()).resolves.toEqual({ ok: true, workspace_id: workspace.id });
    expect(env.billingLedgerMutationCalls).toEqual([]);
    expect(env.retainedBillingRecords).toHaveLength(1);
    expect(stripeFetch).toHaveBeenCalledTimes(1);
    stripeFetch.mockRestore();
  });

  it("deletes a workspace through the cascade path after policy approval", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({ workspaces: [workspace, otherWorkspace], memberships });

    const response = await deleteWorkspaceForUser(env, workspace.id, "user_owner");

    await expect(response.json()).resolves.toEqual({ ok: true, workspace_id: workspace.id });
    expect(env.DB.prepare).toBeDefined();
    expect(memberships).toEqual([{ workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }]);
    expect(env.erasedProductStoreWorkspaces).toEqual([workspace.id]);
  });

  it("deletes residual Source files then hard-erases Workspace product data before control data", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      residualSourceFiles: [
        {
          job_id: "job_1",
          source_file_key: "workspaces/workspace_delete/jobs/job_1/source.pdf",
        },
      ],
    });

    await deleteWorkspaceForUser(env, workspace.id, "user_owner");

    expect(env.deletedSourceFileKeys).toEqual(["workspaces/workspace_delete/jobs/job_1/source.pdf"]);
    expect(env.cleanedSourceFiles).toEqual([
      {
        job_id: "job_1",
        source_file_key: "workspaces/workspace_delete/jobs/job_1/source.pdf",
      },
    ]);
    expect(env.erasedProductStoreWorkspaces).toEqual([workspace.id]);
    expect(env.deletionEvents).toEqual([
      "source-file-deleted:workspaces/workspace_delete/jobs/job_1/source.pdf",
      "source-file-cleaned:workspaces/workspace_delete/jobs/job_1/source.pdf",
      "product-data-erased:workspace_delete",
      "control-data-delete",
    ]);
  });

  it("keeps Workspace control data retryable when product data hard-erasure fails", async () => {
    const workspace = createWorkspace();
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace, otherWorkspace],
      memberships,
      productStoreEraseError: new Error("deleteAll failed"),
    });

    await expect(deleteWorkspaceForUser(env, workspace.id, "user_owner")).rejects.toThrow("deleteAll failed");

    expect(env.erasedProductStoreWorkspaces).toEqual([]);
    expect(env.deletionEvents).not.toContain("control-data-delete");
    expect(env.deletionEvents).not.toContain(`product-data-erased:${workspace.id}`);
    expect(env.deletedSourceFileKeys).toEqual([]);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
    ]);
  });

  it("preserves last-workspace HTTP semantics from policy rejection", async () => {
    const workspace = createWorkspace();
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    await expect(deleteWorkspaceForUser(env, workspace.id, "user_owner")).rejects.toMatchObject({
      status: 409,
      code: "last_workspace",
      message: "You cannot delete your only workspace"
    } satisfies Partial<HttpError>);
  });

  it("returns a minimal response when cancelling a workspace invitation", async () => {
    const workspace = createWorkspace({ id: "workspace_123" });
    const invitations: WorkspaceInvitationFixture[] = [
      { id: "invite_123", workspace_id: workspace.id, email: "invited@example.com", status: "pending" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }],
      invitations
    });

    const response = await cancelWorkspaceInvitationForUser(env, workspace.id, "invite_123", "user_owner");

    await expect(response.json()).resolves.toEqual({ ok: true, invitation_id: "invite_123", status: "cancelled" });
    expect(invitations[0]?.status).toBe("cancelled");
  });

  it("returns a minimal response when a workspace admin leaves", async () => {
    const workspace = createWorkspace({ id: "workspace_leave" });
    const otherWorkspace = createWorkspace({ id: "workspace_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: otherWorkspace.id, user_id: "user_admin", role: "member" }
    ];
    const env = createEnvFixture({ workspaces: [workspace, otherWorkspace], memberships });

    const response = await leaveWorkspaceForUser(env, workspace.id, "user_admin");

    await expect(response.json()).resolves.toEqual({ ok: true, workspace_id: workspace.id });
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_admin", role: "member" }
    ]);
  });

  it("creates a Replacement personal Workspace immediately when leaving the last accepted Workspace", async () => {
    const workspace = createWorkspace({ id: "workspace_leave" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const env = createEnvFixture({ workspaces: [workspace], memberships });

    const response = await leaveWorkspaceForUser(env, workspace.id, "user_member", "Mina");
    const body = await response.json<LeftWorkspaceResponse>();

    expect(body).toEqual({
      ok: true,
      workspace_id: workspace.id,
      replacement_workspace: {
        workspace_id: expect.stringMatching(/^workspace_/),
        has_api_key: false,
        name: "Mina Workspace",
        role: "owner",
        created_at: expect.any(String)
      }
    });
    expect(body.replacement_workspace).not.toHaveProperty("api_key");
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      {
        workspace_id: body.replacement_workspace?.workspace_id,
        user_id: "user_member",
        role: "owner"
      }
    ]);
  });

  it("rejects owner leave attempts without changing the workspace", async () => {
    const workspace = createWorkspace({ id: "workspace_leave", api_key_hash: "hash_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const env = createEnvFixture({ workspaces: [workspace], memberships });

    await expect(leaveWorkspaceForUser(env, workspace.id, "user_owner")).rejects.toMatchObject({
      status: 409,
      code: "owner_transfer_required",
      message: "Transfer ownership or delete the workspace before leaving"
    } satisfies Partial<HttpError>);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ]);
    expect(workspace.api_key_hash).toBe("hash_keep");
  });

  it("rejects non-member leave attempts without changing memberships", async () => {
    const workspace = createWorkspace({ id: "workspace_leave", api_key_hash: "hash_keep" });
    const memberships: MembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const env = createEnvFixture({ workspaces: [workspace], memberships });

    await expect(leaveWorkspaceForUser(env, workspace.id, "user_outsider")).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "You are not a member of this workspace"
    } satisfies Partial<HttpError>);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ]);
    expect(workspace.api_key_hash).toBe("hash_keep");
  });

  it("returns a minimal response when an invitee declines a workspace invitation", async () => {
    const workspace = createWorkspace({ id: "workspace_123" });
    const invitations: WorkspaceInvitationFixture[] = [
      { id: "invite_123", workspace_id: workspace.id, email: "invited@example.com", status: "pending" }
    ];
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [],
      invitations
    });

    const response = await declineInvitation(env, "invite_123", " Invited@Example.COM ");

    await expect(response.json()).resolves.toEqual({ ok: true, invitation_id: "invite_123", status: "cancelled" });
    expect(invitations[0]?.status).toBe("cancelled");
  });
});
