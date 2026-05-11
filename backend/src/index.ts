import { createExtractionJob } from "./api/extract";
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
import type { Env, QueueJobMessage } from "./lib/types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
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
  }
} satisfies ExportedHandler<Env, QueueJobMessage>;

export { DocumentProcessingWorkflow };

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth")) {
    await enforceAccountPasswordPolicyForSignUp(request, url);
    const auth = createAuth(env, request);
    return auth.handler(request);
  }

  if (request.method === "GET" && url.pathname === "/v1/health") {
    return json({ ok: true, service: "document-extraction-api" });
  }

  if (request.method === "POST" && url.pathname === "/v1/workspaces") {
    const session = await requireSession(request, env);
    return createWorkspaceForUser(request, env, session.id);
  }

  if (request.method === "GET" && url.pathname === "/v1/workspaces") {
    const session = await requireSession(request, env);
    return listWorkspacesForUser(env, session.id, session.name);
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
    return listJobs(request, env.DB, workspace);
  }

  if (request.method === "POST" && url.pathname === "/v1/templates") {
    return createTemplate(request, env.DB, workspace);
  }
  if (request.method === "GET" && url.pathname === "/v1/templates") {
    return listTemplates(env.DB, workspace);
  }

  if (url.pathname.startsWith("/v1/templates/")) {
    const templateId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!templateId) {
      throw new HttpError(404, "not_found", "Template not found");
    }

    if (request.method === "GET") {
      return getTemplate(env.DB, workspace, templateId);
    }
    if (request.method === "PATCH") {
      return updateTemplate(request, env.DB, workspace, templateId);
    }
    if (request.method === "DELETE") {
      return deleteTemplate(env, workspace, templateId);
    }
  }

  if (request.method === "POST" && url.pathname === "/v1/extract") {
    return createExtractionJob(request, env, workspace);
  }

  if ((request.method === "GET" || request.method === "DELETE") && url.pathname.startsWith("/v1/jobs/")) {
    const jobId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!jobId) {
      throw new HttpError(404, "not_found", "Job not found");
    }

    if (request.method === "GET") {
      return getJob(env.DB, workspace, jobId);
    }

    return deleteJob(env, workspace, jobId);
  }

  throw new HttpError(404, "not_found", "Route not found");
}

async function enforceAccountPasswordPolicyForSignUp(
  request: Request,
  url: URL,
): Promise<void> {
  if (request.method !== "POST" || url.pathname !== "/api/auth/sign-up/email") {
    return;
  }

  const body = await request.clone().json().catch(() => null);
  const password =
    body && typeof body === "object" && "password" in body
      ? (body as { password?: unknown }).password
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
