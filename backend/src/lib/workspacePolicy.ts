import type { Workspace, WorkspaceMembershipRole } from "./types";
import { newId, nowIso } from "./ids";

const INVITEABLE_ROLES: ReadonlySet<WorkspaceMembershipRole> = new Set(["admin", "member"]);

export type WorkspaceListing = {
  id: string;
  name: string | null;
  created_at: string;
  max_image_bytes: number | null;
  role: "owner" | "admin" | "member";
};

export type WorkspaceUserListing = {
  user_id: string;
  name: string | null;
  email: string;
  role: WorkspaceMembershipRole;
  created_at: string;
};

export type WorkspaceUserRoleAction = "remove_user" | "make_admin" | "make_owner";

export type UpdatedWorkspaceUserRole =
  | { ok: true; workspace_id: string; target_user_id: string; action: "remove_user" }
  | { ok: true; workspace_id: string; target_user_id: string; role: "admin" | "owner" };

export type CreatedWorkspace = {
  workspace_id: string;
  api_key: string;
  name: string;
  role: "owner";
  created_at: string;
};

export type StarterTemplateAdapter = {
  createStarterTemplate(input: { workspaceId: string; createdAt: string }): Promise<void>;
};

export type BootstrappedWorkspace = CreatedWorkspace & { created: true };

export type ExistingBootstrappedWorkspace = { created: false; workspace_id: string };

export type UpdatedWorkspaceSettings = {
  workspace_id: string;
  name: string;
};

export type RotatedWorkspaceApiKey = {
  workspace_id: string;
  api_key: string;
  rotated_at: string;
};

export type CreatedWorkspaceInvitation = {
  invitation_id: string;
  workspace_id: string;
  email: string;
  role: "admin" | "member";
  status: "pending";
  expires_at: string;
};

export type PendingWorkspaceInvitation = {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  email: string;
  role: "admin" | "member";
  status: "pending";
  inviter_user_id: string;
  inviter_name: string | null;
  inviter_email: string;
  inviter_display: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type ManageableWorkspaceInvitation = PendingWorkspaceInvitation & {
  inviter_user_id: string;
  inviter_name: string | null;
  inviter_email: string;
  inviter_display: string;
};

export type AcceptedWorkspaceInvitation = {
  ok: true;
  workspace_id: string;
  role: WorkspaceMembershipRole;
};

export type CancelledWorkspaceInvitation = {
  ok: true;
  invitation_id: string;
  status: "cancelled";
};

export type LeftWorkspace = {
  ok: true;
  workspace_id: string;
  replacement_workspace?: CreatedWorkspace;
};

export class WorkspacePolicyError extends Error {
  constructor(
    public readonly code:
      | "forbidden"
      | "invite_exists"
      | "not_found"
      | "invite_expired"
      | "owner_transfer_required"
      | "last_workspace",
    message: string
  ) {
    super(message);
    this.name = "WorkspacePolicyError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(digest);
}

export async function hashWorkspaceApiKey(apiKey: string): Promise<string> {
  return sha256(apiKey);
}

export async function authorizeWorkspaceForSession(
  db: D1Database,
  input: { workspaceId: string; userId: string }
): Promise<Workspace | null> {
  return db
    .prepare(
      `SELECT t.*
       FROM workspaces t
       JOIN workspace_memberships m ON m.workspace_id = t.id
       WHERE t.id = ? AND m.user_id = ?
       LIMIT 1`
    )
    .bind(input.workspaceId, input.userId)
    .first<Workspace>();
}

export async function authorizeWorkspaceForApiKey(
  db: D1Database,
  input: { apiKey: string }
): Promise<Workspace | null> {
  const apiKeyHash = await hashWorkspaceApiKey(input.apiKey);
  return db
    .prepare("SELECT * FROM workspaces WHERE api_key_hash = ? LIMIT 1")
    .bind(apiKeyHash)
    .first<Workspace>();
}

export async function listWorkspacesForUser(
  db: D1Database,
  input: { userId: string }
): Promise<WorkspaceListing[]> {
  const result = await db
    .prepare(
      `SELECT t.id, t.name, t.created_at, t.max_image_bytes, m.role
       FROM workspace_memberships m
       JOIN workspaces t ON t.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY t.created_at DESC`
    )
    .bind(input.userId)
    .all<WorkspaceListing>();

  return result.results;
}

export async function listWorkspaceUsersForUser(
  db: D1Database,
  input: { workspaceId: string; userId: string }
): Promise<WorkspaceUserListing[]> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }

  const users = await db
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
    .bind(input.workspaceId)
    .all<WorkspaceUserListing>();

  return users.results;
}

