import { createExtractionJob } from "./api/extract";
import {
  generateEnterpriseAnnualOverageInvoices,
  generateEnterpriseRampUpInvoices,
  getWorkspaceBillingSummaryForUser,
  getWorkspaceBillingUsageForUser,
  createEnterpriseAnnualCommitmentForApplicationAdmin,
  createEnterpriseRampUpForApplicationAdmin,
  createNoPaymentPlanOverrideForApplicationAdmin,
  createPaymentRequiredPlanOverrideForApplicationAdmin,
  getApplicationAdminWorkspaceBillingState,
  grantGoodwillCreditsForApplicationAdmin,
  handleStripeBillingWebhook,
  listApplicationAdminBillingAuditLog,
  searchApplicationAdminBillingWorkspaces,
  listWorkspaceBillingActivityForUser,
  reconcileWorkspaceBilling,
  scheduleSubscriptionCancellationForUser,
  revokeGoodwillCreditGrantForApplicationAdmin,
  startCreditPackCheckoutForUser,
  startSubscriptionChangeForUser,
  startSubscriptionCheckoutForUser,
  updateNoBillingModeForApplicationAdmin,
} from "./api/billing";
import { deleteJob, getJob, listJobs } from "./api/jobs";
import { DocumentProcessingWorkflow } from "./consumer/documentProcessingWorkflow";
import { getProfileForUser, updateProfileForUser } from "./api/profile";
import {
  acceptInvitation,
  cancelWorkspaceInvitationForUser,
  createWorkspaceForUser,
  declineInvitation,
  deleteWorkspaceForUser,
  inviteUserToWorkspace,
  leaveWorkspaceForUser,
  listInvitationsForUser,
  listWorkspaceInvitationsForUser,
  listWorkspaceUsersForUser,
  listWorkspacesForUser,
  rotateWorkspaceApiKeyForUser,
  updateWorkspaceUserRoleForUser,
  updateWorkspaceForUser
} from "./api/workspaces";
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from "./api/templates";
import { processJob } from "./consumer/processJob";
import { authenticate, requireSession } from "./lib/auth";
import { evaluateAccountPasswordPolicy } from "./lib/accountPasswordPolicy";
import { createAuth } from "./lib/betterAuth";
import { HttpError, json, toHttpError } from "./lib/http";
import { WorkspaceBillingLedger } from "./lib/workspaceBillingLedger";
import { WorkspaceProductStore } from "./lib/workspaceProductStore";
import { authorizeWorkspaceForSession } from "./lib/workspacePolicy";
import type { QueueJobMessage } from "./lib/types";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      const httpError = toHttpError(error);
      return json(
        {
          error: {
            code: httpError.code,
            message: httpError.message
          }
        },
        httpError.status
      );
    }
  },

  async queue(batch: MessageBatch<QueueJobMessage>, env: Env): Promise<void> {
    await Promise.all(
      batch.messages.map(async (msg) => {
        try {
          await processJob(msg.body, env);
          msg.ack();
        } catch (error) {
          console.error("Queue processing failed", error);
          msg.retry();
        }
      }),
    );
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    const invoiceGeneration = Promise.all([
      generateEnterpriseRampUpInvoices(env, scheduledAt),
      generateEnterpriseAnnualOverageInvoices(env, scheduledAt),
      reconcileWorkspaceBilling(env, scheduledAt),
    ]);
    ctx.waitUntil(invoiceGeneration);
    await invoiceGeneration;
  }
} satisfies ExportedHandler<Env, QueueJobMessage>;

export { DocumentProcessingWorkflow };
export { WorkspaceBillingLedger };
export { WorkspaceProductStore };

