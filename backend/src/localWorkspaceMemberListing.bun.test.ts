import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

// @ts-expect-error The frontend's JavaScript sources are type-checked by its Vite build.
import { createWorkspaceRequestAdapter } from "../../frontend/src/features/workspaces/workspaceRequestAdapter.js";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";

test("the Workspace member-list adapter uses the real session-only HTTP interface", async () => {
  const database = new Database(":memory:");
  const verificationLinks: string[] = [];
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        const link = message.text.match(/https?:\/\/\S+/)?.[0];
        if (link) verificationLinks.push(link);
      },
    },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, workspaceControl });

  try {
    const owner = await createSignedInUser({
      application,
      auth,
      email: "ada@example.com",
      name: "Ada Lovelace",
      verificationLinks,
    });
    const member = await createSignedInUser({
      application,
      auth,
      email: "grace@example.com",
      name: "Grace Hopper",
      verificationLinks,
    });
    const stranger = await createSignedInUser({
      application,
      auth,
      email: "linus@example.com",
      name: "Linus Torvalds",
      verificationLinks,
    });
    const workspace = workspaceControl.listAcceptedWorkspaces({ userId: owner.session.id, userName: owner.session.name })[0]!;
    const invitation = workspaceControl.createInvitation({
      workspaceId: workspace.id,
      inviterUserId: owner.session.id,
      email: member.session.email,
    });
    workspaceControl.acceptInvitation({
      invitationId: invitation.id,
      userId: member.session.id,
      userEmail: member.session.email,
    });
    const memberAdapter = createWorkspaceRequestAdapter({ request: createFetchRequest(application, member.cookie) });

    await expect(memberAdapter.listWorkspaceUsers(workspace.id)).resolves.toEqual([
      expect.objectContaining({ user_id: owner.session.id, name: "Ada Lovelace", email: "ada@example.com", role: "owner" }),
      expect.objectContaining({ user_id: member.session.id, name: "Grace Hopper", email: "grace@example.com", role: "member" }),
    ]);

    const strangerAdapter = createWorkspaceRequestAdapter({ request: createFetchRequest(application, stranger.cookie) });
    await expect(strangerAdapter.listWorkspaceUsers(workspace.id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: owner.session.id }).api_key;
    const apiKeyResponse = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/users`, {
      headers: { authorization: `Bearer ${apiKey}` },
    }));
    expect(apiKeyResponse.status).toBe(401);

    const ownerAdapter = createWorkspaceRequestAdapter({ request: createFetchRequest(application, owner.cookie) });
    await expect(ownerAdapter.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      targetUserId: member.session.id,
      action: "make_admin",
    })).resolves.toEqual({ workspace_id: workspace.id, user_id: member.session.id, action: "make_admin", role: "admin" });
    await expect(ownerAdapter.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      targetUserId: member.session.id,
      action: "make_owner",
    })).resolves.toEqual({ workspace_id: workspace.id, user_id: member.session.id, action: "make_owner", role: "owner" });
    await expect(memberAdapter.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      targetUserId: owner.session.id,
      action: "remove_user",
    })).resolves.toEqual({ workspace_id: workspace.id, user_id: owner.session.id, action: "remove_user", role: null });
    await expect(strangerAdapter.applyWorkspaceMemberAction({
      workspaceId: workspace.id,
      targetUserId: member.session.id,
      action: "remove_user",
    })).rejects.toMatchObject({ code: "forbidden", status: 403 });
  } finally {
    database.close();
  }
});

async function createSignedInUser({
  application,
  auth,
  email,
  name,
  verificationLinks,
}: {
  application: (request: Request) => Response | Promise<Response>;
  auth: Awaited<ReturnType<typeof createLocalAuth>>;
  email: string;
  name: string;
  verificationLinks: string[];
}) {
  await application(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, email, password: "Strong1!" }),
  }));
  const verificationLink = verificationLinks.find((link) => link.includes(encodeURIComponent(email))) ?? verificationLinks.at(-1)!;
  await application(new Request(verificationLink, { redirect: "manual" }));
  const signIn = await application(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Strong1!" }),
  }));
  const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0]!;
  const session = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie } }));
  return { cookie, session: session! };
}

function createFetchRequest(application: (request: Request) => Response | Promise<Response>, cookie: string) {
  return async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("cookie", cookie);
    const response = await application(new Request(`http://127.0.0.1:8787/v1${path}`, { ...options, headers }));
    const data = await response.json() as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw Object.assign(new Error(data.error?.message || `Request failed (${response.status})`), {
        code: data.error?.code || null,
        status: response.status,
      });
    }
    return data;
  };
}
