import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// @ts-expect-error The frontend's JavaScript sources are type-checked by its Vite build.
import { createDocumentRequestAdapter } from "../../frontend/src/features/documents/documentRequestAdapter.js";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore, openLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";

test("terminal Document deletion crosses the adapter and Fetch application without affecting other product data", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-document-delete-"));
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
    const stranger = await createSignedInUser({
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
    const sourceKeys = await createTerminalJobs({ sourceFiles, stateDirectory, workspaceId: workspace.id });
    const beforeDeletion = openLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id })!;
    expect(beforeDeletion.getExtractionJob("job_completed")).toEqual(expect.objectContaining({ status: "completed" }));
    beforeDeletion.close();
    const ownerAdapter = createDocumentRequestAdapter({
      request: createFetchRequest(application, owner.cookie, workspace.id),
    });

    const completedDeletion = await ownerAdapter.deleteDocument("job_completed");
    expect(completedDeletion).toEqual({
      deleted: true,
      job_id: "job_completed",
    });
    await expect(sourceFiles.read(sourceKeys.completed)).resolves.toBeNull();
    const afterCompleted = openLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id })!;
    expect(afterCompleted.getExtractionJob("job_completed")).toBeNull();
    expect(afterCompleted.getExtractionJob("job_failed")).toEqual(expect.objectContaining({ status: "failed" }));
    expect(afterCompleted.getExtractionJob("job_queued")).toEqual(expect.objectContaining({ status: "queued" }));
    expect(afterCompleted.getTemplate("tpl_invoice")).toEqual(expect.objectContaining({ id: "tpl_invoice" }));
    afterCompleted.close();
    const productDatabase = new Database(join(stateDirectory, "data", "workspaces", `${workspace.id}.sqlite`));
    try {
      expect(productDatabase.query("SELECT job_id FROM job_results WHERE job_id = ?").all("job_completed")).toEqual([]);
      expect(productDatabase.query("SELECT job_id FROM source_files WHERE job_id = ?").all("job_completed")).toEqual([]);
    } finally {
      productDatabase.close();
    }

    await expect(ownerAdapter.deleteDocument("job_failed")).resolves.toEqual({
      deleted: true,
      job_id: "job_failed",
    });
    await expect(sourceFiles.read(sourceKeys.failed)).resolves.toBeNull();
    await expect(ownerAdapter.deleteDocument("job_completed")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(ownerAdapter.deleteDocument("job_queued")).resolves.toEqual({
      deleted: true,
      job_id: "job_queued",
    });
    await expect(sourceFiles.read(sourceKeys.queued)).resolves.toBeNull();

    const strangerAdapter = createDocumentRequestAdapter({
      request: createFetchRequest(application, stranger.cookie, workspace.id),
    });
    await expect(strangerAdapter.deleteDocument("job_api_key")).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });

    const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: owner.session.id }).api_key;
    const apiKeyResponse = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_api_key", {
      method: "DELETE",
      headers: { authorization: `Bearer ${apiKey}` },
    }));
    expect(apiKeyResponse.status).toBe(200);
    await expect(sourceFiles.read(sourceKeys.apiKey)).resolves.toBeNull();
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test.each(["failed unlink", "interrupted deletion"])("Source cleanup survives restart after %s", async (failure) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-delete-recovery-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({ database, baseURL: "http://127.0.0.1:8787", requireEmailVerification: false,
    secret: "01234567890123456789012345678901", mailSink: { capture: async () => {} } });
  const control = createLocalWorkspaceControl(database);
  const files = createLocalSourceFileStore({ stateDirectory });
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  let restarted: ReturnType<typeof createLocalWorkspaceProductStoreRegistry> | undefined;
  try {
    const signup = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Owner", email: "owner@example.org", password: "Strong1!" }),
    }));
    const { user } = await signup.json() as { user: { id: string } };
    const workspace = control.createWorkspace({ userId: user.id, name: "Recovery" });
    const apiKey = control.rotateApiKey({ workspaceId: workspace.workspace_id, userId: user.id }).api_key;
    const keys = await createTerminalJobs({ sourceFiles: files, stateDirectory, workspaceId: workspace.workspace_id });
    if (failure === "failed unlink") {
      const application = createLocalApplication({ auth, stateDirectory, workspaceControl: control, productStoreRegistry: registry,
        sourceFileStore: { ...files, delete: async () => { throw new Error("simulated EIO"); } } });
      const response = await application(new Request("http://127.0.0.1:8787/v1/jobs/job_failed", {
        method: "DELETE", headers: { authorization: `Bearer ${apiKey}`, origin: "https://external-client.example.org" },
      }));
      expect(response.status).toBe(200);
    } else {
      const lease = registry.acquire({ workspaceId: workspace.workspace_id })!;
      lease.store.deleteExtractionJob({ jobId: "job_failed" });
      lease.release(); // Simulate process exit after committing metadata deletion.
    }
    registry.closeAll();
    expect(await files.read(keys.failed)).not.toBeNull();
    restarted = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
    const lease = restarted.acquire({ workspaceId: workspace.workspace_id, mode: "existing" })!;
    try {
      expect(lease.store.getExtractionJob("job_failed")).toBeNull();
      expect(lease.store.listRetainedTerminalSourceFiles({ failedBefore: "2000-01-01T00:00:00.000Z" }))
        .toContainEqual({ job_id: "job_failed", source_file_key: keys.failed });
    } finally { lease.release(); }
    const retention = createLocalSourceFileRetention({ stateDirectory, productStoreRegistry: restarted, sourceFileStore: files });
    await retention.run();
    await retention.run();
    expect(await files.read(keys.failed)).toBeNull();
    expect(retention.snapshot().failures).toBe(0);
  } finally {
    registry.closeAll(); restarted?.closeAll(); database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function createTerminalJobs({
  sourceFiles,
  stateDirectory,
  workspaceId,
}: {
  sourceFiles: ReturnType<typeof createLocalSourceFileStore>;
  stateDirectory: string;
  workspaceId: string;
}) {
  const sourceKeys = {
    completed: await writeSource(sourceFiles, workspaceId, "job_completed"),
    failed: await writeSource(sourceFiles, workspaceId, "job_failed"),
    queued: await writeSource(sourceFiles, workspaceId, "job_queued"),
    apiKey: await writeSource(sourceFiles, workspaceId, "job_api_key"),
  };
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: null,
      fields: [{ id: "invoice_number", name: "Invoice number", description: "Invoice number", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    for (const [jobId, sourceFileKey] of [
      ["job_completed", sourceKeys.completed],
      ["job_failed", sourceKeys.failed],
      ["job_queued", sourceKeys.queued],
      ["job_api_key", sourceKeys.apiKey],
    ]) {
      store.createQueuedExtractionJob({
        jobId,
        templateId: "tpl_invoice",
        templateVersion: 1,
        sourceFileKey,
        sourceMimeType: "image/png",
        sourceName: `${jobId}.png`,
        sourceFilePageCount: null,
        submittedAt: "2026-07-10T12:00:00.000Z",
      });
    }
    store.claimExtractionJobForProcessing({
      jobId: "job_completed",
      attempt: 1,
      claimedAt: "2026-07-10T12:01:00.000Z",
    });
    store.completeExtractionJob({
      jobId: "job_completed",
      attempt: 1,
      completedAt: "2026-07-10T12:02:00.000Z",
      modelName: "test-model",
      route: "test-route",
      results: [{ field_id: "invoice_number", status: "ok", answer: "INV-001", normalized_value: "INV-001", confidence: 1, evidence: null }],
    });
    for (const jobId of ["job_failed", "job_api_key"]) {
      store.claimExtractionJobForProcessing({
        jobId,
        attempt: 1,
        claimedAt: "2026-07-10T12:01:00.000Z",
      });
      store.failExtractionJob({
        jobId,
        attempt: 1,
        failedAt: "2026-07-10T12:02:00.000Z",
        errorCode: "test_failure",
        errorMessage: "Test failure",
      });
    }
  } finally {
    store.close();
  }
  return sourceKeys;
}

async function writeSource(
  sourceFiles: ReturnType<typeof createLocalSourceFileStore>,
  workspaceId: string,
  jobId: string,
) {
  return sourceFiles.write({
    workspaceId,
    jobId,
    mimeType: "image/png",
    bytes: new Uint8Array([137, 80, 78, 71]),
  });
}

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

function createFetchRequest(
  application: (request: Request) => Response | Promise<Response>,
  cookie: string,
  workspaceId: string,
) {
  return async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("cookie", cookie);
    headers.set("x-workspace-id", workspaceId);
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
