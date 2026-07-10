import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// @ts-expect-error The frontend's JavaScript sources are type-checked by its Vite build.
import { createWorkspaceRequestAdapter } from "../../frontend/src/features/workspaces/workspaceRequestAdapter.js";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalProductAnalytics } from "./localProductAnalytics";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("the Workspace deletion adapter preserves policy errors and hard-erases an idle Workspace before success", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-workspace-delete-"));
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
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const productAnalytics = createLocalProductAnalytics({
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    stateDirectory,
  });
  const application = createLocalApplication({
    auth,
    productAnalytics,
    sourceFileStore: sourceFiles,
    stateDirectory,
    workspaceControl,
  });

  try {
    await application(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    await application(new Request(verificationLinks[0]!, { redirect: "manual" }));
    const signIn = await application(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0]!;
    const session = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie } }));
    const doomedWorkspace = workspaceControl.listAcceptedWorkspaces({ userId: session!.id })[0]!;
    const adapter = createWorkspaceRequestAdapter({ request: createFetchRequest(application, cookie) });

    await expect(adapter.deleteWorkspace(doomedWorkspace.id)).rejects.toMatchObject({
      code: "last_workspace",
      status: 409,
    });

    workspaceControl.createWorkspace({ userId: session!.id, name: "Remaining Workspace" });
    const apiKey = workspaceControl.rotateApiKey({ workspaceId: doomedWorkspace.id, userId: session!.id }).api_key;
    workspaceControl.createInvitation({
      workspaceId: doomedWorkspace.id,
      inviterUserId: session!.id,
      email: "grace@example.com",
    });
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: doomedWorkspace.id });
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [{ id: "invoice_number", name: "Invoice number", description: "Invoice number.", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.close();
    const sourceFileKey = await sourceFiles.write({
      workspaceId: doomedWorkspace.id,
      jobId: "job_invoice",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    const databasePath = join(stateDirectory, "data", "workspaces", `${doomedWorkspace.id}.sqlite`);
    await writeFile(`${databasePath}-wal`, "sidecar");
    await writeFile(`${databasePath}-shm`, "sidecar");
    productAnalytics.record({
      type: "template_created",
      workspaceId: doomedWorkspace.id,
      templateId: "tpl_invoice",
      templateVersion: 1,
      status: "active",
      fieldCount: 1,
    });
    await productAnalytics.flush();

    await expect(adapter.deleteWorkspace(doomedWorkspace.id)).resolves.toEqual({
      ok: true,
      workspace_id: doomedWorkspace.id,
    });

    expect(workspaceControl.authorizeApiKey({ apiKey })).toBeNull();
    expect(workspaceControl.listPendingInvitations({ email: "grace@example.com" })).toEqual([]);
    expect(workspaceControl.listWorkspaceDeletionIntents()).toEqual([]);
    expect(await sourceFiles.read(sourceFileKey)).toBeNull();
    await expectPathMissing(databasePath);
    await expectPathMissing(`${databasePath}-wal`);
    await expectPathMissing(`${databasePath}-shm`);
    await expectPathMissing(join(stateDirectory, "source-files", "workspaces", doomedWorkspace.id));
    await expect(readFile(join(stateDirectory, "analytics", "2026-07-10.jsonl"), "utf8")).resolves.toContain(doomedWorkspace.id);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function createFetchRequest(application: (request: Request) => Response | Promise<Response>, cookie: string) {
  return async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("cookie", cookie);
    const response = await application(new Request(`http://127.0.0.1:8787/v1${path}`, {
      ...options,
      headers,
    }));
    const data = await response.json() as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      const error = Object.assign(new Error(data.error?.message || `Request failed (${response.status})`), {
        code: data.error?.code || null,
        status: response.status,
      });
      throw error;
    }
    return data;
  };
}

async function expectPathMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
}
