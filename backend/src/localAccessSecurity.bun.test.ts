import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocalAuth } from "./localAuth";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";
import { createLocalLiveUpdateHub, type LocalLiveUpdateSocket } from "./localLiveUpdateHub";

const origin = "http://127.0.0.1:8787";
async function fixture() {
  const database = new Database(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const auth = await createLocalAuth({
    database, baseURL: origin, requireEmailVerification: false,
    adminEmails: ["admin@example.org"], trustedOrigins: ["https://trusted.example.org"],
    secret: "01234567890123456789012345678901", mailSink: { capture: async () => {} },
  });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl: control });
  async function account(email: string) {
    const response = await application(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: email, email, password: "Strong1!" }),
    }));
    expect(response.status).toBe(200);
    const { user } = await response.json() as { user: { id: string } };
    const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    return { id: user.id, cookie };
  }
  return { database, auth, control, application, account };
}

test("Application admins cannot bypass supported account capabilities through alternate endpoints", async () => {
  const f = await fixture();
  try {
    const admin = await f.account("admin@example.org");
    const owner = await f.account("owner@example.org");
    const workspace = f.control.createWorkspace({ userId: owner.id, name: "Retained" });
    for (const [path, body] of [
      ["remove-user", { userId: owner.id }],
      ["update-user", { userId: admin.id, data: { role: "user" } }],
      ["set-user-password", { userId: owner.id, newPassword: "Changed1!" }],
      ["create-user", { name: "Unexpected", email: "new@example.org", password: "Strong1!" }],
      ["revoke-user-sessions", { userId: owner.id }],
    ] as const) {
      const response = await f.application(new Request(`${origin}/api/auth/admin/${path}`, {
        method: "POST", headers: { cookie: admin.cookie, origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(403);
    }
    expect(f.control.getAcceptedWorkspaceContext({ workspaceId: workspace.workspace_id, userId: owner.id })).not.toBeNull();
    expect(f.database.query("SELECT role FROM user WHERE id = ?").get(admin.id)).toEqual({ role: "admin" });
    expect(f.database.query("SELECT count(*) AS count FROM user").get()).toEqual({ count: 2 });
  } finally { f.database.close(); }
});

test("password changes enforce the same complexity policy and preserve credentials on rejection", async () => {
  const f = await fixture();
  try {
    const owner = await f.account("owner@example.org");
    for (const [newPassword, status] of [["password", 400], ["Updated1!", 200]] as const) {
      const response = await f.application(new Request(`${origin}/api/auth/change-password`, {
        method: "POST", headers: { cookie: owner.cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "Strong1!", newPassword }),
      }));
      expect(response.status).toBe(status);
    }
    const login = await f.auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.org", password: "Updated1!" }),
    }));
    expect(login.status).toBe(200);
  } finally { f.database.close(); }
});

test("Workspace cookie mutations reject foreign and opaque browser origins before side effects", async () => {
  const f = await fixture();
  try {
    const owner = await f.account("owner@example.org");
    const workspace = f.control.createWorkspace({ userId: owner.id, name: "Protected" });
    const url = `${origin}/v1/workspaces/${workspace.workspace_id}/api-key`;
    for (const headers of [
      { origin: "http://127.0.0.1:6666", "sec-fetch-site": "same-site" },
      { origin: "null", "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ] as Array<Record<string, string>>) {
      const response = await f.application(new Request(url, {
        method: "POST", headers: { ...headers, cookie: owner.cookie, "content-type": "text/plain" }, body: "{}",
      }));
      expect(response.status).toBe(403);
      expect(f.control.getAcceptedWorkspaceContext({ workspaceId: workspace.workspace_id, userId: owner.id })?.has_api_key).toBe(false);
    }
    for (const trustedOrigin of [origin, "https://trusted.example.org", "http://localhost:5173"]) {
      const response = await f.application(new Request(url, { method: "POST", headers: { cookie: owner.cookie, origin: trustedOrigin } }));
      expect(response.status).toBe(200);
    }
  } finally { f.database.close(); }
});

test("live subscribers lose delivery after membership removal, logout, expiry, or a ban", async () => {
  const f = await fixture();
  try {
    const admin = await f.account("admin@example.org");
    for (const reason of ["membership", "logout", "expiry", "ban"]) {
      const member = await f.account(`${reason}@example.org`);
      const workspace = f.control.createWorkspace({ userId: admin.id, name: reason });
      const invite = f.control.createInvitation({ workspaceId: workspace.workspace_id, inviterUserId: admin.id, email: `${reason}@example.org` });
      f.control.acceptInvitation({ invitationId: invite.id, userId: member.id, userEmail: `${reason}@example.org` });
      const hub = createLocalLiveUpdateHub();
      const messages: string[] = [];
      const closes: number[] = [];
      const socket = {
        data: {}, send: (message: string) => messages.push(message), close: (code?: number) => closes.push(code!),
      } as LocalLiveUpdateSocket & { data: object };
      await upgradeLocalLiveUpdate({ auth: f.auth, workspaceControl: f.control,
        request: new Request(`${origin}/v1/workspaces/${workspace.workspace_id}/live`, { headers: { cookie: member.cookie, upgrade: "websocket", origin } }),
        server: { upgrade: (_request, { data }) => { socket.data = data; return true; } },
      });
      hub.subscribe({ workspaceId: workspace.workspace_id, socket });
      const event = { workspaceId: workspace.workspace_id, reason: "workspace_access" as const, occurredAt: new Date().toISOString() };
      hub.broadcastWorkspaceContextInvalidation(event);
      expect(messages).toHaveLength(1);
      if (reason === "membership") {
        f.database.query("DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?").run(workspace.workspace_id, member.id);
      } else if (reason === "expiry") {
        f.database.query("UPDATE session SET expiresAt = 0 WHERE userId = ?").run(member.id);
      } else {
        const path = reason === "logout" ? "/api/auth/sign-out" : "/api/auth/admin/ban-user";
        const response = await f.auth.handler(new Request(`${origin}${path}`, {
          method: "POST", headers: { origin, cookie: reason === "logout" ? member.cookie : admin.cookie, "content-type": "application/json" },
          body: JSON.stringify({ userId: member.id, banReason: "Revocation test" }),
        }));
        expect(response.status).toBe(200);
      }
      hub.broadcastWorkspaceContextInvalidation(event);
      expect(messages).toHaveLength(1);
      expect(closes).toEqual([1008]);
      expect(hub.diagnostics().connections.open).toBe(0);
      hub.closeAll();
    }
  } finally { f.database.close(); }
});

test("an expired invitation can be replaced while a live invitation still blocks duplicates", async () => {
  const f = await fixture();
  try {
    const owner = await f.account("owner@example.org");
    const workspace = f.control.createWorkspace({ userId: owner.id, name: "Invitations" });
    const input = { workspaceId: workspace.workspace_id, inviterUserId: owner.id, email: "invitee@example.org" };
    const old = f.control.createInvitation(input);
    expect(() => f.control.createInvitation(input)).toThrow("pending invitation");
    f.database.query("UPDATE workspace_invitations SET expires_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", old.id);
    expect(f.control.listPendingInvitations({ email: input.email })).toEqual([]);
    const replacement = f.control.createInvitation(input);
    expect(replacement.id).not.toBe(old.id);
    expect(f.control.listPendingInvitations({ email: input.email }).map((invite) => invite.id)).toEqual([replacement.id]);
    expect(() => f.control.createInvitation(input)).toThrow("pending invitation");
  } finally { f.database.close(); }
});
