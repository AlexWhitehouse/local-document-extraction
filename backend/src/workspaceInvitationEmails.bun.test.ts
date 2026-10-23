import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalAuth } from "./localAuth";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalMailSink, type LocalMailMessage, type LocalMailSink } from "./localMailSink";
import { createCloudflareMailSink } from "./cloudflareMailSink";
import { createWorkspaceInvitationEmails, InvitationEmailRateLimitError } from "./workspaceInvitationEmails";
import { readUserResponse } from "./testing/responseFixture";
import { renderWorkspaceInvitationEmail } from "./lib/email/accountEmails";
import { createLocalProductAnalytics } from "./localProductAnalytics";

const origin = "http://localhost:8787";

async function fixture(mailSink?: LocalMailSink, provider: "local" | "cloudflare" = "local") {
  const database = new Database(":memory:");
  const messages: LocalMailMessage[] = [];
  const sink = mailSink ?? { capture: async (message: LocalMailMessage) => { messages.push(message); } };
  const auth = await createLocalAuth({ database, baseURL: origin, mailSink: sink, requireEmailVerification: false, secret: "01234567890123456789012345678901" });

  const signup = await auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Owner", email: "owner@example.com", password: "Strong1!" }),
  }));

  const owner = await readUserResponse(signup);
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const control = createLocalWorkspaceControl(database, { baseURL: origin });
  const workspace = control.listAcceptedWorkspaces({ userId: owner.user.id })[0]!;
  const emails = createWorkspaceInvitationEmails({ database, control, mailSink: sink, provider, from: { email: "no-reply@example.com", name: "Document Extraction" } });
  const app = createLocalApplication({ auth, workspaceControl: control, invitationEmails: emails });
  const value = { workspaceId: workspace.id, inviterUserId: owner.user.id, email: "new@example.com" };
  const resend = (invitationId: string) => emails.resend({ workspaceId: workspace.id, invitationId, userId: owner.user.id });
  const requestRaw = (path: string, body: string) => app(new Request(`${origin}/v1/workspaces/${workspace.id}/invitations${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body }));
  const request = (path: string, body: { email?: string; action?: string }) => requestRaw(path, JSON.stringify(body));

  return { auth, database, control, emails, messages, value, resend, request, requestRaw };
}

test("create captures invitation mail with the emailed action URL and an inviter-safe link", async () => {
  const directory = await mkdtemp(join(tmpdir(), "invitation-mail-"));
  const app = await fixture(createLocalMailSink({ directory, logger: { info() {} } }));

  try {
    const response = await app.request("", { email: app.value.email });
    expect(response.status).toBe(201);
    const invitation = await response.json();
    expect(invitation.email_delivery.status).toBe("captured");
    expect(new URL(invitation.invite_url).searchParams.has("auth")).toBe(false);
    const record = JSON.parse((await readFile(join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8")).trim());
    expect(record.type).toBe("workspace_invitation");
    expect(record.action_url).toBe(`${invitation.invite_url}&auth=signup`);
    expect(invitation.email_last_sent_at).toBeString();
    expect(invitation.email_resends_remaining).toBe(3);
  } finally {
    app.database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Cloudflare failure retains the invitation and reports failed", async () => {
  const sink = createCloudflareMailSink({ accountId: "a".repeat(32), apiToken: "test-token", fetcher: async () => new Response(null, { status: 503 }) });
  const app = await fixture(sink, "cloudflare");

  try {
    const response = await app.request("", { email: app.value.email });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ email_delivery: { status: "failed" }, email_last_sent_at: null });
    expect(app.control.listWorkspaceInvitations({ workspaceId: app.value.workspaceId, userId: app.value.inviterUserId })).toHaveLength(1);
  } finally { app.database.close(); }
});

test("Workspace cap skips create mail and returns 429 on resend without refreshing expiry", async () => {
  const app = await fixture();

  try {
    for (let index = 0; index < 20; index++) await app.emails.create({ ...app.value, email: `person${index}@example.com` });
    const invitation = await app.emails.create(app.value);
    expect(invitation.email_delivery.status).toBe("rate_limited");
    expect(app.messages).toHaveLength(20);
    const response = await app.request(`/${invitation.id}`, { action: "resend" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeString();
    expect(await response.json()).toMatchObject({ error: { code: "invitation_email_rate_limited", retry_after_seconds: expect.any(Number) } });
    expect(app.database.query<{ expires_at: string }, [string]>("SELECT expires_at FROM workspace_invitations WHERE id = ?").get(invitation.id)?.expires_at).toBe(invitation.expires_at);
    expect(app.database.query<{ count: number }, []>("SELECT count(*) AS count FROM workspace_invitation_email_attempts").get()?.count).toBe(22);
  } finally { app.database.close(); }
});

test("resends enforce cooldown and maximum, include expired pending invitations, and refresh expiry", async () => {
  const app = await fixture();

  try {
    const invitation = await app.emails.create(app.value);
    await expect(app.resend(invitation.id)).rejects.toBeInstanceOf(InvitationEmailRateLimitError);
    app.database.query("UPDATE workspace_invitations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(invitation.id);
    expect(app.control.listWorkspaceInvitations({ workspaceId: app.value.workspaceId, userId: app.value.inviterUserId })[0]?.expired).toBe(true);

    for (let index = 0; index < 3; index++) {
      app.database.query("UPDATE workspace_invitation_email_attempts SET attempted_at = ?").run(new Date(Date.now() - 11 * 60000).toISOString());
      const resent = await app.resend(invitation.id);
      expect(Date.parse(resent.expires_at)).toBeGreaterThan(Date.now() + 6.99 * 86400000);
      expect(resent.expired).toBe(false);
      expect(resent.email_resends_remaining).toBe(2 - index);
    }

    const response = await app.request(`/${invitation.id}`, { action: "resend" });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { retry_after_seconds: null } });
    expect(app.messages).toHaveLength(4);
  } finally { app.database.close(); }
});

test("replacement cancels expired pending invitations and unknown resend actions are rejected", async () => {
  const app = await fixture();

  try {
    const previous = await app.emails.create(app.value);
    app.database.query("UPDATE workspace_invitations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(previous.id);
    const replacement = await app.emails.create(app.value);
    expect(replacement.id).not.toBe(previous.id);
    expect(app.database.query<{ status: string }, [string]>("SELECT status FROM workspace_invitations WHERE id = ?").get(previous.id)?.status).toBe("cancelled");
    expect((await app.request(`/${previous.id}`, { action: "resend" })).status).toBe(404);
    expect((await app.request(`/${replacement.id}`, { action: "unknown" })).status).toBe(400);
    await expect(app.emails.create(app.value)).rejects.toMatchObject({ code: "invite_exists" });
  } finally { app.database.close(); }
});

test("existing accounts get sign-in links, templates escape hostile content and keep a fixed subject", async () => {
  const app = await fixture();

  try {
    await app.auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Existing", email: "existing@example.com", password: "Strong1!" }),
    }));
    const invitation = await app.emails.create({ ...app.value, email: "existing@example.com" });
    expect(app.messages[0]?.text).toContain(`${invitation.invite_url}&auth=signin`);
    expect(app.messages[0]?.text).toContain("Sign in and accept");
    const content = renderWorkspaceInvitationEmail({ workspaceName: '<img src="https://evil.example">', inviterName: "A".repeat(100), inviterEmail: "owner@example.com", email: "new@example.com", role: "admin", expiresAt: "2030-01-02T03:04:00.000Z", url: `${origin}/invitations/example?email=new%40example.com&auth=signup`, existingAccount: false });
    expect(content.subject).toBe("You've been invited to a Workspace on Document Extraction");
    expect(content.html).toContain("&lt;img src=&quot;https://evil.example&quot;&gt;");
    expect(content.html).not.toContain('<img src="https://evil.example">');
    expect(content.text.match(/https?:\/\/\S+/)?.[0]).toContain("/invitations/example?");
    expect(content.text).toContain("2 January 2030 at 03:04 UTC");
    expect(content.text).toContain("A".repeat(80) + "…");
    expect(content.text).toContain("Create an account with this address");
  } finally { app.database.close(); }
});

test("invitation analytics serializes only approved fields", async () => {
  const app = await fixture();
  const lines: string[] = [];
  const analytics = createLocalProductAnalytics({ stateDirectory: "/unused", append: async (_path, text) => { lines.push(text); } });
  app.emails.setAnalytics(analytics);

  try {
    await app.emails.create(app.value);
    await analytics.flush();
    expect(JSON.parse(lines.join("").trim())).toMatchObject({ type: "workspace_invitation_email_sent", workspace_id: app.value.workspaceId, trigger: "create", provider: "local" });
    expect(lines.join("")).not.toContain("@example.com");
    expect(lines.join("")).not.toContain("Owner");
  } finally { app.database.close(); }
});

test("existing control databases gain the attempts table on repeated initialization", async () => {
  const app = await fixture();

  try {
    const invitation = app.control.createInvitation(app.value);
    app.database.exec("DROP TABLE workspace_invitation_email_attempts");
    createLocalWorkspaceControl(app.database, { baseURL: origin });
    const upgraded = createLocalWorkspaceControl(app.database, { baseURL: origin });
    expect(upgraded.listWorkspaceInvitations({ workspaceId: app.value.workspaceId, userId: app.value.inviterUserId })[0]).toMatchObject({ id: invitation.id, email_last_sent_at: null, email_resends_remaining: 3 });
    expect(upgraded.invitationEmailAttempts(invitation.id, app.value.workspaceId, app.value.inviterUserId)).toEqual([]);
  } finally { app.database.close(); }
});

test("an expired invitation cannot be resent alongside a newer active invitation", async () => {
  const app = await fixture();

  try {
    const previous = await app.emails.create(app.value);
    app.database.query("UPDATE workspace_invitations SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(previous.id);
    await app.emails.create(app.value);
    // Older databases can contain both pending rows from before replacement cancelled expired rows.
    app.database.query("UPDATE workspace_invitations SET status = 'pending' WHERE id = ?").run(previous.id);
    app.database.exec("UPDATE workspace_invitation_email_attempts SET attempted_at = '2000-01-01T00:00:00.000Z'");
    expect((await app.request(`/${previous.id}`, { action: "resend" })).status).toBe(409);
    expect(app.messages).toHaveLength(2);
  } finally { app.database.close(); }
});

test("actor quota spans Workspaces and expires after 24 hours", async () => {
  const app = await fixture();

  try {
    for (let workspaceIndex = 0; workspaceIndex < 3; workspaceIndex++) {
      const workspace = app.control.createWorkspace({ userId: app.value.inviterUserId });
      const count = workspaceIndex === 2 ? 10 : 20;

      for (let index = 0; index < count; index++) {
        const invitation = await app.emails.create({ ...app.value, workspaceId: workspace.workspace_id, email: `person${index}@example.com` });
        expect(invitation.email_delivery.status).toBe("captured");
      }
    }

    const invitation = await app.emails.create(app.value);
    expect(invitation.email_delivery.status).toBe("rate_limited");
    expect(app.messages).toHaveLength(50);
    const response = await app.request(`/${invitation.id}`, { action: "resend" });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { retry_after_seconds: expect.any(Number) } });
    expect(response.headers.get("Retry-After")).toBeString();
    expect(app.control.invitationEmailAttempts(invitation.id, app.value.workspaceId, app.value.inviterUserId).every((attempt) => attempt.actor_user_id === app.value.inviterUserId)).toBe(true);
    app.database.exec("UPDATE workspace_invitation_email_attempts SET attempted_at = '2000-01-01T00:00:00.000Z'");
    expect((await app.resend(invitation.id)).email_delivery.status).toBe("captured");
  } finally { app.database.close(); }
});

test("attempt lookup retains invitation history but bounds Workspace and actor history", async () => {
  const app = await fixture();

  try {
    const own = await app.emails.create(app.value);
    const other = await app.emails.create({ ...app.value, email: "other@example.com" });
    app.database.exec("UPDATE workspace_invitation_email_attempts SET attempted_at = '2000-01-01T00:00:00.000Z'");
    const attempts = app.control.invitationEmailAttempts(own.id, app.value.workspaceId, app.value.inviterUserId);
    expect(attempts.map((attempt) => attempt.invitation_id)).toEqual([own.id]);
    expect(attempts.some((attempt) => attempt.invitation_id === other.id)).toBe(false);
  } finally { app.database.close(); }
});

test("resend rejects malformed and unreadable JSON bodies as invalid actions", async () => {
  const app = await fixture();

  try {
    const invitation = await app.emails.create(app.value);

    for (const [body, status] of [["{", 400], [JSON.stringify({ action: "resend" }).repeat(100000), 413]] as const) {
      const response = await app.requestRaw(`/${invitation.id}`, body);
      expect(response.status).toBe(status);
    }
  } finally { app.database.close(); }
});

test("deleting Workspaces and their invitations preserves the actor email cap", async () => {
  const app = await fixture();

  try {
    for (const count of [20, 20, 10]) {
      const workspace = app.control.createWorkspace({ userId: app.value.inviterUserId });

      for (let index = 0; index < count; index++) {
        expect((await app.emails.create({ ...app.value, workspaceId: workspace.workspace_id, email: `person${index}@example.com` })).email_delivery.status).toBe("captured");
      }

      app.control.deleteWorkspace({ workspaceId: workspace.workspace_id, userId: app.value.inviterUserId });
      expect(app.database.query("SELECT 1 FROM workspace_invitations WHERE workspace_id = ?").get(workspace.workspace_id)).toBeNull();
    }

    const workspace = app.control.createWorkspace({ userId: app.value.inviterUserId });
    const invitation = await app.emails.create({ ...app.value, workspaceId: workspace.workspace_id });
    expect(invitation.email_delivery.status).toBe("rate_limited");
    expect(invitation.email_last_sent_at).toBeNull();
    expect(app.control.listWorkspaceInvitations({ workspaceId: workspace.workspace_id, userId: app.value.inviterUserId })).toHaveLength(1);
    expect(app.messages).toHaveLength(50);
    expect(app.database.query<{ count: number }, []>("SELECT count(*) AS count FROM workspace_invitation_email_attempts").get()?.count).toBe(51);
  } finally { app.database.close(); }
});

test("recording attempts prunes history older than seven days in bounded batches", async () => {
  const app = await fixture();

  try {
    const invitation = await app.emails.create(app.value);
    const old = new Date(Date.now() - 8 * 86400000).toISOString();

    app.database.query("UPDATE workspace_invitation_email_attempts SET attempted_at = ?").run(old);
    app.database.exec(`INSERT INTO workspace_invitation_email_attempts SELECT 'old_' || value, workspace_id, invitation_id, actor_user_id, trigger, outcome, attempted_at FROM workspace_invitation_email_attempts, json_each('[${Array.from({ length: 500 }, (_, index) => index).join(",")}]')`);
    const attempt = { id: "recent", workspace_id: app.value.workspaceId, invitation_id: invitation.id, actor_user_id: app.value.inviterUserId, trigger: "create", outcome: "captured", attempted_at: new Date().toISOString() } as const;
    app.control.recordInvitationEmailAttempt(attempt);
    expect(app.database.query<{ count: number }, [string]>("SELECT count(*) AS count FROM workspace_invitation_email_attempts WHERE attempted_at = ?").get(old)?.count).toBe(1);
    app.control.recordInvitationEmailAttempt(attempt);
    expect(app.database.query<{ count: number }, []>("SELECT count(*) AS count FROM workspace_invitation_email_attempts").get()?.count).toBe(1);
    expect(app.control.listWorkspaceInvitations({ workspaceId: app.value.workspaceId, userId: app.value.inviterUserId })[0]?.email_last_sent_at).toBe(attempt.attempted_at);
  } finally { app.database.close(); }
});