async function handleRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth")) {
    await enforceAccountPasswordPolicyForAuthRequest(request, url);
    const auth = createAuth(env, request, ctx);
    return auth.handler(request);
  }

  if (request.method === "GET" && url.pathname === "/v1/health") {
    return json({ ok: true, service: "document-extraction-api" });
  }

  if (request.method === "POST" && url.pathname === "/v1/billing/stripe/webhook") {
    return handleStripeBillingWebhook(request, env);
  }

  if (request.method === "POST" && url.pathname === "/v1/workspaces") {
    const session = await requireSession(request, env);
    return createWorkspaceForUser(request, env, session.id);
  }

  if (request.method === "GET" && url.pathname === "/v1/workspaces") {
    const session = await requireSession(request, env);
    return listWorkspacesForUser(env, session.id, session.name);
  }

  if (/^\/v1\/workspaces\/[^/]+\/live$/.test(url.pathname)) {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "Workspace live updates require GET");
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(400, "invalid_websocket_upgrade", "Expected WebSocket upgrade");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot open live updates");
    }
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    const session = await requireSession(request, env);
    const workspace = await authorizeWorkspaceForSession(env.DB, { workspaceId, userId: session.id });
    if (!workspace) {
      throw new HttpError(403, "forbidden", "You do not have access to this workspace");
    }
    return env.WORKSPACE_PRODUCT_STORE.getByName(workspace.id).fetch(request);
  }

  if (request.method === "GET" && url.pathname === "/v1/invitations") {
    const session = await requireSession(request, env);
    return listInvitationsForUser(env, session.email);
  }

  if (request.method === "GET" && url.pathname === "/v1/profile") {
    const session = await requireSession(request, env);
    return getProfileForUser(env, session.id);
  }

  if (request.method === "PATCH" && url.pathname === "/v1/profile") {
    const session = await requireSession(request, env);
    return updateProfileForUser(request, env, session.id);
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/invitations/") && url.pathname.endsWith("/accept")) {
    const session = await requireSession(request, env);
    const invitationId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!invitationId) {
      throw new HttpError(404, "not_found", "Invitation not found");
    }
    return acceptInvitation(env, invitationId, session.id, session.email);
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/invitations/") && url.pathname.endsWith("/decline")) {
    const session = await requireSession(request, env);
    const invitationId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!invitationId) {
      throw new HttpError(404, "not_found", "Invitation not found");
    }
    return declineInvitation(env, invitationId, session.email);
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/workspaces/") && url.pathname.endsWith("/invitations")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return inviteUserToWorkspace(request, env, workspaceId, session.id);
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/workspaces/") && url.pathname.endsWith("/invitations")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return listWorkspaceInvitationsForUser(env, workspaceId, session.id);
  }

  if (request.method === "DELETE" && /^\/v1\/workspaces\/[^/]+\/invitations\/[^/]+$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const parts = url.pathname.split("/");
    const workspaceId = decodeURIComponent(parts[3] || "");
    const invitationId = decodeURIComponent(parts[5] || "");
    if (!workspaceId || !invitationId) {
      throw new HttpError(404, "not_found", "Invitation not found");
    }
    return cancelWorkspaceInvitationForUser(env, workspaceId, invitationId, session.id);
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/workspaces/") && url.pathname.endsWith("/users")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return listWorkspaceUsersForUser(env, workspaceId, session.id);
  }

  if (request.method === "GET" && url.pathname === "/v1/admin/billing/workspaces") {
    const session = await requireSession(request, env);
    return searchApplicationAdminBillingWorkspaces(request, env, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/goodwill-credits$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return grantGoodwillCreditsForApplicationAdmin(request, env, workspaceId, session);
  }

  if (request.method === "GET" && /^\/v1\/admin\/billing\/workspaces\/[^/]+$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return getApplicationAdminWorkspaceBillingState(env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/plan-overrides$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return createNoPaymentPlanOverrideForApplicationAdmin(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/payment-required-plan-overrides$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return createPaymentRequiredPlanOverrideForApplicationAdmin(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/enterprise-ramp-up$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return createEnterpriseRampUpForApplicationAdmin(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/enterprise-annual-commitments$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return createEnterpriseAnnualCommitmentForApplicationAdmin(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/no-billing$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return updateNoBillingModeForApplicationAdmin(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/goodwill-credits\/[^/]+\/revoke$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const parts = url.pathname.split("/");
    const workspaceId = decodeURIComponent(parts[5] || "");
    const grantId = decodeURIComponent(parts[7] || "");
    if (!workspaceId || !grantId) {
      throw new HttpError(404, "not_found", "Goodwill Credit grant not found");
    }
    return revokeGoodwillCreditGrantForApplicationAdmin(request, env, workspaceId, grantId, session);
  }

  if (request.method === "GET" && /^\/v1\/admin\/billing\/workspaces\/[^/]+\/audit-log$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[5] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return listApplicationAdminBillingAuditLog(env, workspaceId, session);
  }

  if (request.method === "GET" && /^\/v1\/workspaces\/[^/]+\/billing\/summary$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot read billing summaries");
    }
    const session = await requireSession(request, env);
    return getWorkspaceBillingSummaryForUser(request, env, workspaceId, session.id);
  }

  if (request.method === "GET" && /^\/v1\/workspaces\/[^/]+\/billing\/activity$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot read billing activity");
    }
    const session = await requireSession(request, env);
    return listWorkspaceBillingActivityForUser(request, env, workspaceId, session.id);
  }

  if (request.method === "GET" && /^\/v1\/workspaces\/[^/]+\/billing\/usage$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot read billing usage");
    }
    const session = await requireSession(request, env);
    return getWorkspaceBillingUsageForUser(request, env, workspaceId, session.id);
  }

  if (request.method === "POST" && /^\/v1\/workspaces\/[^/]+\/billing\/credit-packs\/checkout$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
    }
    const session = await requireSession(request, env);
    return startCreditPackCheckoutForUser(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/workspaces\/[^/]+\/billing\/subscriptions\/checkout$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
    }
    const session = await requireSession(request, env);
    return startSubscriptionCheckoutForUser(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/workspaces\/[^/]+\/billing\/subscriptions\/change$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
    }
    const session = await requireSession(request, env);
    return startSubscriptionChangeForUser(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/workspaces\/[^/]+\/billing\/subscriptions\/cancel$/.test(url.pathname)) {
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    if (request.headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ")) {
      throw new HttpError(403, "unsupported_auth_mode", "Workspace API keys cannot start billing Checkout");
    }
    const session = await requireSession(request, env);
    return scheduleSubscriptionCancellationForUser(request, env, workspaceId, session);
  }

  if (request.method === "POST" && /^\/v1\/workspaces\/[^/]+\/users\/[^/]+$/.test(url.pathname)) {
    const session = await requireSession(request, env);
    const parts = url.pathname.split("/");
    const workspaceId = decodeURIComponent(parts[3] || "");
    const targetUserId = decodeURIComponent(parts[5] || "");
    if (!workspaceId || !targetUserId) {
      throw new HttpError(404, "not_found", "Workspace user not found");
    }
    return updateWorkspaceUserRoleForUser(request, env, workspaceId, session.id, targetUserId);
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/workspaces/") && url.pathname.endsWith("/api-key")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return rotateWorkspaceApiKeyForUser(request, env, workspaceId, session.id);
  }

  if (request.method === "POST" && url.pathname.startsWith("/v1/workspaces/") && url.pathname.endsWith("/leave")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return leaveWorkspaceForUser(env, workspaceId, session.id, session.name);
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/v1/workspaces/")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return updateWorkspaceForUser(request, env, workspaceId, session.id);
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/v1/workspaces/")) {
    const session = await requireSession(request, env);
    const workspaceId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!workspaceId) {
      throw new HttpError(404, "not_found", "Workspace not found");
    }
    return deleteWorkspaceForUser(env, workspaceId, session.id);
  }

  if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/v1")) {
    return env.ASSETS.fetch(request);
  }

  const authContext = await authenticate(request, env);
  const workspace = authContext.workspace;

  if (request.method === "GET" && url.pathname === "/v1/jobs") {
    return listJobs(request, env, workspace);
  }

  if (request.method === "POST" && url.pathname === "/v1/templates") {
    return createTemplate(request, env, workspace);
  }
  if (request.method === "GET" && url.pathname === "/v1/templates") {
    return listTemplates(env, workspace);
  }

  if (url.pathname.startsWith("/v1/templates/")) {
    const templateId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!templateId) {
      throw new HttpError(404, "not_found", "Template not found");
    }

    if (request.method === "GET") {
      return getTemplate(env, workspace, templateId);
    }
    if (request.method === "PATCH") {
      return updateTemplate(request, env, workspace, templateId);
    }
    if (request.method === "DELETE") {
      return deleteTemplate(env, workspace, templateId);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/extract") {
    return createExtractionJob(request, env, authContext);
  }

  if ((request.method === "GET" || request.method === "DELETE") && url.pathname.startsWith("/v1/jobs/")) {
    const jobId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!jobId) {
      throw new HttpError(404, "not_found", "Job not found");
    }

    if (request.method === "GET") {
      return getJob(env, workspace, jobId);
    }

    return deleteJob(env, workspace, jobId);
  }

  throw new HttpError(404, "not_found", "Route not found");
}

async function enforceAccountPasswordPolicyForAuthRequest(
  request: Request,
  url: URL,
): Promise<void> {
  if (request.method !== "POST") {
    return;
  }

  const passwordField =
    url.pathname === "/api/auth/sign-up/email"
      ? "password"
      : url.pathname === "/api/auth/reset-password"
        ? "newPassword"
        : null;
  if (!passwordField) {
    return;
  }

  const body = await request.clone().json().catch(() => null);
  const password =
    body && typeof body === "object" && passwordField in body
      ? (body as Record<string, unknown>)[passwordField]
      : null;

  if (typeof password !== "string") {
    return;
  }

  if (!evaluateAccountPasswordPolicy(password).valid) {
    throw new HttpError(
      400,
      "password_policy_not_met",
      "Password must meet all complexity requirements.",
    );
  }
}
