import { describe, expect, it } from "vitest";
import { cancelWorkspaceInvitationForUser, declineInvitation, deleteWorkspaceForUser } from "./workspaces";
import { HttpError } from "../lib/http";
import type { Env, Workspace } from "../lib/types";

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
    max_image_bytes: null,
    ...overrides
  };
}

function createEnvFixture(input: {
  workspaces: Workspace[];
  memberships: MembershipFixture[];
  invitations?: WorkspaceInvitationFixture[];
  jobImageKeys?: string[];
}): Env {
  return {
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
                if (sql.includes("SELECT image_r2_key") && sql.includes("FROM jobs")) {
                  return { results: (input.jobImageKeys ?? []).map((image_r2_key) => ({ image_r2_key })) } as T;
                }

                throw new Error(`Unhandled fixture SQL: ${sql}`);
              }
            };
          }
        };
      }
    },
    IMAGES_BUCKET: { delete: async () => undefined }
  } as unknown as Env;
}

describe("Workspace routes", () => {
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