export async function leaveWorkspaceForUser(
  db: D1Database,
  input: { workspaceId: string; userId: string; userName?: string | null },
  starterTemplateAdapter?: StarterTemplateAdapter
): Promise<LeftWorkspace> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }
  if (member.role === "owner") {
    throw new WorkspacePolicyError("owner_transfer_required", "Transfer ownership or delete the workspace before leaving");
  }

  const workspaceCountRow = await db
    .prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE user_id = ?")
    .bind(input.userId)
    .first<{ count: number | string }>();
  const isLastAcceptedWorkspace = Number(workspaceCountRow?.count || 0) <= 1;

  await db
    .prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
    .bind(input.workspaceId, input.userId)
    .run();

  if (isLastAcceptedWorkspace && starterTemplateAdapter) {
    const replacement = await bootstrapWorkspaceForNewUser(
      db,
      { userId: input.userId, userName: input.userName ?? null },
      starterTemplateAdapter
    );
    if (replacement.created) {
      const { created: _created, ...replacementWorkspace } = replacement;
      return { ok: true, workspace_id: input.workspaceId, replacement_workspace: replacementWorkspace };
    }
  }

  return { ok: true, workspace_id: input.workspaceId };
}

export async function updateWorkspaceUserRoleForUser(
  db: D1Database,
  input: { workspaceId: string; actingUserId: string; targetUserId: string; action: WorkspaceUserRoleAction }
): Promise<UpdatedWorkspaceUserRole> {
  const actorMembership = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.actingUserId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!actorMembership) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }
  if (actorMembership.role !== "owner" && actorMembership.role !== "admin") {
    throw new WorkspacePolicyError("forbidden", "Only owners/admins can manage users");
  }

  const targetMembership = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.targetUserId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!targetMembership) {
    throw new WorkspacePolicyError("not_found", "Workspace user not found");
  }

  if (actorMembership.role === "admin") {
    if (input.action !== "remove_user") {
      throw new WorkspacePolicyError("forbidden", "Admins can only remove member users");
    }
    if (targetMembership.role !== "member") {
      throw new WorkspacePolicyError("forbidden", "Admins can only remove non-admin users");
    }

    await db
      .prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(input.workspaceId, input.targetUserId)
      .run();

    return { ok: true, workspace_id: input.workspaceId, target_user_id: input.targetUserId, action: "remove_user" };
  }

  if (input.action === "remove_user") {
    if (targetMembership.role === "owner") {
      throw new WorkspacePolicyError("owner_transfer_required", "Transfer ownership before removing the owner");
    }

    await db
      .prepare("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .bind(input.workspaceId, input.targetUserId)
      .run();

    return { ok: true, workspace_id: input.workspaceId, target_user_id: input.targetUserId, action: "remove_user" };
  }

  if (input.action === "make_admin") {
    await db
      .prepare("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?")
      .bind(input.workspaceId, input.targetUserId)
      .run();

    return { ok: true, workspace_id: input.workspaceId, target_user_id: input.targetUserId, role: "admin" };
  }

  if (targetMembership.role === "owner") {
    return { ok: true, workspace_id: input.workspaceId, target_user_id: input.targetUserId, role: "owner" };
  }

  await db.batch([
    db.prepare("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND role = 'owner'").bind(input.workspaceId),
    db
      .prepare("UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?")
      .bind(input.workspaceId, input.targetUserId),
    db.prepare("UPDATE workspaces SET created_by_user_id = ? WHERE id = ?").bind(input.targetUserId, input.workspaceId)
  ]);

  return { ok: true, workspace_id: input.workspaceId, target_user_id: input.targetUserId, role: "owner" };
}

