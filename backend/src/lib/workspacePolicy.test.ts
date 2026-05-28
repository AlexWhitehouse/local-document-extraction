import { describe, expect, it } from "vitest";
import {
  approveWorkspaceDeletionForUser,
  authorizeWorkspaceForApiKey,
  authorizeWorkspaceForSession,
  acceptWorkspaceInvitation,
  bootstrapWorkspaceForNewUser,
  cancelWorkspaceInvitationForUser,
  declineWorkspaceInvitation,
  createWorkspaceForUser,
  inviteWorkspaceMember,
  leaveWorkspaceForUser,
  listManageableWorkspaceInvitationsForUser,
  listWorkspaceUsersForUser,
  listPendingWorkspaceInvitationsForEmail,
  listWorkspacesForUser,
  rotateWorkspaceApiKeyForUser,
  updateWorkspaceUserRoleForUser,
  WorkspacePolicyError,
  updateWorkspaceSettingsForUser
} from "./workspacePolicy";
import { listJobs } from "../api/jobs";
import { listTemplates } from "../api/templates";
import type { Workspace } from "./types";

type WorkspaceMembershipFixture = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  created_at?: string;
};

type UserFixture = {
  id: string;
  name: string | null;
  email: string;
};

type WorkspaceInvitationFixture = {
  id: string;
  workspace_id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "cancelled" | "expired";
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

type TemplateFixture = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
};

type TemplateFieldFixture = {
  template_id: string;
  version: number;
  field_id: string;
  name: string;
  description: string;
  data_type: string;
  required: number;
  position: number;
};

type JobFixture = {
  id: string;
  workspace_id: string;
  status: string;
  template_id: string;
  template_version: number;
  source_name: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  current_attempt: number | null;
  completed_attempt: number | null;
  last_failed_attempt: number | null;
};

