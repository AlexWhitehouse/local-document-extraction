import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { deleteWorkspaceCascade } from "../lib/cascadeDelete";
import { parseJsonBody } from "../lib/validation";
import type { Env, WorkspaceMembershipRole } from "../lib/types";

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

const INVITEABLE_ROLES: ReadonlySet<WorkspaceMembershipRole> = new Set(["admin", "member"]);
const WORKSPACE_USER_ACTIONS = new Set(["remove_user", "make_admin", "make_owner"]);

export async function createWorkspaceForUser(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const payload = parseJsonBody<CreateWorkspaceBody>(await request.text());

  if (payload.name !== undefined && (typeof payload.name !== "string" || payload.name.trim().length === 0)) {
    throw new HttpError(400, "invalid_name", "name must be a non-empty string");
  }

  const workspaceId = newId("workspace");
  const apiKey = newId("key");
  const apiKeyHash = await sha256(apiKey);
  const now = nowIso();
  const workspaceName = typeof payload.name === "string" ? payload.name.trim() : workspaceId;

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO workspaces (id, api_key_hash, name, created_at, created_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(workspaceId, apiKeyHash, workspaceName, now, userId),
    env.DB
      .prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'owner', ?)`
      )
      .bind(workspaceId, userId, now)
  ]);

  return json(
    {
      workspace_id: workspaceId,
      api_key: apiKey,
      name: workspaceName,
      role: "owner",
      created_at: now
    },
    201
  );
}

export async function listWorkspacesForUser(env: Env, userId: string): Promise<Response> {
  const result = await env.DB
    .prepare(
      `SELECT t.id, t.name, t.created_at, t.max_image_bytes, m.role
       FROM workspace_memberships m
       JOIN workspaces t ON t.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY t.created_at DESC`
    )
    .bind(userId)
    .all<Record<string, unknown>>();

  return json({ workspaces: result.results });
}

export async function updateWorkspaceForUser(
  request: Request,
  env: Env,
  workspaceId: string,
  userId: string
): Promise<Response> {
  const member = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new HttpError(403, "forbidden", "Only owners/admins can update workspace settings");
  }

  const payload = parseJsonBody<UpdateWorkspaceBody>(await request.text());
  if (typeof payload.name !== "string" || payload.name.trim().length === 0) {
    throw new HttpError(400, "invalid_name", "name must be a non-empty string");
  }

  const name = payload.name.trim();
  await env.DB.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(name, workspaceId).run();

  return json({ workspace_id: workspaceId, name });
}

export async function deleteWorkspaceForUser(env: Env, workspaceId: string, userId: string): Promise<Response> {
  const member = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new HttpError(403, "forbidden", "You are not a member of this workspace");
  }
  if (member.role !== "owner") {
    throw new HttpError(403, "forbidden", "Only owners can delete workspaces");
  }

  const workspaceCountRow = await env.DB
    .prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number | string }>();

  const workspaceCount = Number(workspaceCountRow?.count || 0);
  if (workspaceCount <= 1) {
    throw new HttpError(409, "last_workspace", "You cannot delete your only workspace");
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
  const inviter = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, inviterUserId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!inviter) {
    throw new HttpError(403, "forbidden", "You are not a member of this workspace");
  }
  if (inviter.role !== "owner" && inviter.role !== "admin") {
    throw new HttpError(403, "forbidden", "Only owners/admins can invite users");
  }

  const payload = parseJsonBody<InviteBody>(await request.text());
  if (typeof payload.email !== "string") {
    throw new HttpError(400, "invalid_email", "email is required");
  }

  const email = payload.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new HttpError(400, "invalid_email", "email must be a valid address");
  }

  const role: WorkspaceMembershipRole =
    typeof payload.role === "string" && INVITEABLE_ROLES.has(payload.role as WorkspaceMembershipRole)
      ? (payload.role as WorkspaceMembershipRole)
      : "member";

  const existingPending = await env.DB
    .prepare(
      `SELECT id FROM workspace_invitations
       WHERE workspace_id = ? AND email = ? AND status = 'pending'
       LIMIT 1`
    )
    .bind(workspaceId, email)
    .first<{ id: string }>();

  if (existingPending) {
    throw new HttpError(409, "invite_exists", "A pending invitation already exists for this user");
  }

  const id = newId("invite");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB
    .prepare(
      `INSERT INTO workspace_invitations (
         id, workspace_id, email, role, status, invited_by_user_id, created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .bind(id, workspaceId, email, role, inviterUserId, now, now, expiresAt)
    .run();

  return json(
    {
      invitation_id: id,
      workspace_id: workspaceId,
      email,
      role,
      status: "pending",
      expires_at: expiresAt
    },
    201
  );
}

export async function listInvitationsForUser(env: Env, email: string): Promise<Response> {
  const result = await env.DB
    .prepare(
      `SELECT i.id, i.workspace_id, t.name AS workspace_name, i.email, i.role, i.status, i.created_at, i.expires_at
       FROM workspace_invitations i
       JOIN workspaces t ON t.id = i.workspace_id
       WHERE i.email = ? AND i.status = 'pending'
       ORDER BY i.created_at DESC`
    )
    .bind(email.trim().toLowerCase())
    .all<Record<string, unknown>>();

  return json({ invitations: result.results });
}

export async function listWorkspaceUsersForUser(env: Env, workspaceId: string, userId: string): Promise<Response> {
  const member = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new HttpError(403, "forbidden", "You are not a member of this workspace");
  }

  const users = await env.DB
    .prepare(
      `SELECT m.user_id, u.name, u.email, m.role, m.created_at
       FROM workspace_memberships m
       JOIN user u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY
         CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         u.name ASC,
         u.email ASC`
    )
    .bind(workspaceId)
    .all<Record<string, unknown>>();

  return json({ users: users.results });
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

  const actorMembership = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, actingUserId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!actorMembership) {
    throw new HttpError(403, "forbidden", "You are not a member of this workspace");
  }
  if (actorMembership.role !== "owner" && actorMembership.role !== "admin") {
    throw new HttpError(403, "forbidden", "Only owners/admins can manage users");
  }

  const targetMembership = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, targetUserId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!targetMembership) {
    throw new HttpError(404, "not_found", "Workspace user not found");
  }

  const payload = parseJsonBody<WorkspaceUserActionBody>(await request.text());
  const action = typeof payload.action === "string" ? payload.action.trim() : "";
  if (!WORKSPACE_USER_ACTIONS.has(action)) {
    throw new HttpError(400, "invalid_action", "action must be one of remove_user, make_admin, make_owner");
  }

  if (actorMembership.role === "admin") {
    if (action !== "remove_user") {
      throw new HttpError(403, "forbidden", "Admins can only remove member users");
    }
    if (targetMembership.role !== "member") {
      throw new HttpError(403, "forbidden", "Admins can only remove non-admin users");
    }

    await env.DB
      .prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, targetUserId)
      .run();

    return json({ ok: true, workspace_id: workspaceId, target_user_id: targetUserId, action: "remove_user" });
  }

  if (action === "remove_user") {
    if (targetMembership.role === "owner") {
      throw new HttpError(409, "owner_transfer_required", "Transfer ownership before removing the owner");
    }

    await env.DB
      .prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, targetUserId)
      .run();

    return json({ ok: true, workspace_id: workspaceId, target_user_id: targetUserId, action: "remove_user" });
  }

  if (action === "make_admin") {
    await env.DB
      .prepare("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, targetUserId)
      .run();

    return json({ ok: true, workspace_id: workspaceId, target_user_id: targetUserId, role: "admin" });
  }

  if (targetMembership.role === "owner") {
    return json({ ok: true, workspace_id: workspaceId, target_user_id: targetUserId, role: "owner" });
  }

  await env.DB.batch([
    env.DB
      .prepare("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND role = 'owner'")
      .bind(workspaceId),
    env.DB
      .prepare("UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?")
      .bind(workspaceId, targetUserId),
    env.DB
      .prepare("UPDATE workspaces SET created_by_user_id = ? WHERE id = ?")
      .bind(targetUserId, workspaceId)
  ]);

  return json({ ok: true, workspace_id: workspaceId, target_user_id: targetUserId, role: "owner" });
}

