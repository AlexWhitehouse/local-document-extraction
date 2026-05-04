import { HttpError, json } from "../lib/http";
import { deleteWorkspaceCascade } from "../lib/cascadeDelete";
import {
  acceptWorkspaceInvitation as acceptWorkspaceInvitationPolicy,
  approveWorkspaceDeletionForUser as approveWorkspaceDeletionForUserPolicy,
  cancelWorkspaceInvitationForUser as cancelWorkspaceInvitationForUserPolicy,
  createWorkspaceForUser as createWorkspaceForUserPolicy,
  declineWorkspaceInvitation as declineWorkspaceInvitationPolicy,
  inviteWorkspaceMember as inviteWorkspaceMemberPolicy,
  listManageableWorkspaceInvitationsForUser as listManageableWorkspaceInvitationsForUserPolicy,
  listPendingWorkspaceInvitationsForEmail as listPendingWorkspaceInvitationsForEmailPolicy,
  listWorkspaceUsersForUser as listWorkspaceUsersForUserPolicy,
  listWorkspacesForUser as listWorkspacesForUserPolicy,
  rotateWorkspaceApiKeyForUser as rotateWorkspaceApiKeyForUserPolicy,
  updateWorkspaceSettingsForUser as updateWorkspaceSettingsForUserPolicy,
  updateWorkspaceUserRoleForUser as updateWorkspaceUserRoleForUserPolicy,
  WorkspacePolicyError
} from "../lib/workspacePolicy";
import { parseJsonBody } from "../lib/validation";
import type { Env } from "../lib/types";

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

export async function listWorkspacesForUser(env: Env, userId: string): Promise<Response> {
  const workspaces = await listWorkspacesForUserPolicy(env.DB, { userId });
  return json({ workspaces });
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

  await deleteWorkspaceCascade(env, workspaceId);
  return json({ ok: true, workspace_id: workspaceId });
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
    return json(await inviteWorkspaceMemberPolicy(env.DB, { workspaceId, inviterUserId, email: payload.email, role: payload.role }), 201);
  } catch (error) {
    mapWorkspacePolicyError(error);
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
    return json(
      await updateWorkspaceUserRoleForUserPolicy(env.DB, {
        workspaceId,
        actingUserId,
        targetUserId,
        action: action as "remove_user" | "make_admin" | "make_owner"
      })
    );
  } catch (error) {
    mapWorkspacePolicyError(error);
  }
}

export async function rotateWorkspaceApiKeyForUser(
  _request: Request,
  env: Env,
  workspaceId: string,
  userId: string
): Promise<Response> {
  try {
    return json(await rotateWorkspaceApiKeyForUserPolicy(env.DB, { workspaceId, userId }));
  } catch (error) {
    mapWorkspacePolicyError(error);
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