function createD1Fixture(input: {
  workspaces: Workspace[];
  memberships: WorkspaceMembershipFixture[];
  users?: UserFixture[];
  invitations?: WorkspaceInvitationFixture[];
  templates?: TemplateFixture[];
  templateFields?: TemplateFieldFixture[];
  jobs?: JobFixture[];
}): D1Database {
  const invitations = input.invitations ?? [];
  const jobs = input.jobs ?? [];
  const templateFields = input.templateFields ?? [];
  const templates = input.templates ?? [];
  const users = input.users ?? [];

  return {
    async batch(statements: D1PreparedStatement[]) {
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
                const createdAt = params.length === 4 ? params[3] : params[2];
                const existingMembership = input.memberships.find(
                  (membership) => membership.workspace_id === workspaceId && membership.user_id === userId
                );
                const role = params.length === 4 && (params[2] === "admin" || params[2] === "member") ? params[2] : "owner";
                if (existingMembership) {
                  existingMembership.role = role;
                  existingMembership.created_at = String(createdAt);
                } else {
                  input.memberships.push({
                    workspace_id: String(workspaceId),
                    user_id: String(userId),
                    role,
                    created_at: String(createdAt)
                  });
                }
                expect(createdAt).toEqual(expect.any(String));
                return { success: true };
              }

              if (sql.includes("INSERT INTO templates")) {
                const [id, workspaceId, name, description, createdAt, updatedAt] = params;
                templates.push({
                  id: String(id),
                  workspace_id: String(workspaceId),
                  name: String(name),
                  description: String(description),
                  status: "active",
                  current_version: 1,
                  created_at: String(createdAt),
                  updated_at: String(updatedAt)
                });
                return { success: true };
              }

              if (sql.includes("INSERT INTO template_fields")) {
                const [templateId] = params;
                const match = sql.match(/VALUES \(\?, 1, '([^']+)', '([^']+)', '([^']+)', '([^']+)', (\d), (\d)\)/);
                if (!match) {
                  throw new Error(`Unhandled template field SQL: ${sql}`);
                }
                const [, fieldId, name, description, dataType, required, position] = match;
                templateFields.push({
                  template_id: String(templateId),
                  version: 1,
                  field_id: fieldId,
                  name,
                  description,
                  data_type: dataType,
                  required: Number(required),
                  position: Number(position)
                });
                return { success: true };
              }

              if (sql.includes("UPDATE workspaces SET name = ? WHERE id = ?")) {
                const [name, workspaceId] = params;
                const workspace = input.workspaces.find((candidate) => candidate.id === workspaceId);
                if (workspace) {
                  workspace.name = String(name);
                }
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

              if (sql.includes("INSERT INTO workspace_invitations")) {
                const [id, workspaceId, email, role, invitedByUserId, createdAt, updatedAt, expiresAt] = params;
                invitations.push({
                  id: String(id),
                  workspace_id: String(workspaceId),
                  email: String(email),
                  role: role === "admin" ? "admin" : "member",
                  status: "pending",
                  invited_by_user_id: String(invitedByUserId),
                  accepted_by_user_id: null,
                  created_at: String(createdAt),
                  updated_at: String(updatedAt),
                  expires_at: String(expiresAt)
                });
                return { success: true };
              }

              if (sql.includes("UPDATE workspace_invitations") && sql.includes("status = 'accepted'")) {
                const [acceptedByUserId, updatedAt, invitationId] = params;
                const invitation = invitations.find((candidate) => candidate.id === invitationId);
                if (invitation) {
                  invitation.status = "accepted";
                  invitation.accepted_by_user_id = String(acceptedByUserId);
                  invitation.updated_at = String(updatedAt);
                }
                return { success: true };
              }

              if (sql.includes("UPDATE workspace_invitations SET status = 'expired'")) {
                const [updatedAt, invitationId] = params;
                const invitation = invitations.find((candidate) => candidate.id === invitationId);
                if (invitation) {
                  invitation.status = "expired";
                  invitation.updated_at = String(updatedAt);
                }
                return { success: true };
              }

              if (sql.includes("UPDATE workspace_invitations SET status = 'cancelled'")) {
                const [updatedAt, invitationId] = params;
                const invitation = invitations.find((candidate) => candidate.id === invitationId);
                if (invitation) {
                  invitation.status = "cancelled";
                  invitation.updated_at = String(updatedAt);
                }
                return { success: true };
              }

              if (sql.includes("DELETE FROM workspace_memberships")) {
                const [workspaceId, userId] = params;
                const index = input.memberships.findIndex(
                  (membership) => membership.workspace_id === workspaceId && membership.user_id === userId
                );
                if (index >= 0) {
                  input.memberships.splice(index, 1);
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

              if (sql.includes("UPDATE workspace_memberships SET role = 'admin' WHERE workspace_id = ? AND role = 'owner'")) {
                const [workspaceId] = params;
                for (const membership of input.memberships) {
                  if (membership.workspace_id === workspaceId && membership.role === "owner") {
                    membership.role = "admin";
                  }
                }
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

              if (sql.includes("UPDATE workspaces SET created_by_user_id = ? WHERE id = ?")) {
                const [userId, workspaceId] = params;
                const workspace = input.workspaces.find((candidate) => candidate.id === workspaceId);
                if (workspace) {
                  workspace.created_by_user_id = String(userId);
                }
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

              if (sql.includes("SELECT id FROM workspace_invitations")) {
                const [workspaceId, email] = params;
                const invitation = invitations.find(
                  (candidate) =>
                    candidate.workspace_id === workspaceId && candidate.email === email && candidate.status === "pending"
                );
                return (invitation ? { id: invitation.id } : null) as T | null;
              }

              if (sql.includes("FROM workspace_memberships m") && sql.includes("lower(u.email) = ?")) {
                const [workspaceId, email] = params;
                const membership = input.memberships.find((candidate) => {
                  const user = users.find((userCandidate) => userCandidate.id === candidate.user_id);
                  return candidate.workspace_id === workspaceId && user?.email.toLowerCase() === email;
                });
                return (membership ? { id: membership.user_id } : null) as T | null;
              }

              if (sql.includes("FROM workspace_invitations") && sql.includes("WHERE id = ?")) {
                const [invitationId] = params;
                const invitation = invitations.find((candidate) => candidate.id === invitationId);
                return (invitation ?? null) as T | null;
              }

              if (sql.includes("JOIN workspace_memberships")) {
                const [workspaceId, userId] = params;
                const membership = input.memberships.find(
                  (candidate) => candidate.workspace_id === workspaceId && candidate.user_id === userId
                );
                const workspace = input.workspaces.find((candidate) => candidate.id === workspaceId);
                return (membership && workspace ? workspace : null) as T | null;
              }

              if (sql.includes("WHERE api_key_hash = ?")) {
                const [apiKeyHash] = params;
                return (input.workspaces.find((candidate) => candidate.api_key_hash === apiKeyHash) ?? null) as T | null;
              }

              throw new Error(`Unhandled fixture SQL: ${sql}`);
            },
            async all<T>() {
              if (sql.includes("JOIN workspaces") && sql.includes("ORDER BY t.created_at DESC")) {
                const [userId] = params;
                const results = input.memberships
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
                  .sort((a, b) => b.created_at.localeCompare(a.created_at));

                return { results } as T;
              }

              if (sql.includes("FROM workspace_invitations i") && sql.includes("WHERE i.email = ?")) {
                const [email, now] = params;
                const results = invitations
                  .filter((invitation) => {
                    const workspace = input.workspaces.find((candidate) => candidate.id === invitation.workspace_id);
                    return (
                      workspace &&
                      invitation.email === email &&
                      invitation.status === "pending" &&
                      invitation.expires_at > String(now)
                    );
                  })
                  .map((invitation) => {
                    const workspace = input.workspaces.find((candidate) => candidate.id === invitation.workspace_id);
                    const inviter = users.find((candidate) => candidate.id === invitation.invited_by_user_id);
                    return {
                      id: invitation.id,
                      workspace_id: invitation.workspace_id,
                      workspace_name: workspace?.name ?? null,
                      email: invitation.email,
                      role: invitation.role,
                      status: invitation.status,
                      inviter_user_id: invitation.invited_by_user_id,
                      inviter_name: inviter?.name ?? null,
                      inviter_email: inviter?.email ?? "",
                      inviter_display: inviter?.name || inviter?.email || "",
                      created_at: invitation.created_at,
                      updated_at: invitation.updated_at,
                      expires_at: invitation.expires_at
                    };
                  })
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

                return { results } as T;
              }

              if (sql.includes("FROM workspace_invitations i") && sql.includes("WHERE i.workspace_id = ?")) {
                const [workspaceId, now] = params;
                const results = invitations
                  .filter(
                    (invitation) =>
                      invitation.workspace_id === workspaceId &&
                      invitation.status === "pending" &&
                      invitation.expires_at > String(now)
                  )
                  .map((invitation) => {
                    const workspace = input.workspaces.find((candidate) => candidate.id === invitation.workspace_id);
                    const inviter = users.find((candidate) => candidate.id === invitation.invited_by_user_id);
                    return {
                      id: invitation.id,
                      workspace_id: invitation.workspace_id,
                      workspace_name: workspace?.name ?? null,
                      email: invitation.email,
                      role: invitation.role,
                      status: invitation.status,
                      inviter_user_id: invitation.invited_by_user_id,
                      inviter_name: inviter?.name ?? null,
                      inviter_email: inviter?.email ?? "",
                      inviter_display: inviter?.name || inviter?.email || "",
                      created_at: invitation.created_at,
                      updated_at: invitation.updated_at,
                      expires_at: invitation.expires_at
                    };
                  })
                  .sort((a, b) => b.created_at.localeCompare(a.created_at));

                return { results } as T;
              }

              if (sql.includes("FROM workspace_memberships m") && sql.includes("JOIN user u")) {
                const [workspaceId] = params;
                const roleRank = { owner: 0, admin: 1, member: 2 };
                const results = input.memberships
                  .filter((membership) => membership.workspace_id === workspaceId)
                  .map((membership) => {
                    const user = users.find((candidate) => candidate.id === membership.user_id);
                    if (!user) {
                      return null;
                    }
                    return {
                      user_id: membership.user_id,
                      name: user.name,
                      email: user.email,
                      role: membership.role,
                      created_at: membership.created_at ?? "2026-05-04T00:00:00.000Z"
                    };
                  })
                  .filter((user) => user !== null)
                  .sort((a, b) => {
                    const roleComparison = roleRank[a.role] - roleRank[b.role];
                    if (roleComparison !== 0) {
                      return roleComparison;
                    }
                    return (a.name ?? "").localeCompare(b.name ?? "") || a.email.localeCompare(b.email);
                  });

                return { results } as T;
              }

              if (sql.includes("FROM templates") && sql.includes("WHERE workspace_id = ? AND deleted_at IS NULL")) {
                const [workspaceId] = params;
                const results = templates
                  .filter((template) => template.workspace_id === workspaceId && template.status !== "deleted")
                  .map((template) => ({
                    id: template.id,
                    name: template.name,
                    description: template.description,
                    status: template.status,
                    current_version: template.current_version,
                    created_at: template.created_at,
                    updated_at: template.updated_at
                  }))
                  .sort((a, b) => b.created_at.localeCompare(a.created_at));

                return { results } as T;
              }

              if (sql.includes("FROM jobs j")) {
                const [workspaceId] = params;
                const limit = Number(params[params.length - 1]);
                const results = jobs
                  .filter((job) => job.workspace_id === workspaceId)
                  .map((job) => ({
                    ...job,
                    sort_at: job.updated_at || job.created_at
                  }))
                  .sort((a, b) => b.sort_at.localeCompare(a.sort_at) || b.id.localeCompare(a.id))
                  .slice(0, limit);

                return { results } as T;
              }

              throw new Error(`Unhandled fixture SQL: ${sql}`);
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

function createWorkspaceFixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace_123",
    api_key_hash: "hash_123",
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

describe("Workspace policy", () => {
  it("authorizes session workspace access for a workspace member", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_member", role: "member" }]
    });

    await expect(
      authorizeWorkspaceForSession(db, { workspaceId: workspace.id, userId: "user_member" })
    ).resolves.toEqual(workspace);
  });

  it("authorizes workspace API key access without membership context", async () => {
    const apiKey = "key_secret";
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: await sha256(apiKey),
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({ workspaces: [workspace], memberships: [] });

    await expect(authorizeWorkspaceForApiKey(db, { apiKey })).resolves.toEqual(workspace);
  });

  it("lists a user's workspaces with membership roles", async () => {
    const db = createD1Fixture({
      workspaces: [
        {
          id: "workspace_old",
          api_key_hash: "hash_old",
          name: "Archive",
          created_at: "2026-05-03T00:00:00.000Z",
          created_by_user_id: "user_owner",
          rate_limit_per_minute: null,
          max_templates: null,
          max_fields_per_template: null,
          max_source_file_bytes: 10
        },
        {
          id: "workspace_new",
          api_key_hash: "hash_new",
          name: "Research",
          created_at: "2026-05-04T00:00:00.000Z",
          created_by_user_id: "user_owner",
          rate_limit_per_minute: null,
          max_templates: null,
          max_fields_per_template: null,
          max_source_file_bytes: 20
        }
      ],
      memberships: [
        { workspace_id: "workspace_old", user_id: "user_member", role: "member" },
        { workspace_id: "workspace_new", user_id: "user_member", role: "admin" },
        { workspace_id: "workspace_old", user_id: "other_user", role: "owner" }
      ]
    });

    await expect(listWorkspacesForUser(db, { userId: "user_member" })).resolves.toEqual([
      {
        id: "workspace_new",
        name: "Research",
        created_at: "2026-05-04T00:00:00.000Z",
        max_source_file_bytes: 20,
        has_api_key: true,
        role: "admin"
      },
      {
        id: "workspace_old",
        name: "Archive",
        created_at: "2026-05-03T00:00:00.000Z",
        max_source_file_bytes: 10,
        has_api_key: true,
        role: "member"
      }
    ]);
  });

  it("lists workspace users for a workspace member with user details ordered by role", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      users: [
        { id: "user_member", name: "Mina", email: "mina@example.com" },
        { id: "user_owner", name: "Owen", email: "owen@example.com" },
        { id: "user_admin", name: "Ada", email: "ada@example.com" }
      ],
      memberships: [
        { workspace_id: workspace.id, user_id: "user_member", role: "member", created_at: "2026-05-04T03:00:00.000Z" },
        { workspace_id: workspace.id, user_id: "user_owner", role: "owner", created_at: "2026-05-04T01:00:00.000Z" },
        { workspace_id: workspace.id, user_id: "user_admin", role: "admin", created_at: "2026-05-04T02:00:00.000Z" }
      ]
    });

    await expect(listWorkspaceUsersForUser(db, { workspaceId: workspace.id, userId: "user_member" })).resolves.toEqual([
      {
        user_id: "user_owner",
        name: "Owen",
        email: "owen@example.com",
        role: "owner",
        created_at: "2026-05-04T01:00:00.000Z"
      },
      {
        user_id: "user_admin",
        name: "Ada",
        email: "ada@example.com",
        role: "admin",
        created_at: "2026-05-04T02:00:00.000Z"
      },
      {
        user_id: "user_member",
        name: "Mina",
        email: "mina@example.com",
        role: "member",
        created_at: "2026-05-04T03:00:00.000Z"
      }
    ]);
  });

  it("removes an admin from a workspace when the actor is the owner", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_owner",
        targetUserId: "user_admin",
        action: "remove_user"
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, target_user_id: "user_admin", action: "remove_user" });

    expect(memberships).toEqual([{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]);
  });

  it("removes a member from a workspace when the actor is an admin", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_admin",
        targetUserId: "user_member",
        action: "remove_user"
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, target_user_id: "user_member", action: "remove_user" });

    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" }
    ]);
  });

  it("rejects admin attempts to remove owners or admins", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: workspace.id, user_id: "other_admin", role: "admin" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_admin",
        targetUserId: "user_owner",
        action: "remove_user"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "Admins can only remove non-admin users" });
    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_admin",
        targetUserId: "other_admin",
        action: "remove_user"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "Admins can only remove non-admin users" });
    expect(memberships).toHaveLength(3);
  });

  it("requires owner transfer before removing the current owner", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_owner",
        targetUserId: "user_owner",
        action: "remove_user"
      })
    ).rejects.toMatchObject({ code: "owner_transfer_required", message: "Transfer ownership before removing the owner" });
    expect(memberships).toHaveLength(2);
  });

  it("promotes a workspace member to admin when the actor is the owner", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_owner",
        targetUserId: "user_member",
        action: "make_admin"
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, target_user_id: "user_member", role: "admin" });
    expect(memberships).toContainEqual({ workspace_id: workspace.id, user_id: "user_member", role: "admin" });
  });

  it("rejects admin attempts to promote workspace users", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_admin",
        targetUserId: "user_member",
        action: "make_admin"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "Admins can only remove member users" });
    expect(memberships).toContainEqual({ workspace_id: workspace.id, user_id: "user_member", role: "member" });
  });

  it("transfers ownership to an existing workspace member and leaves exactly one owner", async () => {
    const workspace = createWorkspaceFixture();
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });

    await expect(
      updateWorkspaceUserRoleForUser(db, {
        workspaceId: workspace.id,
        actingUserId: "user_owner",
        targetUserId: "user_member",
        action: "make_owner"
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, target_user_id: "user_member", role: "owner" });

    expect(memberships.filter((membership) => membership.role === "owner")).toEqual([
      { workspace_id: workspace.id, user_id: "user_member", role: "owner" }
    ]);
    expect(memberships).toContainEqual({ workspace_id: workspace.id, user_id: "user_owner", role: "admin" });
    expect(workspace.created_by_user_id).toBe("user_member");
  });

  it("creates a workspace with an owner membership and no external-client API key", async () => {
    const db = createD1Fixture({ workspaces: [], memberships: [] });

    const created = await createWorkspaceForUser(db, { userId: "user_owner", name: "Research" });

    expect(created).toEqual({
      workspace_id: expect.stringMatching(/^workspace_/),
      has_api_key: false,
      name: "Research",
      role: "owner",
      created_at: expect.any(String)
    });
    expect(created).not.toHaveProperty("api_key");

    await expect(listWorkspacesForUser(db, { userId: "user_owner" })).resolves.toEqual([
      {
        id: created.workspace_id,
        name: "Research",
        created_at: created.created_at,
        max_source_file_bytes: null,
        has_api_key: false,
        role: "owner"
      }
    ]);
  });

  it("bootstraps a starter workspace for a new user without an external-client API key", async () => {
    const db = createD1Fixture({ workspaces: [], memberships: [] });

    const created = await bootstrapWorkspaceForNewUser(db, { userId: "user_new", userName: "Alex" }, { createStarterTemplate: async () => {} });

    if (!created.created) {
      throw new Error("Expected bootstrap to create a workspace");
    }
    expect(created).toEqual({
      created: true,
      workspace_id: expect.stringMatching(/^workspace_/),
      has_api_key: false,
      name: "Alex Workspace",
      role: "owner",
      created_at: expect.any(String)
    });
    expect(created).not.toHaveProperty("api_key");
    await expect(listWorkspacesForUser(db, { userId: "user_new" })).resolves.toEqual([
      {
        id: created.workspace_id,
        name: "Alex Workspace",
        created_at: created.created_at,
        max_source_file_bytes: null,
        has_api_key: false,
        role: "owner"
      }
    ]);
  });

  it("does not bootstrap another starter workspace for a user with an existing membership", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_existing", created_by_user_id: "user_other" });
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_existing", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships });
    let starterTemplateCalls = 0;

    const created = await bootstrapWorkspaceForNewUser(
      db,
      { userId: "user_existing", userName: "Alex" },
      {
        createStarterTemplate: async () => {
          starterTemplateCalls += 1;
        }
      }
    );

    expect(created).toEqual({ created: false, workspace_id: workspace.id });
    expect(starterTemplateCalls).toBe(0);
    expect(memberships).toEqual([{ workspace_id: workspace.id, user_id: "user_existing", role: "member" }]);
    expect(await listWorkspacesForUser(db, { userId: "user_existing" })).toHaveLength(1);
  });

  it("bootstraps the current starter invoice template through the starter template adapter", async () => {
    const templates: TemplateFixture[] = [];
    const templateFields: TemplateFieldFixture[] = [];
    const db = createD1Fixture({ workspaces: [], memberships: [], templates, templateFields });

    const created = await bootstrapWorkspaceForNewUser(
      db,
      { userId: "user_new", userName: "Alex" },
      createRecordingStarterInvoiceTemplate({ templates, templateFields }),
    );

    if (!created.created) {
      throw new Error("Expected bootstrap to create a workspace");
    }
    expect(templates).toEqual([
      {
        id: expect.stringMatching(/^tpl_/),
        workspace_id: created.workspace_id,
        name: "Example Invoice",
        description: "Starter template that extracts key invoice fields for quick testing.",
        status: "active",
        current_version: 1,
        created_at: created.created_at,
        updated_at: created.created_at
      }
    ]);
    expect(templateFields).toEqual([
      expect.objectContaining({ field_id: "invoice_number", name: "Invoice Number", data_type: "string", required: 1, position: 1 }),
      expect.objectContaining({ field_id: "invoice_date", name: "Invoice Date", data_type: "date", required: 1, position: 2 }),
      expect.objectContaining({ field_id: "vendor_name", name: "Vendor Name", data_type: "string", required: 1, position: 3 }),
      expect.objectContaining({ field_id: "total_amount", name: "Total Amount", data_type: "number", required: 1, position: 4 }),
      expect.objectContaining({ field_id: "currency", name: "Currency", data_type: "string", required: 1, position: 5 })
    ]);
  });

  it("updates workspace settings for an owner", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    await expect(
      updateWorkspaceSettingsForUser(db, { workspaceId: workspace.id, userId: "user_owner", name: "Field Research" })
    ).resolves.toEqual({ workspace_id: workspace.id, name: "Field Research" });

    expect(workspace.name).toBe("Field Research");
  });

  it("updates workspace settings for an admin", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_admin", role: "admin" }]
    });

    await expect(
      updateWorkspaceSettingsForUser(db, { workspaceId: workspace.id, userId: "user_admin", name: "Field Research" })
    ).resolves.toEqual({ workspace_id: workspace.id, name: "Field Research" });

    expect(workspace.name).toBe("Field Research");
  });


  it("rejects workspace settings updates from members", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_member", role: "member" }]
    });

    await expect(
      updateWorkspaceSettingsForUser(db, { workspaceId: workspace.id, userId: "user_member", name: "Field Research" })
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "Only owners/admins can update workspace settings"
    });
    await expect(
      updateWorkspaceSettingsForUser(db, { workspaceId: workspace.id, userId: "user_member", name: "Field Research" })
    ).rejects.toBeInstanceOf(WorkspacePolicyError);
    expect(workspace.name).toBe("Research");
  });

  it("rotates a workspace API key for an admin and returns the plaintext key once", async () => {
    const oldApiKey = "key_old_secret";
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: await sha256(oldApiKey),
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_admin", role: "admin" }]
    });

    const rotated = await rotateWorkspaceApiKeyForUser(db, { workspaceId: workspace.id, userId: "user_admin" });

    expect(rotated).toEqual({
      workspace_id: workspace.id,
      api_key: expect.stringMatching(/^key_/),
      has_api_key: true,
      rotated_at: expect.any(String)
    });
    expect(workspace.api_key_hash).not.toContain(rotated.api_key);
    await expect(authorizeWorkspaceForApiKey(db, { apiKey: oldApiKey })).resolves.toBeNull();
    await expect(authorizeWorkspaceForApiKey(db, { apiKey: rotated.api_key })).resolves.toMatchObject({
      id: workspace.id
    });
  });

  it("rotates a workspace API key for an owner", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_old",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    await expect(rotateWorkspaceApiKeyForUser(db, { workspaceId: workspace.id, userId: "user_owner" })).resolves.toEqual({
      workspace_id: workspace.id,
      api_key: expect.stringMatching(/^key_/),
      has_api_key: true,
      rotated_at: expect.any(String)
    });
  });

  it("approves workspace deletion for an owner who has another workspace", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_delete" });
    const otherWorkspace = createWorkspaceFixture({ id: "workspace_keep" });
    const db = createD1Fixture({
      workspaces: [workspace, otherWorkspace],
      memberships: [
        { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
        { workspace_id: otherWorkspace.id, user_id: "user_owner", role: "owner" }
      ]
    });

    await expect(
      approveWorkspaceDeletionForUser(db, { workspaceId: workspace.id, userId: "user_owner" })
    ).resolves.toEqual(undefined);
  });

  it("rejects workspace deletion approval for admins and members", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_delete" });
    const otherWorkspace = createWorkspaceFixture({ id: "workspace_keep" });
    const db = createD1Fixture({
      workspaces: [workspace, otherWorkspace],
      memberships: [
        { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
        { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
        { workspace_id: otherWorkspace.id, user_id: "user_admin", role: "owner" },
        { workspace_id: workspace.id, user_id: "user_member", role: "member" },
        { workspace_id: otherWorkspace.id, user_id: "user_member", role: "owner" }
      ]
    });

    await expect(
      approveWorkspaceDeletionForUser(db, { workspaceId: workspace.id, userId: "user_admin" })
    ).rejects.toMatchObject({ code: "forbidden", message: "Only owners can delete workspaces" });
    await expect(
      approveWorkspaceDeletionForUser(db, { workspaceId: workspace.id, userId: "user_member" })
    ).rejects.toMatchObject({ code: "forbidden", message: "Only owners can delete workspaces" });
  });

  it("rejects workspace deletion approval for an owner deleting their only workspace", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_only" });
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    await expect(
      approveWorkspaceDeletionForUser(db, { workspaceId: workspace.id, userId: "user_owner" })
    ).rejects.toMatchObject({ code: "last_workspace", message: "You cannot delete your only workspace" });
  });

  it("rejects workspace deletion approval for non-members", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_delete" });
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    await expect(
      approveWorkspaceDeletionForUser(db, { workspaceId: workspace.id, userId: "user_outsider" })
    ).rejects.toMatchObject({ code: "forbidden", message: "You are not a member of this workspace" });
  });

  it("lets a workspace admin leave without deleting the workspace or other memberships", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_leave" });
    const otherWorkspace = createWorkspaceFixture({ id: "workspace_keep" });
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" },
      { workspace_id: otherWorkspace.id, user_id: "user_admin", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace, otherWorkspace], memberships });

    await expect(leaveWorkspaceForUser(db, { workspaceId: workspace.id, userId: "user_admin" })).resolves.toEqual({
      ok: true,
      workspace_id: workspace.id
    });

    expect([workspace, otherWorkspace].map((candidate) => candidate.id)).toEqual(["workspace_leave", "workspace_keep"]);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" },
      { workspace_id: otherWorkspace.id, user_id: "user_admin", role: "member" }
    ]);
  });

  it("lets a workspace member leave while preserving their other workspace membership", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_leave" });
    const otherWorkspace = createWorkspaceFixture({ id: "workspace_keep" });
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" },
      { workspace_id: otherWorkspace.id, user_id: "user_member", role: "admin" }
    ];
    const db = createD1Fixture({ workspaces: [workspace, otherWorkspace], memberships });

    await expect(leaveWorkspaceForUser(db, { workspaceId: workspace.id, userId: "user_member" })).resolves.toEqual({
      ok: true,
      workspace_id: workspace.id
    });

    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: otherWorkspace.id, user_id: "user_member", role: "admin" }
    ]);
  });

  it("lets remaining workspace members keep listing workspace templates and jobs after another member leaves", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_leave" });
    const otherWorkspace = createWorkspaceFixture({ id: "workspace_keep" });
    const template: TemplateFixture = {
      id: "tpl_invoice",
      workspace_id: workspace.id,
      name: "Invoice",
      description: "Invoice fields",
      status: "active",
      current_version: 1,
      created_at: "2026-05-04T00:00:00.000Z",
      updated_at: "2026-05-04T00:00:00.000Z"
    };
    const job: JobFixture = {
      id: "job_invoice",
      workspace_id: workspace.id,
      status: "completed",
      template_id: template.id,
      template_version: 1,
      source_name: "invoice.png",
      error_code: null,
      error_message: null,
      created_at: "2026-05-05T00:00:00.000Z",
      updated_at: "2026-05-05T00:00:00.000Z",
      completed_at: "2026-05-05T00:01:00.000Z",
      current_attempt: 1,
      completed_attempt: 1,
      last_failed_attempt: null
    };
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" },
      { workspace_id: otherWorkspace.id, user_id: "user_member", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace, otherWorkspace], memberships, templates: [template], jobs: [job] });

    await leaveWorkspaceForUser(db, { workspaceId: workspace.id, userId: "user_member" });
    const remainingMemberWorkspace = await authorizeWorkspaceForSession(db, {
      workspaceId: workspace.id,
      userId: "user_owner"
    });

    expect(remainingMemberWorkspace).toEqual(workspace);
    await expect(listTemplates(createTemplateRouteEnv(db, [template]), workspace).then((response) => response.json())).resolves.toEqual({
      templates: [
        {
          id: template.id,
          name: "Invoice",
          description: "Invoice fields",
          status: "active",
          current_version: 1,
          created_at: "2026-05-04T00:00:00.000Z",
          updated_at: "2026-05-04T00:00:00.000Z"
        }
      ]
    });
    await expect(
      listJobs(new Request("https://example.com/v1/jobs"), createTemplateRouteEnv(db, [template], [job]), workspace).then((response) => response.json())
    ).resolves.toEqual({
      jobs: [
        {
          job_id: job.id,
          status: "completed",
          source_name: "invoice.png",
          template_id: template.id,
          template_version: 1,
          error_code: null,
          error_message: null,
          created_at: "2026-05-05T00:00:00.000Z",
          updated_at: "2026-05-05T00:00:00.000Z",
          completed_at: "2026-05-05T00:01:00.000Z",
          current_attempt: 1,
          completed_attempt: 1,
          last_failed_attempt: 0,
          results: []
        }
      ],
      next_cursor: null,
      has_more: false
    });
  });

  it("keeps pending workspace invitations and the workspace API key valid after the inviter leaves", async () => {
    const apiKey = "key_workspace_leave";
    const workspace = createWorkspaceFixture({ id: "workspace_leave", api_key_hash: await sha256(apiKey) });
    const otherWorkspace = createWorkspaceFixture({ id: "workspace_keep" });
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_from_leaver",
        workspace_id: workspace.id,
        email: "first@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_admin",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      },
      {
        id: "invite_from_owner",
        workspace_id: workspace.id,
        email: "second@example.com",
        role: "admin",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z",
        expires_at: "2999-05-12T00:00:00.000Z"
      }
    ];
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_admin", role: "admin" },
      { workspace_id: otherWorkspace.id, user_id: "user_admin", role: "member" }
    ];
    const db = createD1Fixture({ workspaces: [workspace, otherWorkspace], memberships, invitations });

    await leaveWorkspaceForUser(db, { workspaceId: workspace.id, userId: "user_admin" });

    await expect(listManageableWorkspaceInvitationsForUser(db, { workspaceId: workspace.id, userId: "user_owner" })).resolves.toMatchObject([
      { id: "invite_from_owner", status: "pending", inviter_user_id: "user_owner" },
      { id: "invite_from_leaver", status: "pending", inviter_user_id: "user_admin" }
    ]);
    await expect(authorizeWorkspaceForApiKey(db, { apiKey })).resolves.toEqual(workspace);
  });

  it("creates a bootstrapped replacement Workspace when a non-owner leaves their last accepted Workspace", async () => {
    const workspace = createWorkspaceFixture({ id: "workspace_leave" });
    const workspaces = [workspace];
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      { workspace_id: workspace.id, user_id: "user_member", role: "member" }
    ];
    const templates: TemplateFixture[] = [];
    const templateFields: TemplateFieldFixture[] = [];
    const db = createD1Fixture({ workspaces, memberships, templates, templateFields });

    const result = await leaveWorkspaceForUser(
      db,
      { workspaceId: workspace.id, userId: "user_member", userName: "Mina Member" },
      createRecordingStarterInvoiceTemplate({ templates, templateFields })
    );

    expect(result).toEqual({
      ok: true,
      workspace_id: workspace.id,
      replacement_workspace: {
        workspace_id: expect.stringMatching(/^workspace_/),
        has_api_key: false,
        name: "Mina Member Workspace",
        role: "owner",
        created_at: expect.any(String)
      }
    });
    const replacement = result.replacement_workspace;
    expect(replacement).toBeDefined();
    if (!replacement) {
      throw new Error("Expected leave to return a replacement Workspace");
    }

    expect(workspaces.map((candidate) => candidate.id)).toEqual([workspace.id, replacement.workspace_id]);
    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
      {
        workspace_id: replacement.workspace_id,
        user_id: "user_member",
        role: "owner",
        created_at: replacement.created_at
      }
    ]);
    expect(templates).toEqual([
      expect.objectContaining({ workspace_id: replacement.workspace_id, name: "Example Invoice" })
    ]);
    expect(replacement).not.toHaveProperty("api_key");
  });

  it("invites a workspace member as an owner using a normalized email", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }],
      invitations
    });

    const invitation = await inviteWorkspaceMember(db, {
      workspaceId: workspace.id,
      inviterUserId: "user_owner",
      email: " Invited@Example.COM ",
      role: "admin"
    });

    expect(invitation).toEqual({
      invitation_id: expect.stringMatching(/^invite_/),
      workspace_id: workspace.id,
      email: "invited@example.com",
      role: "admin",
      status: "pending",
      expires_at: expect.any(String)
    });
    expect(invitations).toMatchObject([
      {
        id: invitation.invitation_id,
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "admin",
        status: "pending",
        invited_by_user_id: "user_owner"
      }
    ]);
  });

  it("invites a workspace member as an admin", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_admin", role: "admin" }],
      invitations: []
    });

    await expect(
      inviteWorkspaceMember(db, {
        workspaceId: workspace.id,
        inviterUserId: "user_admin",
        email: "invited@example.com",
        role: "member"
      })
    ).resolves.toMatchObject({ workspace_id: workspace.id, email: "invited@example.com", role: "member", status: "pending" });
  });

  it("rejects workspace invitations from members", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_member", role: "member" }],
      invitations
    });

    await expect(
      inviteWorkspaceMember(db, {
        workspaceId: workspace.id,
        inviterUserId: "user_member",
        email: "invited@example.com",
        role: "member"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "Only owners/admins can invite users" });
    expect(invitations).toEqual([]);
  });

  it("rejects duplicate pending workspace invitations for a normalized email", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_existing",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2026-05-11T00:00:00.000Z"
      }
    ];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }],
      invitations
    });

    await expect(
      inviteWorkspaceMember(db, {
        workspaceId: workspace.id,
        inviterUserId: "user_owner",
        email: " Invited@Example.COM ",
        role: "admin"
      })
    ).rejects.toMatchObject({ code: "invite_exists", message: "A pending invitation already exists for this user" });
    expect(invitations).toHaveLength(1);
  });

  it("rejects workspace invitations for current workspace members by normalized email", async () => {
    const workspace = createWorkspaceFixture();
    const invitations: WorkspaceInvitationFixture[] = [];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [
        { workspace_id: workspace.id, user_id: "user_owner", role: "owner" },
        { workspace_id: workspace.id, user_id: "user_member", role: "member" }
      ],
      users: [
        { id: "user_owner", name: "Olivia Owner", email: "owner@example.com" },
        { id: "user_member", name: "Mina Member", email: "member@example.com" }
      ],
      invitations
    });

    await expect(
      inviteWorkspaceMember(db, {
        workspaceId: workspace.id,
        inviterUserId: "user_owner",
        email: " Member@Example.COM ",
        role: "member"
      })
    ).rejects.toMatchObject({ code: "invite_exists", message: "This user is already a workspace member" });
    expect(invitations).toEqual([]);
  });

  it("lists pending workspace invitations for a normalized email", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [],
      users: [{ id: "user_owner", name: "Olivia Owner", email: "owner@example.com" }],
      invitations: [
        {
          id: "invite_new",
          workspace_id: workspace.id,
          email: "invited@example.com",
          role: "member",
          status: "pending",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: null,
          created_at: "2026-05-04T00:00:00.000Z",
          updated_at: "2026-05-04T00:00:00.000Z",
          expires_at: "2026-06-11T00:00:00.000Z"
        },
        {
          id: "invite_old",
          workspace_id: workspace.id,
          email: "invited@example.com",
          role: "admin",
          status: "accepted",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: "user_invited",
          created_at: "2026-05-03T00:00:00.000Z",
          updated_at: "2026-05-03T00:00:00.000Z",
          expires_at: "2026-05-10T00:00:00.000Z"
        }
      ]
    });

    await expect(listPendingWorkspaceInvitationsForEmail(db, { email: " Invited@Example.COM " })).resolves.toEqual([
      {
        id: "invite_new",
        workspace_id: workspace.id,
        workspace_name: "Research",
        email: "invited@example.com",
        role: "member",
        status: "pending",
        inviter_user_id: "user_owner",
        inviter_name: "Olivia Owner",
        inviter_email: "owner@example.com",
        inviter_display: "Olivia Owner",
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2026-06-11T00:00:00.000Z"
      }
    ]);
  });

  it("lists only actionable invitee-facing workspace invitations ordered by latest update", async () => {
    const olderWorkspace = createWorkspaceFixture({ id: "workspace_older", name: "Older Research" });
    const newerWorkspace = createWorkspaceFixture({ id: "workspace_newer", name: "Newer Lab" });
    const db = createD1Fixture({
      workspaces: [olderWorkspace, newerWorkspace],
      memberships: [],
      users: [
        { id: "user_owner", name: "Olivia Owner", email: "owner@example.com" },
        { id: "user_admin", name: null, email: "admin@example.com" }
      ],
      invitations: [
        {
          id: "invite_older",
          workspace_id: olderWorkspace.id,
          email: "invited@example.com",
          role: "member",
          status: "pending",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: null,
          created_at: "2026-05-01T00:00:00.000Z",
          updated_at: "2999-05-01T00:00:00.000Z",
          expires_at: "2999-05-11T00:00:00.000Z"
        },
        {
          id: "invite_newer",
          workspace_id: newerWorkspace.id,
          email: "invited@example.com",
          role: "admin",
          status: "pending",
          invited_by_user_id: "user_admin",
          accepted_by_user_id: null,
          created_at: "2026-05-02T00:00:00.000Z",
          updated_at: "2999-05-03T00:00:00.000Z",
          expires_at: "2999-05-12T00:00:00.000Z"
        },
        {
          id: "invite_expired",
          workspace_id: olderWorkspace.id,
          email: "invited@example.com",
          role: "member",
          status: "pending",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: null,
          created_at: "2026-05-03T00:00:00.000Z",
          updated_at: "2026-05-03T00:00:00.000Z",
          expires_at: "2026-05-04T00:00:00.000Z"
        },
        {
          id: "invite_cancelled",
          workspace_id: olderWorkspace.id,
          email: "invited@example.com",
          role: "member",
          status: "cancelled",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: null,
          created_at: "2026-05-04T00:00:00.000Z",
          updated_at: "2999-05-04T00:00:00.000Z",
          expires_at: "2999-05-14T00:00:00.000Z"
        },
        {
          id: "invite_deleted_workspace",
          workspace_id: "workspace_deleted",
          email: "invited@example.com",
          role: "member",
          status: "pending",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: null,
          created_at: "2026-05-05T00:00:00.000Z",
          updated_at: "2999-05-05T00:00:00.000Z",
          expires_at: "2999-05-15T00:00:00.000Z"
        }
      ]
    });

    await expect(listPendingWorkspaceInvitationsForEmail(db, { email: " Invited@Example.COM " })).resolves.toEqual([
      {
        id: "invite_newer",
        workspace_id: newerWorkspace.id,
        workspace_name: "Newer Lab",
        email: "invited@example.com",
        role: "admin",
        status: "pending",
        inviter_user_id: "user_admin",
        inviter_name: null,
        inviter_email: "admin@example.com",
        inviter_display: "admin@example.com",
        created_at: "2026-05-02T00:00:00.000Z",
        updated_at: "2999-05-03T00:00:00.000Z",
        expires_at: "2999-05-12T00:00:00.000Z"
      },
      {
        id: "invite_older",
        workspace_id: olderWorkspace.id,
        workspace_name: "Older Research",
        email: "invited@example.com",
        role: "member",
        status: "pending",
        inviter_user_id: "user_owner",
        inviter_name: "Olivia Owner",
        inviter_email: "owner@example.com",
        inviter_display: "Olivia Owner",
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2999-05-01T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ]);
  });

  it("lists actionable pending workspace invitations for a workspace owner", async () => {
    const workspace = createWorkspaceFixture();
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }],
      users: [{ id: "user_owner", name: "Olivia Owner", email: "owner@example.com" }],
      invitations: [
        {
          id: "invite_new",
          workspace_id: workspace.id,
          email: "invited@example.com",
          role: "admin",
          status: "pending",
          invited_by_user_id: "user_owner",
          accepted_by_user_id: null,
          created_at: "2026-05-04T00:00:00.000Z",
          updated_at: "2026-05-04T00:00:00.000Z",
          expires_at: "2999-05-11T00:00:00.000Z"
        }
      ]
    });

    await expect(
      listManageableWorkspaceInvitationsForUser(db, { workspaceId: workspace.id, userId: "user_owner" })
    ).resolves.toEqual([
      {
        id: "invite_new",
        workspace_id: workspace.id,
        workspace_name: "Research",
        email: "invited@example.com",
        role: "admin",
        status: "pending",
        inviter_user_id: "user_owner",
        inviter_name: "Olivia Owner",
        inviter_email: "owner@example.com",
        inviter_display: "Olivia Owner",
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ]);
  });

  it("rejects manageable workspace invitation listing from members", async () => {
    const workspace = createWorkspaceFixture();
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_member", role: "member" }],
      invitations: []
    });

    await expect(
      listManageableWorkspaceInvitationsForUser(db, { workspaceId: workspace.id, userId: "user_member" })
    ).rejects.toMatchObject({ code: "forbidden", message: "Only owners/admins can manage invitations" });
  });

  it("lets a workspace owner cancel a pending workspace invitation", async () => {
    const workspace = createWorkspaceFixture();
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }],
      invitations
    });

    await expect(
      cancelWorkspaceInvitationForUser(db, {
        workspaceId: workspace.id,
        invitationId: "invite_123",
        userId: "user_owner"
      })
    ).resolves.toEqual({ ok: true, invitation_id: "invite_123", status: "cancelled" });
    expect(invitations[0]).toMatchObject({ status: "cancelled", accepted_by_user_id: null });
  });

  it("lets a workspace admin cancel a pending workspace invitation", async () => {
    const workspace = createWorkspaceFixture();
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_admin", role: "admin" }],
      invitations
    });

    await expect(
      cancelWorkspaceInvitationForUser(db, {
        workspaceId: workspace.id,
        invitationId: "invite_123",
        userId: "user_admin"
      })
    ).resolves.toEqual({ ok: true, invitation_id: "invite_123", status: "cancelled" });
    expect(invitations[0]).toMatchObject({ status: "cancelled", accepted_by_user_id: null });
  });

  it("rejects workspace invitation cancellation from members", async () => {
    const workspace = createWorkspaceFixture();
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_member", role: "member" }],
      invitations
    });

    await expect(
      cancelWorkspaceInvitationForUser(db, {
        workspaceId: workspace.id,
        invitationId: "invite_123",
        userId: "user_member"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "Only owners/admins can manage invitations" });
    expect(invitations[0]).toMatchObject({ status: "pending", accepted_by_user_id: null });
  });

  it("lets an invitee decline their own pending workspace invitation", async () => {
    const workspace = createWorkspaceFixture();
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships: [], invitations });

    await expect(
      declineWorkspaceInvitation(db, {
        invitationId: "invite_123",
        userEmail: " Invited@Example.COM "
      })
    ).resolves.toEqual({ ok: true, invitation_id: "invite_123", status: "cancelled" });

    expect(invitations[0]).toMatchObject({ status: "cancelled", accepted_by_user_id: null });
  });

  it("rejects declining a workspace invitation for a different email", async () => {
    const workspace = createWorkspaceFixture();
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships: [], invitations });

    await expect(
      declineWorkspaceInvitation(db, {
        invitationId: "invite_123",
        userEmail: "wrong@example.com"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "This invitation is for a different email address" });

    expect(invitations[0]).toMatchObject({ status: "pending", accepted_by_user_id: null });
  });

  it("accepts a pending workspace invitation for the invited email", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "admin",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const memberships: WorkspaceMembershipFixture[] = [];
    const db = createD1Fixture({ workspaces: [workspace], memberships, invitations });

    await expect(
      acceptWorkspaceInvitation(db, {
        invitationId: "invite_123",
        userId: "user_invited",
        userEmail: " Invited@Example.COM "
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, role: "admin" });

    expect(memberships).toContainEqual(
      expect.objectContaining({ workspace_id: workspace.id, user_id: "user_invited", role: "admin" })
    );
    expect(invitations[0]).toMatchObject({ status: "accepted", accepted_by_user_id: "user_invited" });
  });

  it("accepts a workspace invitation without changing an existing membership role", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_invited", role: "admin", created_at: "2026-05-03T00:00:00.000Z" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships, invitations });

    await expect(
      acceptWorkspaceInvitation(db, {
        invitationId: "invite_123",
        userId: "user_invited",
        userEmail: "invited@example.com"
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, role: "admin" });

    expect(memberships).toEqual([
      { workspace_id: workspace.id, user_id: "user_invited", role: "admin", created_at: "2026-05-03T00:00:00.000Z" }
    ]);
    expect(invitations[0]).toMatchObject({ status: "accepted", accepted_by_user_id: "user_invited" });
  });

  it("accepts a workspace invitation after the inviter is no longer an owner or admin", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_demoted_inviter",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const memberships: WorkspaceMembershipFixture[] = [
      { workspace_id: workspace.id, user_id: "user_demoted_inviter", role: "member", created_at: "2026-05-04T00:00:00.000Z" }
    ];
    const db = createD1Fixture({ workspaces: [workspace], memberships, invitations });

    await expect(
      acceptWorkspaceInvitation(db, {
        invitationId: "invite_123",
        userId: "user_invited",
        userEmail: "invited@example.com"
      })
    ).resolves.toEqual({ ok: true, workspace_id: workspace.id, role: "member" });

    expect(memberships).toContainEqual(
      expect.objectContaining({ workspace_id: workspace.id, user_id: "user_invited", role: "member" })
    );
    expect(invitations[0]).toMatchObject({ status: "accepted", accepted_by_user_id: "user_invited" });
  });

  it("rejects accepting a workspace invitation for a different email", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_123",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2999-05-11T00:00:00.000Z"
      }
    ];
    const memberships: WorkspaceMembershipFixture[] = [];
    const db = createD1Fixture({ workspaces: [workspace], memberships, invitations });

    await expect(
      acceptWorkspaceInvitation(db, {
        invitationId: "invite_123",
        userId: "user_wrong",
        userEmail: "wrong@example.com"
      })
    ).rejects.toMatchObject({ code: "forbidden", message: "This invitation is for a different email address" });

    expect(invitations[0]).toMatchObject({ status: "pending", accepted_by_user_id: null });
    expect(memberships).toEqual([]);
  });

  it("marks expired workspace invitations before returning the expiry error", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_123",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const invitations: WorkspaceInvitationFixture[] = [
      {
        id: "invite_expired",
        workspace_id: workspace.id,
        email: "invited@example.com",
        role: "member",
        status: "pending",
        invited_by_user_id: "user_owner",
        accepted_by_user_id: null,
        created_at: "2026-05-04T00:00:00.000Z",
        updated_at: "2026-05-04T00:00:00.000Z",
        expires_at: "2000-05-11T00:00:00.000Z"
      }
    ];
    const memberships: WorkspaceMembershipFixture[] = [];
    const db = createD1Fixture({ workspaces: [workspace], memberships, invitations });

    await expect(
      acceptWorkspaceInvitation(db, {
        invitationId: "invite_expired",
        userId: "user_invited",
        userEmail: "invited@example.com"
      })
    ).rejects.toMatchObject({ code: "invite_expired", message: "Invitation has expired" });

    expect(invitations[0]).toMatchObject({ status: "expired", accepted_by_user_id: null });
    expect(memberships).toEqual([]);
  });

  it("rejects workspace API key rotation from members", async () => {
    const workspace: Workspace = {
      id: "workspace_123",
      api_key_hash: "hash_old",
      name: "Research",
      created_at: "2026-05-04T00:00:00.000Z",
      created_by_user_id: "user_owner",
      rate_limit_per_minute: null,
      max_templates: null,
      max_fields_per_template: null,
      max_source_file_bytes: null
    };
    const db = createD1Fixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_member", role: "member" }]
    });

    await expect(rotateWorkspaceApiKeyForUser(db, { workspaceId: workspace.id, userId: "user_member" })).rejects.toMatchObject({
      code: "forbidden",
      message: "Only owners/admins can rotate workspace API keys"
    });
    expect(workspace.api_key_hash).toBe("hash_old");
  });
});

