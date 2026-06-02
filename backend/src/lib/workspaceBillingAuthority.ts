import type { Workspace, WorkspaceMembershipRole } from "./types";

export type WorkspaceBillingAuthority = {
  workspace: Workspace;
  role: WorkspaceMembershipRole;
};

export async function getWorkspaceBillingAuthorityForSession(
  db: D1Database,
  input: { workspaceId: string; userId: string },
): Promise<WorkspaceBillingAuthority | null> {
  const row = await db
    .prepare(
      `SELECT w.*,
              m.role
       FROM workspaces w
       JOIN workspace_memberships m ON m.workspace_id = w.id
       WHERE w.id = ? AND m.user_id = ?
       LIMIT 1`,
    )
    .bind(input.workspaceId, input.userId)
    .first<Workspace & { role: WorkspaceMembershipRole }>();

  if (!row) {
    return null;
  }

  const { role, ...workspace } = row;
  return { workspace, role };
}

export async function countAcceptedWorkspaceMemberships(
  db: D1Database,
  workspaceId: string,
): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<{ count: number | string }>();
  return Number(row?.count || 0);
}
