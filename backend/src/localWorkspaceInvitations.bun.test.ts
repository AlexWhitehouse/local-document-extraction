import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";

test("owners create in-app Workspace invitations that invitees can list without mail delivery", async () => {
  const database = new Database(":memory:");
  const mailMessages: Array<{ to: string; text: string }> = [];
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async (message) => { mailMessages.push({ to: message.to, text: message.text }); } },
    secret: "01234567890123456789012345678901",
  });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl: control });

  try {
    const owner = await createVerifiedSession(auth, mailMessages, "Ada", "ada@example.com");
    const invitee = await createVerifiedSession(auth, mailMessages, "Grace", "grace@example.com");
    const ownerWorkspace = control.listAcceptedWorkspaces({ userId: owner.id, userName: owner.name })[0]!;
    const messagesBeforeInvite = mailMessages.length;

    const created = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${ownerWorkspace.id}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ email: "grace@example.com", role: "member" }),
    }));
    expect(created.status).toBe(201);

    const listed = await application(new Request("http://127.0.0.1:8787/v1/invitations", {
      headers: { cookie: invitee.cookie },
    }));
    await expect(listed.json()).resolves.toMatchObject({
      invitations: [expect.objectContaining({ workspace_id: ownerWorkspace.id, email: "grace@example.com", status: "pending" })],
    });
    expect(mailMessages).toHaveLength(messagesBeforeInvite);
  } finally {
    database.close();
  }
});

test("accepting an in-app invitation grants Workspace membership and clears the pending entry", async () => {
  const database = new Database(":memory:");
  const messages: Array<{ to: string; text: string }> = [];
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async (message) => { messages.push({ to: message.to, text: message.text }); } },
    secret: "01234567890123456789012345678901",
  });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl: control });

  try {
    const owner = await createVerifiedSession(auth, messages, "Ada", "ada@example.com");
    const invitee = await createVerifiedSession(auth, messages, "Grace", "grace@example.com");
    const workspace = control.listAcceptedWorkspaces({ userId: owner.id, userName: owner.name })[0]!;
    const invitation = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({ email: "grace@example.com" }),
    }));
    const invitationBody = await invitation.json() as { id: string };

    const accepted = await application(new Request(`http://127.0.0.1:8787/v1/invitations/${invitationBody.id}/accept`, {
      method: "POST",
      headers: { cookie: invitee.cookie },
    }));
    expect(accepted.status).toBe(200);

    const context = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/context`, {
      headers: { cookie: invitee.cookie },
    }));
    await expect(context.json()).resolves.toMatchObject({ workspace: { id: workspace.id, role: "member" } });
    const pending = await application(new Request("http://127.0.0.1:8787/v1/invitations", { headers: { cookie: invitee.cookie } }));
    await expect(pending.json()).resolves.toEqual({ invitations: [] });
  } finally {
    database.close();
  }
});

test("declining an in-app invitation removes it from the invitee Workspace list", async () => {
  const database = new Database(":memory:");
  const messages: Array<{ to: string; text: string }> = [];
  const auth = await createLocalAuth({ baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push({ to: message.to, text: message.text }); } }, secret: "01234567890123456789012345678901" });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl: control });
  try {
    const owner = await createVerifiedSession(auth, messages, "Ada", "ada@example.com");
    const invitee = await createVerifiedSession(auth, messages, "Grace", "grace@example.com");
    const workspace = control.listAcceptedWorkspaces({ userId: owner.id, userName: owner.name })[0]!;
    const created = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/invitations`, { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie }, body: JSON.stringify({ email: "grace@example.com" }) }));
    const invitation = await created.json() as { id: string };

    const declined = await application(new Request(`http://127.0.0.1:8787/v1/invitations/${invitation.id}/decline`, { method: "POST", headers: { cookie: invitee.cookie } }));
    expect(declined.status).toBe(200);
    const pending = await application(new Request("http://127.0.0.1:8787/v1/invitations", { headers: { cookie: invitee.cookie } }));
    await expect(pending.json()).resolves.toEqual({ invitations: [] });
    expect(control.getAcceptedWorkspaceContext({ workspaceId: workspace.id, userId: invitee.id })).toBeNull();
  } finally { database.close(); }
});

test("owners cancel pending Workspace invitations", async () => {
  const database = new Database(":memory:");
  const messages: Array<{ to: string; text: string }> = [];
  const auth = await createLocalAuth({ baseURL: "http://127.0.0.1:8787", database, mailSink: { capture: async (message) => { messages.push({ to: message.to, text: message.text }); } }, secret: "01234567890123456789012345678901" });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl: control });
  try {
    const owner = await createVerifiedSession(auth, messages, "Ada", "ada@example.com");
    const invitee = await createVerifiedSession(auth, messages, "Grace", "grace@example.com");
    const workspace = control.listAcceptedWorkspaces({ userId: owner.id, userName: owner.name })[0]!;
    const created = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/invitations`, { method: "POST", headers: { "content-type": "application/json", cookie: owner.cookie }, body: JSON.stringify({ email: "grace@example.com" }) }));
    const invitation = await created.json() as { id: string };
    const cancelled = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/invitations/${invitation.id}`, { method: "DELETE", headers: { cookie: owner.cookie } }));
    expect(cancelled.status).toBe(200);
    const pending = await application(new Request("http://127.0.0.1:8787/v1/invitations", { headers: { cookie: invitee.cookie } }));
    await expect(pending.json()).resolves.toEqual({ invitations: [] });
  } finally { database.close(); }
});

async function createVerifiedSession(
  auth: Awaited<ReturnType<typeof createLocalAuth>>,
  messages: Array<{ to: string; text: string }>,
  name: string,
  email: string,
) {
  const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: "Strong1!" }),
  }));
  const body = await signUp.json() as { user: { id: string; name: string } };
  const verificationUrl = messages.find((message) => message.to === email)?.text.match(/https?:\/\/\S+/)?.[0];
  await auth.handler(new Request(verificationUrl!, { redirect: "manual" }));
  const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Strong1!" }),
  }));
  return { cookie: signIn.headers.get("set-cookie")?.split(";", 1)[0]!, id: body.user.id, name: body.user.name };
}
