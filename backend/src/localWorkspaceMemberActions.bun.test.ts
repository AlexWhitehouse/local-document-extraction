import { readUserResponse } from "./testing/responseFixture";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { setLocalAuthRequestPeerAddress } from "./localAuthClientAddress";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { createLocalWorkspaceControl, LocalWorkspaceControlError } from "./localWorkspaceControl";

const origin = "http://127.0.0.1:8787";

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

    expect(
      workspaceControl.applyWorkspaceMemberAction({
        workspaceId: workspace.id,
        actorUserId: owner.id,
        targetUserId: member.id,
        action: "make_admin",
      }),
    ).toEqual({ workspace_id: workspace.id, user_id: member.id, action: "make_admin", role: "admin" });
    expect(
      workspaceControl.applyWorkspaceMemberAction({
        workspaceId: workspace.id,
        actorUserId: owner.id,
        targetUserId: admin.id,
        action: "make_owner",
      }),
    ).toEqual({ workspace_id: workspace.id, user_id: admin.id, action: "make_owner", role: "owner" });
    expect(workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: admin.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: admin.id, role: "owner" }),
        expect.objectContaining({ user_id: owner.id, role: "admin" }),
        expect.objectContaining({ user_id: member.id, role: "admin" }),
      ]),
    );
    expect(
      workspaceControl.applyWorkspaceMemberAction({
        workspaceId: workspace.id,
        actorUserId: admin.id,
        targetUserId: member.id,
        action: "remove_user",
      }),
    ).toEqual({ workspace_id: workspace.id, user_id: member.id, action: "remove_user", role: null });
    expect(workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: admin.id })).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ user_id: member.id })]),
    );
    expect(() =>
      workspaceControl.applyWorkspaceMemberAction({
        workspaceId: workspace.id,
        actorUserId: owner.id,
        targetUserId: admin.id,
        action: "remove_user",
      }),
    ).toThrow(new LocalWorkspaceControlError("forbidden", "Workspace member action is not permitted"));
  } finally {
    database.close();
  }
});

test("Only the owner demotes an admin to member, and owners change only through ownership transfer", async () => {
  const database = new Database(":memory:");

  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });

  const workspaceControl = createLocalWorkspaceControl(database);
  const forbidden = new LocalWorkspaceControlError("forbidden", "Workspace member action is not permitted");

  try {
    const owner = await createUser(auth, "Ada Lovelace", "ada@example.com");
    const admin = await createUser(auth, "Grace Hopper", "grace@example.com");
    const otherAdmin = await createUser(auth, "Katherine Johnson", "katherine@example.com");
    const workspace = workspaceControl.listAcceptedWorkspaces({ userId: owner.id, userName: owner.name })[0]!;

    for (const invitee of [admin, otherAdmin]) {
      const invitation = workspaceControl.createInvitation({
        workspaceId: workspace.id,
        inviterUserId: owner.id,
        email: invitee.email,
        role: "admin",
      });

      workspaceControl.acceptInvitation({ invitationId: invitation.id, userId: invitee.id, userEmail: invitee.email });
    }

    const act = (actorUserId: string, targetUserId: string) =>
      workspaceControl.applyWorkspaceMemberAction({
        workspaceId: workspace.id,
        actorUserId,
        targetUserId,
        action: "make_member",
      });

    const roleOf = (userId: string) =>
      workspaceControl
        .listWorkspaceUsers({ workspaceId: workspace.id, userId: owner.id })
        .find((user) => user.user_id === userId)?.role;

    // Admins cannot demote each other or the owner, and nobody demotes themselves.
    expect(() => act(otherAdmin.id, admin.id)).toThrow(forbidden);
    expect(() => act(admin.id, owner.id)).toThrow(forbidden);
    expect(() => act(owner.id, owner.id)).toThrow(forbidden);
    expect(() => act(admin.id, admin.id)).toThrow(forbidden);
    expect(() => act(owner.id, "missing-user")).toThrow(new LocalWorkspaceControlError("not_found", "Workspace member not found"));
    expect(roleOf(admin.id)).toBe("admin");

    expect(act(owner.id, admin.id)).toEqual({
      workspace_id: workspace.id,
      user_id: admin.id,
      action: "make_member",
      role: "member",
    });
    expect(roleOf(admin.id)).toBe("member");
    // Members cannot demote anyone, and a member cannot be demoted again.
    expect(() => act(admin.id, otherAdmin.id)).toThrow(forbidden);
    expect(() => act(owner.id, admin.id)).toThrow(forbidden);
    expect(workspaceControl.getAcceptedWorkspaceContext({ workspaceId: workspace.id, userId: admin.id })?.role).toBe(
      "member",
    );

    // The previous owner becomes an admin on transfer, so the new owner can demote them.
    workspaceControl.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      actorUserId: owner.id,
      targetUserId: otherAdmin.id,
      action: "make_owner",
    });
    expect(() => act(owner.id, otherAdmin.id)).toThrow(forbidden);
    expect(act(otherAdmin.id, owner.id).role).toBe("member");
    expect(roleOf(owner.id)).toBe("member");
    expect(roleOf(otherAdmin.id)).toBe("owner");
  } finally {
    database.close();
  }
});