export async function createWorkspaceForUser(
  db: D1Database,
  input: { userId: string; name?: string }
): Promise<CreatedWorkspace> {
  const workspaceId = newId("workspace");
  const apiKey = newId("key");
  const apiKeyHash = await hashWorkspaceApiKey(apiKey);
  const now = nowIso();
  const workspaceName = input.name ?? workspaceId;

  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, api_key_hash, name, created_at, created_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(workspaceId, apiKeyHash, workspaceName, now, input.userId),
    db
      .prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'owner', ?)`
      )
      .bind(workspaceId, input.userId, now)
  ]);

  return {
    workspace_id: workspaceId,
    api_key: apiKey,
    name: workspaceName,
    role: "owner",
    created_at: now
  };
}

export async function bootstrapWorkspaceForNewUser(
  db: D1Database,
  input: { userId: string; userName: string | null },
  starterTemplateAdapter: StarterTemplateAdapter
): Promise<BootstrappedWorkspace | ExistingBootstrappedWorkspace> {
  const existing = await db
    .prepare("SELECT workspace_id FROM workspace_memberships WHERE user_id = ? LIMIT 1")
    .bind(input.userId)
    .first<{ workspace_id: string }>();

  if (existing) {
    return { created: false, workspace_id: existing.workspace_id };
  }

  const workspaceId = newId("workspace");
  const apiKey = newId("key");
  const apiKeyHash = await hashWorkspaceApiKey(apiKey);
  const now = nowIso();
  const workspaceName = `${(input.userName || "New").trim() || "New"} Workspace`;

  await db.batch([
    db
      .prepare(
        `INSERT INTO workspaces (id, api_key_hash, name, created_at, created_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(workspaceId, apiKeyHash, workspaceName, now, input.userId),
    db
      .prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'owner', ?)`
      )
      .bind(workspaceId, input.userId, now)
  ]);

  await starterTemplateAdapter.createStarterTemplate({ workspaceId, createdAt: now });

  return {
    created: true,
    workspace_id: workspaceId,
    api_key: apiKey,
    name: workspaceName,
    role: "owner",
    created_at: now
  };
}

export async function updateWorkspaceSettingsForUser(
  db: D1Database,
  input: { workspaceId: string; userId: string; name: string }
): Promise<UpdatedWorkspaceSettings> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: "owner" | "admin" | "member" }>();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new WorkspacePolicyError("forbidden", "Only owners/admins can update workspace settings");
  }

  await db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(input.name, input.workspaceId).run();

  return { workspace_id: input.workspaceId, name: input.name };
}

export async function rotateWorkspaceApiKeyForUser(
  db: D1Database,
  input: { workspaceId: string; userId: string }
): Promise<RotatedWorkspaceApiKey> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: "owner" | "admin" | "member" }>();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    throw new WorkspacePolicyError("forbidden", "Only owners/admins can rotate workspace API keys");
  }

  const apiKey = newId("key");
  const apiKeyHash = await hashWorkspaceApiKey(apiKey);
  await db.prepare("UPDATE workspaces SET api_key_hash = ? WHERE id = ?").bind(apiKeyHash, input.workspaceId).run();

  return {
    workspace_id: input.workspaceId,
    api_key: apiKey,
    rotated_at: nowIso()
  };
}

export async function approveWorkspaceDeletionForUser(
  db: D1Database,
  input: { workspaceId: string; userId: string }
): Promise<void> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }
  if (member.role !== "owner") {
    throw new WorkspacePolicyError("forbidden", "Only owners can delete workspaces");
  }

  const workspaceCountRow = await db
    .prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE user_id = ?")
    .bind(input.userId)
    .first<{ count: number | string }>();

  const workspaceCount = Number(workspaceCountRow?.count || 0);
  if (workspaceCount <= 1) {
    throw new WorkspacePolicyError("last_workspace", "You cannot delete your only workspace");
  }
}

export async function inviteWorkspaceMember(
  db: D1Database,
  input: { workspaceId: string; inviterUserId: string; email: string; role?: unknown }
): Promise<CreatedWorkspaceInvitation> {
  const inviter = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.inviterUserId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!inviter) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }
  if (inviter.role !== "owner" && inviter.role !== "admin") {
    throw new WorkspacePolicyError("forbidden", "Only owners/admins can invite users");
  }

  const email = normalizeEmail(input.email);
  const role: "admin" | "member" =
    typeof input.role === "string" && INVITEABLE_ROLES.has(input.role as WorkspaceMembershipRole)
      ? (input.role as "admin" | "member")
      : "member";

  const existingMember = await db
    .prepare(
      `SELECT u.id
       FROM workspace_memberships m
       JOIN user u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND lower(u.email) = ?
       LIMIT 1`
    )
    .bind(input.workspaceId, email)
    .first<{ id: string }>();

  if (existingMember) {
    throw new WorkspacePolicyError("invite_exists", "This user is already a workspace member");
  }

  const existingPending = await db
    .prepare(
      `SELECT id FROM workspace_invitations
       WHERE workspace_id = ? AND email = ? AND status = 'pending'
       LIMIT 1`
    )
    .bind(input.workspaceId, email)
    .first<{ id: string }>();

  if (existingPending) {
    throw new WorkspacePolicyError("invite_exists", "A pending invitation already exists for this user");
  }

  const id = newId("invite");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO workspace_invitations (
         id, workspace_id, email, role, status, invited_by_user_id, created_at, updated_at, expires_at
       ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    )
    .bind(id, input.workspaceId, email, role, input.inviterUserId, now, now, expiresAt)
    .run();

  return {
    invitation_id: id,
    workspace_id: input.workspaceId,
    email,
    role,
    status: "pending",
    expires_at: expiresAt
  };
}

export async function listPendingWorkspaceInvitationsForEmail(
  db: D1Database,
  input: { email: string }
): Promise<PendingWorkspaceInvitation[]> {
  const result = await db
    .prepare(
      `SELECT i.id,
              i.workspace_id,
              t.name AS workspace_name,
              i.email,
              i.role,
              i.status,
              i.invited_by_user_id AS inviter_user_id,
              u.name AS inviter_name,
              u.email AS inviter_email,
              COALESCE(NULLIF(u.name, ''), u.email) AS inviter_display,
              i.created_at,
              i.updated_at,
              i.expires_at
       FROM workspace_invitations i
       JOIN workspaces t ON t.id = i.workspace_id
       JOIN user u ON u.id = i.invited_by_user_id
       WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > ?
       ORDER BY i.updated_at DESC`
    )
    .bind(normalizeEmail(input.email), nowIso())
    .all<PendingWorkspaceInvitation>();

  return result.results;
}

export async function listManageableWorkspaceInvitationsForUser(
  db: D1Database,
  input: { workspaceId: string; userId: string }
): Promise<ManageableWorkspaceInvitation[]> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }
  if (member.role !== "owner" && member.role !== "admin") {
    throw new WorkspacePolicyError("forbidden", "Only owners/admins can manage invitations");
  }

  const result = await db
    .prepare(
      `SELECT i.id,
              i.workspace_id,
              t.name AS workspace_name,
              i.email,
              i.role,
              i.status,
              i.invited_by_user_id AS inviter_user_id,
              u.name AS inviter_name,
              u.email AS inviter_email,
              COALESCE(NULLIF(u.name, ''), u.email) AS inviter_display,
              i.created_at,
              i.updated_at,
              i.expires_at
       FROM workspace_invitations i
       JOIN workspaces t ON t.id = i.workspace_id
       JOIN user u ON u.id = i.invited_by_user_id
       WHERE i.workspace_id = ? AND i.status = 'pending' AND i.expires_at > ?
       ORDER BY i.created_at DESC`
    )
    .bind(input.workspaceId, nowIso())
    .all<ManageableWorkspaceInvitation>();

  return result.results;
}

export async function cancelWorkspaceInvitationForUser(
  db: D1Database,
  input: { workspaceId: string; invitationId: string; userId: string }
): Promise<CancelledWorkspaceInvitation> {
  const member = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(input.workspaceId, input.userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!member) {
    throw new WorkspacePolicyError("forbidden", "You are not a member of this workspace");
  }
  if (member.role !== "owner" && member.role !== "admin") {
    throw new WorkspacePolicyError("forbidden", "Only owners/admins can manage invitations");
  }

  const invitation = await db
    .prepare(
      `SELECT id, status
       FROM workspace_invitations
       WHERE id = ? AND workspace_id = ?
       LIMIT 1`
    )
    .bind(input.invitationId, input.workspaceId)
    .first<{ id: string; status: string }>();

  if (!invitation || invitation.status !== "pending") {
    throw new WorkspacePolicyError("not_found", "Invitation not found");
  }

  await db
    .prepare("UPDATE workspace_invitations SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(nowIso(), input.invitationId)
    .run();

  return { ok: true, invitation_id: input.invitationId, status: "cancelled" };
}

export async function declineWorkspaceInvitation(
  db: D1Database,
  input: { invitationId: string; userEmail: string }
): Promise<CancelledWorkspaceInvitation> {
  const invitation = await db
    .prepare(
      `SELECT id, email, status
       FROM workspace_invitations
       WHERE id = ?
       LIMIT 1`
    )
    .bind(input.invitationId)
    .first<{ id: string; email: string; status: string }>();

  if (!invitation || invitation.status !== "pending") {
    throw new WorkspacePolicyError("not_found", "Invitation not found");
  }
  if (normalizeEmail(invitation.email) !== normalizeEmail(input.userEmail)) {
    throw new WorkspacePolicyError("forbidden", "This invitation is for a different email address");
  }

  await db
    .prepare("UPDATE workspace_invitations SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(nowIso(), input.invitationId)
    .run();

  return { ok: true, invitation_id: input.invitationId, status: "cancelled" };
}

export async function acceptWorkspaceInvitation(
  db: D1Database,
  input: { invitationId: string; userId: string; userEmail: string }
): Promise<AcceptedWorkspaceInvitation> {
  const invitation = await db
    .prepare(
      `SELECT id, workspace_id, email, role, status, expires_at
       FROM workspace_invitations
       WHERE id = ?
       LIMIT 1`
    )
    .bind(input.invitationId)
    .first<{
      id: string;
      workspace_id: string;
      email: string;
      role: "admin" | "member";
      status: string;
      expires_at: string;
    }>();

  if (!invitation || invitation.status !== "pending") {
    throw new WorkspacePolicyError("not_found", "Invitation not found");
  }
  if (normalizeEmail(invitation.email) !== normalizeEmail(input.userEmail)) {
    throw new WorkspacePolicyError("forbidden", "This invitation is for a different email address");
  }

  const now = nowIso();
  if (Date.parse(invitation.expires_at) < Date.now()) {
    await db
      .prepare("UPDATE workspace_invitations SET status = 'expired', updated_at = ? WHERE id = ?")
      .bind(now, input.invitationId)
      .run();
    throw new WorkspacePolicyError("invite_expired", "Invitation has expired");
  }

  const existingMembership = await db
    .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1`)
    .bind(invitation.workspace_id, input.userId)
    .first<{ role: WorkspaceMembershipRole }>();

  if (!existingMembership) {
    await db
      .prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(invitation.workspace_id, input.userId, invitation.role, now)
      .run();
  }

  await db.batch([
    db
      .prepare(
        `UPDATE workspace_invitations
         SET status = 'accepted', accepted_by_user_id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(input.userId, now, input.invitationId)
  ]);

  return { ok: true, workspace_id: invitation.workspace_id, role: existingMembership?.role ?? invitation.role };
}
