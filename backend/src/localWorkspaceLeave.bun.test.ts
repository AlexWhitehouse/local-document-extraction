import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// @ts-expect-error The frontend's JavaScript sources are type-checked by its Vite build.
import { createWorkspaceRequestAdapter } from "../../frontend/src/features/workspaces/workspaceRequestAdapter.js";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import {
  createLocalWorkspaceProductStore,
  openLocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";

test("a member can leave a non-final Workspace through the session-only adapter without erasing its resources", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-workspace-leave-"));
  const database = new Database(":memory:");
  const verificationLinks: string[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
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
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const application = createLocalApplication({
    auth,
    sourceFileStore: sourceFiles,
    stateDirectory,
    workspaceControl,
  });

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
    const workspace = workspaceControl.listAcceptedWorkspaces({
      userId: owner.session.id,
      userName: owner.session.name,
    })[0]!;
    const memberPersonalWorkspace = workspaceControl.listAcceptedWorkspaces({
      userId: member.session.id,
      userName: member.session.name,
    })[0]!;
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
    workspaceControl.createInvitation({
      workspaceId: workspace.id,
      inviterUserId: owner.session.id,
      email: "pending@example.com",
    });
    const apiKey = workspaceControl.rotateApiKey({
      workspaceId: workspace.id,
      userId: owner.session.id,
    }).api_key;
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });
    productStore.createTemplate({
      templateId: "tpl_preserved",
      name: "Preserved template",
      description: null,
      fields: [],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_preserved",
      templateId: "tpl_preserved",
      templateVersion: 1,
      sourceFileKey: "source-files/workspaces/placeholder",
      sourceMimeType: "text/plain",
      sourceName: "preserved.txt",
      sourceFilePageCount: null,
      submittedAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.close();
    const sourceFileKey = await sourceFiles.write({
      workspaceId: workspace.id,
      jobId: "job_source_preserved",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    const memberAdapter = createWorkspaceRequestAdapter({
      request: createFetchRequest(application, member.cookie),
    });
    await expect(memberAdapter.leaveWorkspace(workspace.id)).resolves.toEqual({
      ok: true,
      workspace_id: workspace.id,
      next_workspace: expect.objectContaining({
        id: memberPersonalWorkspace.id,
        has_api_key: false,
        role: "owner",
      }),
    });

    expect(workspaceControl.listAcceptedWorkspaces({ userId: member.session.id })).toEqual([
      expect.objectContaining({ id: memberPersonalWorkspace.id }),
    ]);
    expect(workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: owner.session.id }))
      .toEqual([expect.objectContaining({ user_id: owner.session.id, role: "owner" })]);
    expect(workspaceControl.listWorkspaceInvitations({ workspaceId: workspace.id, userId: owner.session.id }))
      .toEqual([expect.objectContaining({ email: "pending@example.com" })]);
    expect(workspaceControl.authorizeApiKey({ apiKey })).toEqual(expect.objectContaining({ id: workspace.id }));
    const preservedStore = openLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id })!;
    expect(preservedStore.listTemplates()).toEqual([expect.objectContaining({ id: "tpl_preserved" })]);
    expect(preservedStore.getExtractionJob("job_preserved")).toEqual(expect.objectContaining({ job_id: "job_preserved" }));
    preservedStore.close();
    await expect(sourceFiles.read(sourceFileKey)).resolves.toEqual(new Uint8Array([137, 80, 78, 71]));

    const ownerAdapter = createWorkspaceRequestAdapter({
      request: createFetchRequest(application, owner.cookie),
    });
    await expect(ownerAdapter.leaveWorkspace(workspace.id)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    const strangerAdapter = createWorkspaceRequestAdapter({
      request: createFetchRequest(application, stranger.cookie),
    });
    await expect(strangerAdapter.leaveWorkspace(workspace.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    const apiKeyResponse = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/leave`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
    }));
    expect(apiKeyResponse.status).toBe(401);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("leaving a final Workspace creates one bootstrapped replacement without erasing the departed Workspace", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-workspace-leave-replacement-"));
  const database = new Database(":memory:");
  const verificationLinks: string[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
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
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const application = createLocalApplication({
    auth,
    sourceFileStore: sourceFiles,
    stateDirectory,
    workspaceControl,
  });

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
    const workspace = workspaceControl.listAcceptedWorkspaces({
      userId: owner.session.id,
      userName: owner.session.name,
    })[0]!;
    const memberPersonalWorkspace = workspaceControl.listAcceptedWorkspaces({
      userId: member.session.id,
      userName: member.session.name,
    })[0]!;
    const acceptedInvitation = workspaceControl.createInvitation({
      workspaceId: workspace.id,
      inviterUserId: owner.session.id,
      email: member.session.email,
    });
    workspaceControl.acceptInvitation({
      invitationId: acceptedInvitation.id,
      userId: member.session.id,
      userEmail: member.session.email,
    });
    workspaceControl.deleteWorkspace({
      workspaceId: memberPersonalWorkspace.id,
      userId: member.session.id,
    });
    const pendingInvitationWorkspace = workspaceControl.createWorkspace({
      userId: owner.session.id,
      name: "Pending invitation Workspace",
    });
    workspaceControl.createInvitation({
      workspaceId: pendingInvitationWorkspace.workspace_id,
      inviterUserId: owner.session.id,
      email: member.session.email,
    });
    const apiKey = workspaceControl.rotateApiKey({
      workspaceId: workspace.id,
      userId: owner.session.id,
    }).api_key;
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });
    productStore.createTemplate({
      templateId: "tpl_departed_workspace",
      name: "Departed workspace template",
      description: null,
      fields: [],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.close();
    const sourceFileKey = await sourceFiles.write({
      workspaceId: workspace.id,
      jobId: "job_departed_workspace",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    const memberAdapter = createWorkspaceRequestAdapter({
      request: createFetchRequest(application, member.cookie),
    });
    const result = await memberAdapter.leaveWorkspace(workspace.id) as {
      ok: true;
      workspace_id: string;
      next_workspace: { id: string; role: string; has_api_key: boolean };
      replacement_workspace: { workspace_id: string; name: string; role: string; has_api_key: boolean; api_key?: string };
    };

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      workspace_id: workspace.id,
      next_workspace: expect.objectContaining({ role: "owner", has_api_key: false }),
      replacement_workspace: expect.objectContaining({
        name: "Grace Hopper Workspace",
        role: "owner",
        has_api_key: false,
      }),
    }));
    expect(result.replacement_workspace.workspace_id).toBe(result.next_workspace.id);
    expect(result.replacement_workspace).not.toHaveProperty("api_key");
    expect(workspaceControl.hasPendingStarterTemplateBootstrap({
      workspaceId: result.replacement_workspace.workspace_id,
    })).toBe(true);
    expect(workspaceControl.listAcceptedWorkspaces({ userId: member.session.id })).toEqual([
      expect.objectContaining({ id: result.replacement_workspace.workspace_id, role: "owner" }),
    ]);
    expect(workspaceControl.listPendingInvitations({ email: member.session.email })).toEqual([
      expect.objectContaining({ workspace_id: pendingInvitationWorkspace.workspace_id }),
    ]);
    expect(workspaceControl.listWorkspaceUsers({ workspaceId: workspace.id, userId: owner.session.id }))
      .toEqual([expect.objectContaining({ user_id: owner.session.id, role: "owner" })]);
    expect(workspaceControl.authorizeApiKey({ apiKey })).toEqual(expect.objectContaining({ id: workspace.id }));
    const preservedStore = openLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id })!;
    expect(preservedStore.listTemplates()).toEqual([expect.objectContaining({ id: "tpl_departed_workspace" })]);
    preservedStore.close();
    await expect(sourceFiles.read(sourceFileKey)).resolves.toEqual(new Uint8Array([137, 80, 78, 71]));

    await expect(memberAdapter.leaveWorkspace(workspace.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(workspaceControl.listAcceptedWorkspaces({ userId: member.session.id })).toHaveLength(1);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
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
