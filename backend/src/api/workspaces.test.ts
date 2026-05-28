import { describe, expect, it } from "vitest";
import {
  cancelWorkspaceInvitationForUser,
  createWorkspaceForUser,
  declineInvitation,
  deleteWorkspaceForUser,
  leaveWorkspaceForUser,
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

function createEnvFixture(input: {
  workspaces: Workspace[];
  memberships: MembershipFixture[];
  invitations?: WorkspaceInvitationFixture[];
  jobSourceFileKeys?: string[];
  residualSourceFiles?: ResidualSourceFileFixture[];
}): Env & {
  deletedSourceFileKeys: string[];
  cleanedSourceFiles: ResidualSourceFileFixture[];
  createdTemplates: TemplateFixture[];
  createdTemplateFields: TemplateFieldFixture[];
  createdProductStoreTemplates: TemplateFixture[];
} {
  const deletedSourceFileKeys: string[] = [];
  const cleanedSourceFiles: ResidualSourceFileFixture[] = [];
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
              }
              return true;
            }
            return false;
          },
        };
      },
    } as unknown as DurableObjectNamespace,
    DB: {
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
    SOURCE_FILES_BUCKET: { delete: async (key: string) => { deletedSourceFileKeys.push(key); } },
    deletedSourceFileKeys,
    cleanedSourceFiles,
    createdTemplates,
    createdTemplateFields,
    createdProductStoreTemplates,
  } as unknown as Env & {
    deletedSourceFileKeys: string[];
    cleanedSourceFiles: ResidualSourceFileFixture[];
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
          role: "owner"
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
          role: "owner"
        }
      ]
    });
  });

  it("returns one-time API key material and existence state when issuing a workspace API key", async () => {
    const workspace = createWorkspace({ id: "workspace_key", api_key_hash: null });
    const env = createEnvFixture({
      workspaces: [workspace],
      memberships: [{ workspace_id: workspace.id, user_id: "user_owner", role: "owner" }]
    });

    const response = await rotateWorkspaceApiKeyForUser(
      new Request("https://example.test/v1/workspaces/workspace_key/api-key", { method: "POST" }),
      env,
      workspace.id,
      "user_owner"
    );
    const body = await response.json<IssuedWorkspaceApiKeyResponse>();

    expect(body).toEqual({
      workspace_id: workspace.id,
      api_key: expect.stringMatching(/^key_/),
      has_api_key: true,
      rotated_at: expect.any(String)
    });
    expect(workspace.api_key_hash).toEqual(expect.any(String));
    expect(workspace.api_key_hash).not.toContain(body.api_key);
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
  });

  it("deletes Workspace Source files through the Source file storage binding", async () => {
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
