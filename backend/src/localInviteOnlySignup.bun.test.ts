import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalAccountAccess } from "./localAccountAccess";
import { createLocalAuth } from "./localAuth";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { readUserResponse } from "./testing/responseFixture";

const origin = "http://127.0.0.1:8787";

const secret = "01234567890123456789012345678901";

function request(path: string, body?: Record<string, string>, cookie = "") {
  const init: RequestInit = {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", origin, cookie },
  };

  if (body) init.body = JSON.stringify(body);

  return new Request(`${origin}${path}`, init);
}

const cookies = (response: Response) => response.headers.getSetCookie().filter((value) => !value.includes("Max-Age=0")).map((value) => value.split(";")[0]).join("; ");

async function fixture(signupEnabled = false, requireEmailVerification = false, database = new Database(":memory:")) {
  const adminEmails = [" ADMIN@example.org "];
  const links: string[] = [];

  const auth = await createLocalAuth({
    database, baseURL: origin, secret, adminEmails, signupEnabled, requireEmailVerification,
    mailSink: {
      capture: async (mail) => {
        const link = mail.text.match(/https?:\/\/\S+/)?.[0];

        if (link) links.push(link);
      },
    },
  });

  const control = createLocalWorkspaceControl(database, { signupEnabled, adminEmails });
  const application = createLocalApplication({ auth, workspaceControl: control });
  const signup = (email: string) => auth.handler(request("/api/auth/sign-up/email", { email, name: "Test", password: "Strong1!" }));
  const signin = (email: string) => auth.handler(request("/api/auth/sign-in/email", { email, password: "Strong1!" }));
  const adminResponse = await signup("admin@example.org");
  const admin = (await readUserResponse(adminResponse)).user;
  const workspace = control.listAcceptedWorkspaces({ userId: admin.id })[0]!;

  return { database, auth, control, application, signup, signin, admin, workspace, adminCookie: cookies(adminResponse), links };
}

test("invite-only admits admins and invited emails, auto-accepts all invitations once, and never creates an invitee workspace", async () => {
  const f = await fixture();

  try {
    const denied = await f.signup("stranger@example.org");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "INVITATION_REQUIRED" });
    const second = f.control.createWorkspace({ userId: f.admin.id });

    for (const workspaceId of [f.workspace.id, second.workspace_id]) {
      f.control.createInvitation({ workspaceId, inviterUserId: f.admin.id, email: " INVITED@example.org " });
    }

    const admitted = await f.signup("invited@example.org");
    expect(admitted.status).toBe(200);
    const user = (await readUserResponse(admitted)).user;
    const cookie = cookies(admitted);
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.application(request("/v1/workspaces", undefined, cookie))));

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ can_create_workspaces: false, workspaces: expect.arrayContaining([
        expect.objectContaining({ id: f.workspace.id, role: "member" }), expect.objectContaining({ id: second.workspace_id }),
      ]) });
    }

    expect(f.database.query("SELECT count(*) AS n FROM workspaces").get()).toEqual({ n: 2 });
    expect(f.database.query("SELECT count(*) AS n FROM workspace_memberships WHERE user_id = ?").get(user.id)).toEqual({ n: 2 });
    const restricted = await f.application(request("/v1/workspaces", { name: "Forbidden" }, cookie));
    expect(restricted.status).toBe(403);
    expect(await restricted.json()).toMatchObject({ error: { code: "workspace_creation_restricted" } });
    f.control.leaveWorkspace({ workspaceId: second.workspace_id, userId: user.id });
    const last = await f.application(request(`/v1/workspaces/${f.workspace.id}/leave`, {}, cookie));
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: { code: "last_workspace" } });
    expect(f.control.listAcceptedWorkspaces({ userId: user.id })).toHaveLength(1);
    expect((await f.application(request("/v1/workspaces", undefined, f.adminCookie))).status).toBe(200);
    expect(f.control.canCreateWorkspaces(f.admin.id)).toBe(true);
  } finally {
    f.database.close();
  }
});

test("live access is revoked after the last membership disappears and a fresh invitation restores sign-in", async () => {
  const f = await fixture();

  try {
    f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: "member@example.org" });
    const response = await f.signup("member@example.org");
    const user = (await readUserResponse(response)).user;
    const cookie = cookies(response);
    f.control.listAcceptedWorkspaces({ userId: user.id });
    const sessionRequest = request("/v1/workspaces", undefined, cookie);
    const session = await f.auth.getSession(sessionRequest);
    expect(session?.isActive?.()).toBe(true);
    f.database.query("DELETE FROM workspace_memberships WHERE user_id = ?").run(user.id);
    expect(session?.isActive?.()).toBe(false);
    expect(await f.auth.getSession(sessionRequest)).toBeNull();
    const denied = await f.signin(user.email);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "ACCESS_REQUIRED" });
    const signedOut = await f.auth.handler(request("/api/auth/get-session", undefined, cookie));
    expect(signedOut.status).toBe(200);
    expect(await signedOut.json()).toBeNull();
    const deniedWithCookie = await f.auth.handler(request("/api/auth/sign-in/email", { email: user.email, password: "Strong1!" }, cookie));
    expect(deniedWithCookie.status).toBe(403);
    expect(await deniedWithCookie.json()).toMatchObject({ code: "ACCESS_REQUIRED" });
    f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: user.email });
    expect((await f.signin(user.email)).status).toBe(200);
  } finally {
    f.database.close();
  }
});

