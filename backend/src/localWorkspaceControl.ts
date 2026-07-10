import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";

import { newId, nowIso } from "./lib/ids";

export type LocalWorkspace = {
  id: string;
  name: string;
  created_at: string;
  max_source_file_bytes: number | null;
  has_api_key: boolean;
  role: "owner" | "admin" | "member";
};

export type CreatedLocalWorkspace = {
  workspace_id: string;
  has_api_key: false;
  name: string;
  role: "owner";
  created_at: string;
};

export type LocalApiKeyWorkspace = Omit<LocalWorkspace, "role">;

export type LocalWorkspaceInvitation = {
  id: string;
  workspace_id: string;
  workspace_name: string;
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

export type LocalWorkspaceMember = {
  user_id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
};

export type LocalWorkspaceMemberAction = "remove_user" | "make_admin" | "make_owner";

export type LocalWorkspaceMemberActionResult = {
  workspace_id: string;
  user_id: string;
  action: LocalWorkspaceMemberAction;
  role: "owner" | "admin" | null;
};

export type LocalWorkspaceLeaveResult = {
  ok: true;
  workspace_id: string;
  next_workspace: LocalWorkspace;
  replacement_workspace?: CreatedLocalWorkspace;
};

export class LocalWorkspaceControlError extends Error {
  constructor(
    public readonly code: "forbidden" | "invite_exists" | "last_workspace" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

export type LocalWorkspaceControl = {
  acceptInvitation(input: { invitationId: string; userId: string; userEmail: string }): { ok: true; workspace_id: string; role: "owner" | "admin" | "member" };
  applyWorkspaceMemberAction(input: {
    workspaceId: string;
    actorUserId: string;
    targetUserId: string;
    action: string;
  }): LocalWorkspaceMemberActionResult;
  assertWorkspaceDeletion(input: { workspaceId: string; userId: string }): void;
  authorizeApiKey(input: { apiKey: string }): LocalApiKeyWorkspace | null;
  createInvitation(input: { workspaceId: string; inviterUserId: string; email: string; role?: string }): LocalWorkspaceInvitation;
  cancelInvitation(input: { workspaceId: string; invitationId: string; userId: string }): { ok: true; invitation_id: string; status: "cancelled" };
  completeWorkspaceDeletionIntent(input: { workspaceId: string }): void;
  declineInvitation(input: { invitationId: string; userEmail: string }): { ok: true; invitation_id: string; status: "cancelled" };
  completeStarterTemplateBootstrap(input: { workspaceId: string }): void;
  createWorkspace(input: { userId: string; name?: string }): CreatedLocalWorkspace;
  deleteWorkspace(input: { workspaceId: string; userId: string }): void;
  getAcceptedWorkspaceContext(input: { workspaceId: string; userId: string }): LocalWorkspace | null;
  hasPendingStarterTemplateBootstrap(input: { workspaceId: string }): boolean;
  listPendingInvitations(input: { email: string }): LocalWorkspaceInvitation[];
  leaveWorkspace(input: { workspaceId: string; userId: string; userName?: string | null }): LocalWorkspaceLeaveResult;
  listWorkspaceInvitations(input: { workspaceId: string; userId: string }): LocalWorkspaceInvitation[];
  listWorkspaceUsers(input: { workspaceId: string; userId: string }): LocalWorkspaceMember[];
  listWorkspaceDeletionIntents(): string[];
  recordWorkspaceDeletionIntent(input: { workspaceId: string }): void;
  listAcceptedWorkspaces(input: { userId: string; userName?: string | null }): LocalWorkspace[];
  renameWorkspace(input: { workspaceId: string; userId: string; name: string }): { workspace_id: string; name: string };
  rotateApiKey(input: { workspaceId: string; userId: string }): {
    workspace_id: string;
    api_key: string;
    has_api_key: true;
    rotated_at: string;
  };
  workspaceExists(input: { workspaceId: string }): boolean;
};

export function createLocalWorkspaceControl(database: Database): LocalWorkspaceControl {
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(CONTROL_SCHEMA);

  return {
    acceptInvitation: (input) => acceptInvitation(database, input),
    applyWorkspaceMemberAction: (input) => applyWorkspaceMemberAction(database, input),
    assertWorkspaceDeletion: (input) => assertWorkspaceDeletion(database, input),
    authorizeApiKey: (input) => authorizeApiKey(database, input),
    createInvitation: (input) => createInvitation(database, input),
    cancelInvitation: (input) => cancelInvitation(database, input),
    completeWorkspaceDeletionIntent: (input) => {
      database.query("DELETE FROM workspace_deletion_intents WHERE workspace_id = ?").run(input.workspaceId);
    },
    declineInvitation: (input) => declineInvitation(database, input),
    completeStarterTemplateBootstrap: (input) => {
      database.query("DELETE FROM workspace_product_bootstraps WHERE workspace_id = ?").run(input.workspaceId);
    },
    createWorkspace: (input) => createWorkspace(database, input),
    deleteWorkspace: (input) => deleteWorkspace(database, input),
    getAcceptedWorkspaceContext: (input) => getAcceptedWorkspaceContext(database, input),
    hasPendingStarterTemplateBootstrap: (input) => Boolean(
      database.query("SELECT 1 FROM workspace_product_bootstraps WHERE workspace_id = ? LIMIT 1").get(input.workspaceId),
    ),
    listPendingInvitations: (input) => listPendingInvitations(database, input),
    leaveWorkspace: (input) => leaveWorkspace(database, input),
    listWorkspaceInvitations: (input) => listWorkspaceInvitations(database, input),
    listWorkspaceUsers: (input) => listWorkspaceUsers(database, input),
    listWorkspaceDeletionIntents: () => database.query(
      "SELECT workspace_id FROM workspace_deletion_intents ORDER BY requested_at ASC, workspace_id ASC",
    ).all().map((row) => (row as { workspace_id: string }).workspace_id),
    recordWorkspaceDeletionIntent: (input) => {
      database.query(
        "INSERT OR IGNORE INTO workspace_deletion_intents (workspace_id, requested_at) VALUES (?, ?)",
      ).run(input.workspaceId, nowIso());
    },
    listAcceptedWorkspaces: (input) => listAcceptedWorkspaces(database, input),
    renameWorkspace: (input) => renameWorkspace(database, input),
    rotateApiKey: (input) => rotateApiKey(database, input),
    workspaceExists: (input) => Boolean(
      database.query("SELECT 1 FROM workspaces WHERE id = ? LIMIT 1").get(input.workspaceId),
    ),
  };
}

function cancelInvitation(database: Database, input: { workspaceId: string; invitationId: string; userId: string }): { ok: true; invitation_id: string; status: "cancelled" } {
  const membership = getMembership(database, input.workspaceId, input.userId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) throw new LocalWorkspaceControlError("forbidden", "Only owners/admins can manage invitations");
  const invitation = database.query("SELECT id FROM workspace_invitations WHERE id = ? AND workspace_id = ? AND status = 'pending' LIMIT 1").get(input.invitationId, input.workspaceId);
  if (!invitation) throw new LocalWorkspaceControlError("not_found", "Invitation not found");
  database.query("UPDATE workspace_invitations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), input.invitationId);
  return { ok: true, invitation_id: input.invitationId, status: "cancelled" };
}

function declineInvitation(database: Database, input: { invitationId: string; userEmail: string }): { ok: true; invitation_id: string; status: "cancelled" } {
  const invitation = database.query("SELECT id, email, status FROM workspace_invitations WHERE id = ? LIMIT 1").get(input.invitationId) as { id: string; email: string; status: string } | null;
  if (!invitation || invitation.status !== "pending") throw new LocalWorkspaceControlError("not_found", "Invitation not found");
  if (normalizeEmail(invitation.email) !== normalizeEmail(input.userEmail)) throw new LocalWorkspaceControlError("forbidden", "This invitation is for a different email address");
  database.query("UPDATE workspace_invitations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), input.invitationId);
  return { ok: true, invitation_id: input.invitationId, status: "cancelled" };
}

function acceptInvitation(
  database: Database,
  input: { invitationId: string; userId: string; userEmail: string },
): { ok: true; workspace_id: string; role: "owner" | "admin" | "member" } {
  const invitation = database.query(
    `SELECT id, workspace_id, email, role, status, expires_at
     FROM workspace_invitations WHERE id = ? LIMIT 1`,
  ).get(input.invitationId) as { workspace_id: string; email: string; role: "admin" | "member"; status: string; expires_at: string } | null;
  if (!invitation || invitation.status !== "pending") {
    throw new LocalWorkspaceControlError("not_found", "Invitation not found");
  }
  if (normalizeEmail(invitation.email) !== normalizeEmail(input.userEmail) || Date.parse(invitation.expires_at) <= Date.now()) {
    throw new LocalWorkspaceControlError("forbidden", "This invitation is not available");
  }
  const now = nowIso();
  const existingMembership = getMembership(database, invitation.workspace_id, input.userId);
  const accept = database.transaction(() => {
    if (!existingMembership) {
      database.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(invitation.workspace_id, input.userId, invitation.role, now);
    }
    database.query(
      `UPDATE workspace_invitations SET status = 'accepted', accepted_by_user_id = ?, updated_at = ? WHERE id = ?`,
    ).run(input.userId, now, input.invitationId);
  });
  accept();
  return { ok: true, workspace_id: invitation.workspace_id, role: existingMembership?.role ?? invitation.role };
}

function createInvitation(
  database: Database,
  input: { workspaceId: string; inviterUserId: string; email: string; role?: string },
): LocalWorkspaceInvitation {
  const membership = getMembership(database, input.workspaceId, input.inviterUserId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    throw new LocalWorkspaceControlError("forbidden", "Only owners/admins can invite users");
  }
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new LocalWorkspaceControlError("not_found", "Invitation email is required");
  }
  const existingMember = database.query(
    `SELECT 1 FROM workspace_memberships m JOIN user u ON u.id = m.user_id
     WHERE m.workspace_id = ? AND lower(u.email) = ? LIMIT 1`,
  ).get(input.workspaceId, email);
  const existingInvitation = database.query(
    "SELECT 1 FROM workspace_invitations WHERE workspace_id = ? AND email = ? AND status = 'pending' LIMIT 1",
  ).get(input.workspaceId, email);
  if (existingMember || existingInvitation) {
    throw new LocalWorkspaceControlError("invite_exists", "A pending invitation already exists for this user");
  }
  const id = newId("invite");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const role = input.role === "admin" ? "admin" : "member";
  database.query(
    `INSERT INTO workspace_invitations (id, workspace_id, email, role, status, invited_by_user_id, accepted_by_user_id, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?)`,
  ).run(id, input.workspaceId, email, role, input.inviterUserId, createdAt, createdAt, expiresAt);
  return invitationById(database, id)!;
}

function listPendingInvitations(database: Database, input: { email: string }): LocalWorkspaceInvitation[] {
  return database.query(INVITATION_SELECT + " WHERE i.email = ? AND i.status = 'pending' AND i.expires_at > ? ORDER BY i.updated_at DESC")
    .all(normalizeEmail(input.email), nowIso()) as LocalWorkspaceInvitation[];
}

function listWorkspaceInvitations(database: Database, input: { workspaceId: string; userId: string }): LocalWorkspaceInvitation[] {
  const membership = getMembership(database, input.workspaceId, input.userId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    throw new LocalWorkspaceControlError("forbidden", "Only owners/admins can manage invitations");
  }
  return database.query(
    INVITATION_SELECT + " WHERE i.workspace_id = ? AND i.status = 'pending' AND i.expires_at > ? ORDER BY i.updated_at DESC",
  ).all(input.workspaceId, nowIso()) as LocalWorkspaceInvitation[];
}

function leaveWorkspace(
  database: Database,
  input: { workspaceId: string; userId: string; userName?: string | null },
): LocalWorkspaceLeaveResult {
  const leave = database.transaction(() => {
    const membership = getMembership(database, input.workspaceId, input.userId);
    if (!membership) {
      throw new LocalWorkspaceControlError("not_found", "Workspace not found");
    }
    if (membership.role === "owner") {
      throw new LocalWorkspaceControlError("forbidden", "Workspace owners cannot leave their workspace");
    }

    const acceptedWorkspaces = listMembershipWorkspaces(database, input.userId);
    const replacementWorkspace = acceptedWorkspaces.length <= 1
      ? createWorkspaceRecord(database, {
          userId: input.userId,
          name: `${normalizedUserName(input.userName)} Workspace`,
          bootstrapProductData: true,
        })
      : null;
    database.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?").run(input.workspaceId, input.userId);
    const nextWorkspace = replacementWorkspace
      ? getAcceptedWorkspaceContext(database, {
          workspaceId: replacementWorkspace.workspace_id,
          userId: input.userId,
        })!
      : listMembershipWorkspaces(database, input.userId)[0]!;

    return {
      ok: true as const,
      workspace_id: input.workspaceId,
      next_workspace: nextWorkspace,
      ...(replacementWorkspace ? { replacement_workspace: replacementWorkspace } : {}),
    };
  });

  return leave();
}

function listWorkspaceUsers(database: Database, input: { workspaceId: string; userId: string }): LocalWorkspaceMember[] {
  if (!getMembership(database, input.workspaceId, input.userId)) {
    throw new LocalWorkspaceControlError("forbidden", "You do not have access to this workspace");
  }
  return database.query(
    `SELECT m.user_id, u.name, u.email, m.role
     FROM workspace_memberships m
     JOIN user u ON u.id = m.user_id
     WHERE m.workspace_id = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END ASC,
              m.created_at ASC,
              m.user_id ASC`,
  ).all(input.workspaceId) as LocalWorkspaceMember[];
}

function applyWorkspaceMemberAction(
  database: Database,
  input: { workspaceId: string; actorUserId: string; targetUserId: string; action: string },
): LocalWorkspaceMemberActionResult {
  const action = input.action as LocalWorkspaceMemberAction;
  if (action !== "remove_user" && action !== "make_admin" && action !== "make_owner") {
    throw new LocalWorkspaceControlError("forbidden", "Workspace member action is not permitted");
  }
  const apply = database.transaction(() => {
    const actor = getMembership(database, input.workspaceId, input.actorUserId);
    if (!actor || input.actorUserId === input.targetUserId) {
      throw new LocalWorkspaceControlError("forbidden", "Workspace member action is not permitted");
    }
    const target = getMembership(database, input.workspaceId, input.targetUserId);
    if (!target) {
      throw new LocalWorkspaceControlError("not_found", "Workspace member not found");
    }

    if (action === "remove_user" && target.role !== "owner" && (actor.role === "owner" || actor.role === "admin" && target.role === "member")) {
      database.query(
        "DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?",
      ).run(input.workspaceId, input.targetUserId);
      return { workspace_id: input.workspaceId, user_id: input.targetUserId, action, role: null };
    }

    if (action === "make_admin" && actor.role === "owner" && target.role === "member") {
      database.query(
        "UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?",
      ).run(input.workspaceId, input.targetUserId);
      return { workspace_id: input.workspaceId, user_id: input.targetUserId, action, role: "admin" as const };
    }

    if (action === "make_owner" && actor.role === "owner" && target.role !== "owner") {
      database.query(
        "UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND user_id = ?",
      ).run(input.workspaceId, input.actorUserId);
      database.query(
        "UPDATE workspace_memberships SET role = 'owner' WHERE workspace_id = ? AND user_id = ?",
      ).run(input.workspaceId, input.targetUserId);
      return { workspace_id: input.workspaceId, user_id: input.targetUserId, action, role: "owner" as const };
    }

    throw new LocalWorkspaceControlError("forbidden", "Workspace member action is not permitted");
  });
  return apply();
}

function invitationById(database: Database, invitationId: string): LocalWorkspaceInvitation | null {
  return database.query(INVITATION_SELECT + " WHERE i.id = ? LIMIT 1").get(invitationId) as LocalWorkspaceInvitation | null;
}

function authorizeApiKey(database: Database, input: { apiKey: string }): LocalApiKeyWorkspace | null {
  const value = database.query(
    `SELECT id, name, created_at, max_source_file_bytes, api_key_hash IS NOT NULL AS has_api_key
     FROM workspaces
     WHERE api_key_hash = ?
     LIMIT 1`,
  ).get(hashApiKey(input.apiKey));
  return toApiKeyWorkspace(value);
}

function listAcceptedWorkspaces(
  database: Database,
  input: { userId: string; userName?: string | null },
): LocalWorkspace[] {
  const workspaces = listMembershipWorkspaces(database, input.userId);
  if (workspaces.length > 0) {
    return workspaces;
  }

  createWorkspace(database, {
    userId: input.userId,
    name: `${normalizedUserName(input.userName)} Workspace`,
    bootstrapProductData: true,
  });
  return listMembershipWorkspaces(database, input.userId);
}

function createWorkspace(
  database: Database,
  input: { userId: string; name?: string; bootstrapProductData?: boolean },
): CreatedLocalWorkspace {
  const create = database.transaction(() => createWorkspaceRecord(database, input));
  return create();
}

function createWorkspaceRecord(
  database: Database,
  input: { userId: string; name?: string; bootstrapProductData?: boolean },
): CreatedLocalWorkspace {
  const workspaceId = newId("workspace");
  const createdAt = nowIso();
  const name = input.name?.trim() || "New Workspace";
  database.query(
    `INSERT INTO workspaces (id, name, created_at, created_by_user_id, api_key_hash, max_source_file_bytes)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run(workspaceId, name, createdAt, input.userId);
  database.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
     VALUES (?, ?, 'owner', ?)`,
  ).run(workspaceId, input.userId, createdAt);
  if (input.bootstrapProductData) {
    database.query(
      `INSERT INTO workspace_product_bootstraps (workspace_id, created_at)
       VALUES (?, ?)`,
    ).run(workspaceId, createdAt);
  }

  return {
    workspace_id: workspaceId,
    has_api_key: false,
    name,
    role: "owner",
    created_at: createdAt,
  };
}

function getAcceptedWorkspaceContext(
  database: Database,
  input: { workspaceId: string; userId: string },
): LocalWorkspace | null {
  return toWorkspace(
    database.query(
      `SELECT w.id,
              w.name,
              w.created_at,
              w.max_source_file_bytes,
              w.api_key_hash IS NOT NULL AS has_api_key,
              m.role
       FROM workspaces w
       JOIN workspace_memberships m ON m.workspace_id = w.id
       WHERE w.id = ? AND m.user_id = ?
       LIMIT 1`,
    ).get(input.workspaceId, input.userId),
  );
}

function renameWorkspace(
  database: Database,
  input: { workspaceId: string; userId: string; name: string },
): { workspace_id: string; name: string } {
  const membership = getMembership(database, input.workspaceId, input.userId);
  if (!membership) {
    throw new LocalWorkspaceControlError("not_found", "Workspace not found");
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new LocalWorkspaceControlError("forbidden", "Only owners/admins can update workspace settings");
  }

  database.query("UPDATE workspaces SET name = ? WHERE id = ?").run(input.name, input.workspaceId);
  return { workspace_id: input.workspaceId, name: input.name };
}

function rotateApiKey(
  database: Database,
  input: { workspaceId: string; userId: string },
): { workspace_id: string; api_key: string; has_api_key: true; rotated_at: string } {
  const membership = getMembership(database, input.workspaceId, input.userId);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    throw new LocalWorkspaceControlError("forbidden", "Only owners/admins can rotate workspace API keys");
  }

  const apiKey = newId("key");
  const rotatedAt = nowIso();
  database.query("UPDATE workspaces SET api_key_hash = ? WHERE id = ?").run(hashApiKey(apiKey), input.workspaceId);
  return { workspace_id: input.workspaceId, api_key: apiKey, has_api_key: true, rotated_at: rotatedAt };
}

function deleteWorkspace(database: Database, input: { workspaceId: string; userId: string }): void {
  assertWorkspaceDeletion(database, input);
  database.query("DELETE FROM workspaces WHERE id = ?").run(input.workspaceId);
}

function assertWorkspaceDeletion(database: Database, input: { workspaceId: string; userId: string }): void {
  const membership = getMembership(database, input.workspaceId, input.userId);
  if (!membership) {
    throw new LocalWorkspaceControlError("not_found", "Workspace not found");
  }
  if (membership.role !== "owner") {
    throw new LocalWorkspaceControlError("forbidden", "Only owners can delete workspaces");
  }

  const count = Number(
    (database.query("SELECT COUNT(*) AS count FROM workspace_memberships WHERE user_id = ?").get(input.userId) as { count: number }).count,
  );
  if (count <= 1) {
    throw new LocalWorkspaceControlError("last_workspace", "You cannot delete your only workspace");
  }
}

function listMembershipWorkspaces(database: Database, userId: string): LocalWorkspace[] {
  return database.query(
    `SELECT w.id,
            w.name,
            w.created_at,
            w.max_source_file_bytes,
            w.api_key_hash IS NOT NULL AS has_api_key,
            m.role
     FROM workspaces w
     JOIN workspace_memberships m ON m.workspace_id = w.id
     WHERE m.user_id = ?
     ORDER BY w.created_at DESC`,
  ).all(userId).map(toWorkspace).filter((workspace): workspace is LocalWorkspace => workspace !== null);
}

function getMembership(
  database: Database,
  workspaceId: string,
  userId: string,
): { role: "owner" | "admin" | "member" } | null {
  return database.query(
    "SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1",
  ).get(workspaceId, userId) as { role: "owner" | "admin" | "member" } | null;
}

function toWorkspace(value: unknown): LocalWorkspace | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const workspace = value as Omit<LocalWorkspace, "has_api_key"> & { has_api_key: number | boolean };
  return {
    ...workspace,
    has_api_key: Boolean(workspace.has_api_key),
  };
}

function toApiKeyWorkspace(value: unknown): LocalApiKeyWorkspace | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const workspace = value as LocalApiKeyWorkspace & { has_api_key: number | boolean };
  return { ...workspace, has_api_key: Boolean(workspace.has_api_key) };
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function normalizedUserName(value: string | null | undefined): string {
  return value?.trim() || "New";
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

const INVITATION_SELECT = `
  SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.role, i.status,
         i.invited_by_user_id AS inviter_user_id, u.name AS inviter_name, u.email AS inviter_email,
         COALESCE(NULLIF(u.name, ''), u.email) AS inviter_display,
         i.created_at, i.updated_at, i.expires_at
  FROM workspace_invitations i
  JOIN workspaces w ON w.id = i.workspace_id
  JOIN user u ON u.id = i.invited_by_user_id`;

const CONTROL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    api_key_hash TEXT UNIQUE,
    max_source_file_bytes INTEGER
  );

  CREATE TABLE IF NOT EXISTS workspace_memberships (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user
    ON workspace_memberships(user_id);

  CREATE TABLE IF NOT EXISTS workspace_product_bootstraps (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_invitations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
    invited_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accepted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email_status
    ON workspace_invitations(email, status);
  CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace_status
    ON workspace_invitations(workspace_id, status);

  CREATE TABLE IF NOT EXISTS workspace_deletion_intents (
    workspace_id TEXT PRIMARY KEY,
    requested_at TEXT NOT NULL
  );
`;
