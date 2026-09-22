import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl, LocalWorkspaceControlError } from "./localWorkspaceControl";

test("Workspace control atomically removes, promotes, and transfers ownership under member policy", async () => {
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);

  try {
    const owner = await createUser(auth, "Ada Lovelace", "ada@example.com");
    const admin = await createUser(auth, "Grace Hopper", "grace@example.com");
    const member = await createUser(auth, "Linus Torvalds", "linus@example.com");
    const workspace = workspaceControl.listAcceptedWorkspaces({ userId: owner.id, userName: owner.name })[0]!;
    for (const invitee of [admin, member]) {
      const invitation = workspaceControl.createInvitation({
        workspaceId: workspace.id,
        inviterUserId: owner.id,
        email: invitee.email,
        role: invitee.id === admin.id ? "admin" : "member",
      });
      workspaceControl.acceptInvitation({ invitationId: invitation.id, userId: invitee.id, userEmail: invitee.email });
    }

    expect(workspaceControl.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      actorUserId: owner.id,
      targetUserId: member.id,
      action: "make_admin",
    })).toEqual({ workspace_id: workspace.id, user_id: member.id, action: "make_admin", role: "admin" });
    expect(workspaceControl.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      actorUserId: owner.id,
      targetUserId: admin.id,
      action: "make_owner",
    })).toEqual({ workspace_id: workspace.id, user_id: admin.id, action: "make_owner", role: "owner" });
    expect(workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: admin.id })).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: admin.id, role: "owner" }),
      expect.objectContaining({ user_id: owner.id, role: "admin" }),
      expect.objectContaining({ user_id: member.id, role: "admin" }),
    ]));
    expect(workspaceControl.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      actorUserId: admin.id,
      targetUserId: member.id,
      action: "remove_user",
    })).toEqual({ workspace_id: workspace.id, user_id: member.id, action: "remove_user", role: null });
    expect(workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: admin.id }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ user_id: member.id })]));
    expect(() => workspaceControl.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      actorUserId: owner.id,
      targetUserId: admin.id,
      action: "remove_user",
    })).toThrow(new LocalWorkspaceControlError("forbidden", "Workspace member action is not permitted"));
  } finally {
    database.close();
  }
});

async function createUser(auth: Awaited<ReturnType<typeof createLocalAuth>>, name: string, email: string) {
  const response = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: "Strong1!" }),
  }));
  const body = await response.json() as { user: { id: string; name: string; email: string } };
  return body.user;
}