test("expired and cancelled invitations grant neither registration nor session access", async () => {
  const f = await fixture();

  try {
    for (const status of ["expired", "cancelled"]) {
      const email = `${status}@example.org`;
      const invitation = f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email });

      if (status === "expired") f.database.query("UPDATE workspace_invitations SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", invitation.id);
      else f.control.cancelInvitation({ workspaceId: f.workspace.id, invitationId: invitation.id, userId: f.admin.id });
      expect((await f.signup(email)).status).toBe(403);
    }
  } finally {
    f.database.close();
  }
});

test("listed existing accounts qualify without role promotion; role admins qualify without being listed", async () => {
  const f = await fixture();

  try {
    f.database.query("UPDATE user SET role = 'user' WHERE id = ?").run(f.admin.id);
    f.database.query("DELETE FROM workspace_memberships WHERE user_id = ?").run(f.admin.id);
    expect((await f.signin(f.admin.email)).status).toBe(200);
    expect(f.control.canCreateWorkspaces(f.admin.id)).toBe(true);
    expect(f.database.query("SELECT role FROM user WHERE id = ?").get(f.admin.id)).toEqual({ role: "user" });
    f.database.query("UPDATE user SET email = 'role-admin@example.org', role = 'admin' WHERE id = ?").run(f.admin.id);
    expect((await f.signin("role-admin@example.org")).status).toBe(200);
    expect(f.control.canCreateWorkspaces(f.admin.id)).toBe(true);
  } finally {
    f.database.close();
  }
});

test("impersonation sessions remain available for accounts without workspace access", async () => {
  const f = await fixture();

  try {
    f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: "target@example.org" });
    const target = (await readUserResponse(await f.signup("target@example.org"))).user;
    f.database.query("UPDATE workspace_invitations SET status = 'cancelled' WHERE email = ?").run(target.email);
    const impersonation = await f.auth.handler(request("/api/auth/admin/impersonate-user", { userId: target.id }, f.adminCookie));
    expect(impersonation.status).toBe(200);
    const session = await f.auth.getSession(request("/", undefined, cookies(impersonation)));
    expect(session?.impersonatedBy).toBe(f.admin.id);
    expect(session?.isActive?.()).toBe(true);
    expect((await f.auth.handler(request("/api/auth/admin/stop-impersonating", {}, cookies(impersonation)))).status).toBe(200);
  } finally {
    f.database.close();
  }
});

test("verification-enabled sign-up still returns invitation errors and verification cannot create a disqualified session", async () => {
  const f = await fixture(false, true);

  try {
    const denied = await f.signup("uninvited@example.org");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "INVITATION_REQUIRED" });
    f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: "verify@example.org" });
    const admitted = await f.signup("verify@example.org");
    expect(admitted.status).toBe(200);
    f.database.query("UPDATE workspace_invitations SET status = 'cancelled' WHERE email = 'verify@example.org'").run();
    const link = f.links.at(-1)!;
    const verification = await f.auth.handler(new Request(link));
    expect(verification.status).toBe(403);
    expect(await verification.json()).toMatchObject({ code: "ACCESS_REQUIRED" });
  } finally {
    f.database.close();
  }
});

test("open mode preserves unrestricted sessions, personal workspaces, workspace creation and replacement on leave", async () => {
  const f = await fixture(true);

  try {
    const response = await f.signup("open@example.org");
    const user = (await readUserResponse(response)).user;
    expect(response.status).toBe(200);
    expect(f.control.canCreateWorkspaces(user.id)).toBe(true);
    expect(await f.auth.getSession(request("/", undefined, cookies(response)))).not.toBeNull();
    const personal = f.control.listAcceptedWorkspaces({ userId: user.id });
    expect(personal).toHaveLength(1);
    f.database.query("DELETE FROM workspace_memberships WHERE user_id = ?").run(user.id);
    const invitation = f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: user.email });
    f.control.acceptInvitation({ invitationId: invitation.id, userId: user.id, userEmail: user.email });
    const result = f.control.leaveWorkspace({ workspaceId: f.workspace.id, userId: user.id });
    expect(result.replacement_workspace).toBeDefined();
    expect(f.control.createWorkspace({ userId: user.id }).role).toBe("owner");
  } finally {
    f.database.close();
  }
});