function createTemplateRouteEnv(db: D1Database, templates: TemplateFixture[], jobs: JobFixture[] = []): Env {
  return {
    DB: db,
    WORKSPACE_PRODUCT_STORE: {
      getByName: () => ({
        listTemplates: async () =>
          templates.map((template) => ({
            id: template.id,
            name: template.name,
            description: template.description,
            status: template.status,
            current_version: template.current_version,
            created_at: template.created_at,
            updated_at: template.updated_at
          })),
        listExtractionJobs: async () => ({
          jobs: jobs.map((job) => ({
            job_id: job.id,
            status: job.status,
            source_name: job.source_name,
            template_id: job.template_id,
            template_version: job.template_version,
            error_code: job.error_code,
            error_message: job.error_message,
            created_at: job.created_at,
            updated_at: job.updated_at,
            completed_at: job.completed_at,
            current_attempt: Number(job.current_attempt || 0),
            completed_attempt: Number(job.completed_attempt || 0),
            last_failed_attempt: Number(job.last_failed_attempt || 0),
            results: [],
          })),
          nextCursor: null,
          has_more: false,
        }),
      }),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"],
  } as Env;
}

function createRecordingStarterInvoiceTemplate({
  templates,
  templateFields,
}: {
  templates: TemplateFixture[];
  templateFields: TemplateFieldFixture[];
}) {
  return {
    async createStarterTemplate(input: { workspaceId: string; createdAt: string }) {
      const templateId = "tpl_recorded_starter_invoice";
      templates.push({
        id: templateId,
        workspace_id: input.workspaceId,
        name: "Example Invoice",
        description: "Starter template that extracts key invoice fields for quick testing.",
        status: "active",
        current_version: 1,
        created_at: input.createdAt,
        updated_at: input.createdAt,
      });
      templateFields.push(
        {
          template_id: templateId,
          version: 1,
          field_id: "invoice_number",
          name: "Invoice Number",
          description: "Unique invoice identifier.",
          data_type: "string",
          required: 1,
          position: 1,
        },
        {
          template_id: templateId,
          version: 1,
          field_id: "invoice_date",
          name: "Invoice Date",
          description: "Date shown on the invoice.",
          data_type: "date",
          required: 1,
          position: 2,
        },
        {
          template_id: templateId,
          version: 1,
          field_id: "vendor_name",
          name: "Vendor Name",
          description: "Name of the supplier issuing the invoice.",
          data_type: "string",
          required: 1,
          position: 3,
        },
        {
          template_id: templateId,
          version: 1,
          field_id: "total_amount",
          name: "Total Amount",
          description: "Total amount due on the invoice.",
          data_type: "number",
          required: 1,
          position: 4,
        },
        {
          template_id: templateId,
          version: 1,
          field_id: "currency",
          name: "Currency",
          description: "Currency code used for the totals (e.g. USD).",
          data_type: "string",
          required: 1,
          position: 5,
        },
      );
    },
  };
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