test("A member action over HTTP returns the new role and invalidates open Workspace contexts", async () => {
  const database = new Database(":memory:");

  const auth = await createLocalAuth({
    requireEmailVerification: false,
    baseURL: origin,
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });

  const workspaceControl = createLocalWorkspaceControl(database);
  const liveUpdateHub = createLocalLiveUpdateHub();
  const application = createLocalApplication({ auth, workspaceControl, liveUpdateHub });
  const messages: string[] = [];

  try {
    const owner = await signUp(application, "ada@example.com", "192.0.2.1");
    const admin = await signUp(application, "grace@example.com", "192.0.2.2");
    const workspace = workspaceControl.createWorkspace({ userId: owner.id, name: "Shared" });

    const invitation = workspaceControl.createInvitation({
      workspaceId: workspace.workspace_id,
      inviterUserId: owner.id,
      email: "grace@example.com",
      role: "admin",
    });

    workspaceControl.acceptInvitation({ invitationId: invitation.id, userId: admin.id, userEmail: "grace@example.com" });
    liveUpdateHub.subscribe({ workspaceId: workspace.workspace_id, socket: { send: (message) => messages.push(message) } });

    const demote = (cookie: string, targetUserId: string) =>
      application(
        new Request(`${origin}/v1/workspaces/${workspace.workspace_id}/users/${targetUserId}`, {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify({ action: "make_member" }),
        }),
      );

    const refused = await demote(admin.cookie, owner.id);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(messages).toEqual([]);

    const response = await demote(owner.cookie, admin.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      workspace_id: workspace.workspace_id,
      user_id: admin.id,
      action: "make_member",
      role: "member",
    });
    expect(messages.map((message) => JSON.parse(message))).toEqual([
      {
        version: 1,
        events: [
          {
            type: "workspace_context_invalidated",
            reason: "workspace_membership_changed",
            occurred_at: expect.any(String),
          },
        ],
      },
    ]);
    expect(messages[0]).not.toContain("grace@example.com");
    expect(messages[0]).not.toContain(admin.id);
  } finally {
    liveUpdateHub.closeAll();
    database.close();
  }
});

async function signUp(application: ReturnType<typeof createLocalApplication>, email: string, peerAddress: string) {
  const request = new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ name: email, email, password: "Strong1!" }),
  });

  setLocalAuthRequestPeerAddress(request, peerAddress);
  const response = await application(request);
  expect(response.status).toBe(200);
  const { user } = await readUserResponse(response);

  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

  return { id: user.id, cookie };
}

async function createUser(auth: Awaited<ReturnType<typeof createLocalAuth>>, name: string, email: string) {
  const response = await auth.handler(
    new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: "Strong1!" }),
    }),
  );

  const body = await readUserResponse(response);

  return body.user;
}