test("accounts with membership keep pending invitations for explicit acceptance and API keys survive account lockout", async () => {
  const f = await fixture();

  try {
    f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: "member@example.org" });
    const user = (await readUserResponse(await f.signup("member@example.org"))).user;
    f.control.listAcceptedWorkspaces({ userId: user.id });
    const second = f.control.createWorkspace({ userId: f.admin.id });
    f.control.createInvitation({ workspaceId: second.workspace_id, inviterUserId: f.admin.id, email: user.email });
    expect(f.control.listAcceptedWorkspaces({ userId: user.id })).toHaveLength(1);
    expect(f.control.listPendingInvitations({ email: user.email })).toHaveLength(1);
    const key = f.control.rotateApiKey({ workspaceId: f.workspace.id, userId: f.admin.id });
    f.database.query("DELETE FROM workspace_memberships WHERE user_id = ?").run(user.id);
    f.database.query("UPDATE workspace_invitations SET status = 'cancelled' WHERE email = ?").run(user.email);
    expect((await f.signin(user.email)).status).toBe(403);
    expect(f.control.authorizeApiKey({ apiKey: key.api_key })?.id).toBe(f.workspace.id);
  } finally {
    f.database.close();
  }
});

test("admin plugin cannot create accounts and installation admins retain last-leave replacement", async () => {
  const f = await fixture();

  try {
    const blocked = await f.auth.handler(request("/api/auth/admin/create-user", { email: "uninvited@example.org", name: "Uninvited", password: "Strong1!" }, f.adminCookie));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: "YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS" });
    f.database.query("UPDATE workspace_memberships SET role = 'member' WHERE user_id = ?").run(f.admin.id);
    const left = f.control.leaveWorkspace({ workspaceId: f.workspace.id, userId: f.admin.id });
    expect(left.replacement_workspace).toBeDefined();
    const created = await f.application(request("/v1/workspaces", { name: "Admin workspace" }, f.adminCookie));
    expect(created.status).toBe(201);
    const list = await f.application(request("/v1/workspaces", undefined, f.adminCookie));
    expect(await list.json()).toMatchObject({ can_create_workspaces: true });
  } finally {
    f.database.close();
  }
});

test("password reset revokes sessions without restoring installation access", async () => {
  const f = await fixture();

  try {
    f.control.createInvitation({ workspaceId: f.workspace.id, inviterUserId: f.admin.id, email: "reset@example.org" });
    const response = await f.signup("reset@example.org");
    const user = (await readUserResponse(response)).user;
    const cookie = cookies(response);
    f.control.listAcceptedWorkspaces({ userId: user.id });
    f.database.query("DELETE FROM workspace_memberships WHERE user_id = ?").run(user.id);
    const requested = await f.auth.handler(request("/api/auth/request-password-reset", { email: user.email, redirectTo: "/reset-password" }, cookie));
    expect(requested.status).toBe(200);
    const token = new URL(f.links.at(-1)!).pathname.split("/").at(-1)!;
    const reset = await f.auth.handler(request("/api/auth/reset-password", { token, newPassword: "Updated1!" }, cookie));
    expect(reset.status).toBe(200);
    expect(f.database.query("SELECT count(*) AS n FROM session WHERE userId = ?").get(user.id)).toEqual({ n: 0 });
    const signin = await f.auth.handler(request("/api/auth/sign-in/email", { email: user.email, password: "Updated1!" }));
    expect(signin.status).toBe(403);
    expect(await signin.json()).toMatchObject({ code: "ACCESS_REQUIRED" });
  } finally {
    f.database.close();
  }
});

test("open-mode access checks need no account or workspace queries", () => {
  const database = new Database(":memory:");

  try {
    const access = createLocalAccountAccess(database);

    expect(access.canRegister("anyone@example.org")).toBe(true);
    expect(access.canCreateWorkspaces("unknown-user")).toBe(true);
    expect(access.qualifies("unknown-user")).toBe(true);
  } finally {
    database.close();
  }
});

test("open-mode users and invite-only admins can list existing workspaces during another writer's reservation", async () => {
  for (const signupEnabled of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), "workspace-list-lock-"));
    const databasePath = join(directory, "control.sqlite");
    const database = new Database(databasePath);
    let writer: Database | undefined;

    try {
      const f = await fixture(signupEnabled, false, database);

      const user = signupEnabled
        ? (await readUserResponse(await f.signup("reader@example.org"))).user
        : f.admin;

      const expected = f.control.listAcceptedWorkspaces({ userId: user.id });

      writer = new Database(databasePath);
      writer.exec("BEGIN IMMEDIATE");

      expect(f.control.listAcceptedWorkspaces({ userId: user.id })).toEqual(expected);
    } finally {
      writer?.close();
      database.close();

      rmSync(directory, { recursive: true, force: true });
    }
  }
});