export async function rotateWorkspaceApiKeyForUser(
  _request: Request,
  env: Env,
  workspaceId: string,
  userId: string
): Promise<Response> {
  const member = await env.DB
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(workspaceId, userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new HttpError(403, "forbidden", "Only owners/admins can rotate workspace API keys");
  }

  const apiKey = newId("key");

  const apiKeyHash = await sha256(apiKey);
  await env.DB
    .prepare("UPDATE workspaces SET api_key_hash = ? WHERE id = ?")
    .bind(apiKeyHash, workspaceId)
    .run();

  return json({
    workspace_id: workspaceId,
    api_key: apiKey,
    rotated_at: nowIso()
  });
}

export async function acceptInvitation(
  env: Env,
  invitationId: string,
  userId: string,
  userEmail: string
): Promise<Response> {
  const invitation = await env.DB
    .prepare(
      `SELECT id, workspace_id, email, role, status, expires_at
       FROM workspace_invitations
       WHERE id = ?
       LIMIT 1`
    )
    .bind(invitationId)
    .first<{
      id: string;
      workspace_id: string;
      email: string;
      role: WorkspaceMembershipRole;
      status: string;
      expires_at: string;
    }>();

  if (!invitation || invitation.status !== "pending") {
    throw new HttpError(404, "not_found", "Invitation not found");
  }
  if (invitation.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
    throw new HttpError(403, "forbidden", "This invitation is for a different email address");
  }
  if (Date.parse(invitation.expires_at) < Date.now()) {
    await env.DB
      .prepare("UPDATE workspace_invitations SET status = 'expired', updated_at = ? WHERE id = ?")
      .bind(nowIso(), invitationId)
      .run();
    throw new HttpError(410, "invite_expired", "Invitation has expired");
  }

  const now = nowIso();
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role`
      )
      .bind(invitation.workspace_id, userId, invitation.role, now),
    env.DB
      .prepare(
        `UPDATE workspace_invitations
         SET status = 'accepted', accepted_by_user_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(userId, now, invitationId)
  ]);

  return json({ ok: true, workspace_id: invitation.workspace_id, role: invitation.role });
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

function bytesToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
