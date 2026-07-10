import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "./localAuth";
import { createLocalApplication } from "./localApplication";
import {
  createLocalWorkspaceControl,
  LocalWorkspaceControlError,
} from "./localWorkspaceControl";

test("local Workspace control repairs a user's zero-accepted-Workspace invariant", async () => {
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
  }));
  const user = await signUp.json() as { user: { id: string; name: string } };
  const control = createLocalWorkspaceControl(database);

  try {
    const workspaces = control.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name });
    const reopenedControl = createLocalWorkspaceControl(database);

    expect(workspaces).toEqual([
      expect.objectContaining({
        has_api_key: false,
        name: "Ada Lovelace Workspace",
        role: "owner",
      }),
    ]);
    expect(reopenedControl.listAcceptedWorkspaces({ userId: user.user.id })).toEqual(workspaces);
  } finally {
    database.close();
  }
});

test("the Bun API creates and resolves accepted Workspace context for a signed-in user", async () => {
  const database = new Database(":memory:");
  const capturedLinks: string[] = [];
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        const url = message.text.match(/https?:\/\/\S+/)?.[0];
        if (url) {
          capturedLinks.push(url);
        }
      },
    },
    secret: "01234567890123456789012345678901",
  });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl: control });

  try {
    await application(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    await application(new Request(capturedLinks[0]!, { redirect: "manual" }));
    const signIn = await application(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const listed = await application(new Request("http://127.0.0.1:8787/v1/workspaces", {
      headers: { cookie: cookie! },
    }));
    const listBody = await listed.json() as { workspaces: Array<{ id: string; role: string }> };
    expect(listed.status).toBe(200);
    expect(listBody.workspaces).toHaveLength(1);
    expect(listBody.workspaces[0]?.role).toBe("owner");

    const created = await application(new Request("http://127.0.0.1:8787/v1/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! },
      body: JSON.stringify({ name: "Research" }),
    }));
    const createdBody = await created.json() as { workspace_id: string };
    expect(created.status).toBe(201);

    const context = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${createdBody.workspace_id}/context`, {
      headers: { cookie: cookie! },
    }));
    await expect(context.json()).resolves.toMatchObject({
      workspace: { id: createdBody.workspace_id, name: "Research", role: "owner" },
    });
  } finally {
    database.close();
  }
});

test("Workspace rename and deletion retain the accepted-Workspace policy", async () => {
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
  }));
  const user = await signUp.json() as { user: { id: string; name: string } };
  const control = createLocalWorkspaceControl(database);

  try {
    const personalWorkspace = control.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
    const researchWorkspace = control.createWorkspace({ userId: user.user.id, name: "Research" });

    expect(control.renameWorkspace({
      workspaceId: researchWorkspace.workspace_id,
      userId: user.user.id,
      name: "Research Archive",
    })).toEqual({ workspace_id: researchWorkspace.workspace_id, name: "Research Archive" });

    control.deleteWorkspace({ workspaceId: personalWorkspace.id, userId: user.user.id });
    expect(control.listAcceptedWorkspaces({ userId: user.user.id })).toEqual([
      expect.objectContaining({ id: researchWorkspace.workspace_id, name: "Research Archive" }),
    ]);
    expect(() => control.deleteWorkspace({ workspaceId: researchWorkspace.workspace_id, userId: user.user.id }))
      .toThrow(new LocalWorkspaceControlError("last_workspace", "You cannot delete your only workspace"));
  } finally {
    database.close();
  }
});

test("Workspace API key rotation stores only the current hash and invalidates the prior key", async () => {
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
  }));
  const user = await signUp.json() as { user: { id: string; name: string } };
  const control = createLocalWorkspaceControl(database);

  try {
    const workspace = control.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
    const first = control.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id });
    const second = control.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id });

    expect(first.api_key).not.toBe(second.api_key);
    expect(control.authorizeApiKey({ apiKey: first.api_key })).toBeNull();
    expect(control.authorizeApiKey({ apiKey: second.api_key })).toMatchObject({ id: workspace.id, has_api_key: true });
  } finally {
    database.close();
  }
});
