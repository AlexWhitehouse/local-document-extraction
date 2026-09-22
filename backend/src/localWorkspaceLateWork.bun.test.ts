import { expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "./localAuth";
import { RetryableError } from "./consumer/modelGateway";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import type { LocalWorkspaceExtractionJobSummary } from "./localWorkspaceProductStore";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createConfiguredTestProductStore as createLocalWorkspaceProductStore } from "./testing/workspaceModelFixture";

test("late queue deliveries after hard deletion do not recreate a Workspace product database", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-late-work-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const lifecycleUpdates: LocalWorkspaceExtractionJobSummary[] = [];
  const scheduledJobs: string[] = [];
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  const productAnalytics: LocalProductAnalytics = {
    flush: async () => {},
    record: (event) => analyticsEvents.push(event),
  };
  let modelCalls = 0;

  try {
    const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const user = await signUp.json() as { user: { id: string; name: string } };
    const deletedWorkspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
    workspaceControl.createWorkspace({ userId: user.user.id, name: "Remaining Workspace" });

    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: deletedWorkspace.id });
    const sourceFileKey = await sourceFiles.write({
      workspaceId: deletedWorkspace.id,
      jobId: "job_late",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [{ id: "invoice_number", name: "Invoice number", description: "Invoice number.", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_late",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-10T12:01:00.000Z",
    });
    productStore.close();

    await createLocalWorkspaceDeletion({ sourceFileStore: sourceFiles, stateDirectory, workspaceControl }).deleteWorkspace({
      workspaceId: deletedWorkspace.id,
      userId: user.user.id,
    });

    const runner = createLocalExtractionRunner({
      extract: async () => {
        modelCalls += 1;
        throw new Error("A deleted Workspace must not call the model");
      },
      onJobLifecycleChange: (_workspaceId, job) => lifecycleUpdates.push(job),
      productAnalytics,
      scheduleJob: async (job) => {
        scheduledJobs.push(job.job_id);
      },
      stateDirectory,
      workspaceControl,
    });
    const lateJob = {
      job_id: "job_late",
      workspace_id: deletedWorkspace.id,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-10T12:01:00.000Z",
    };
    await runner.run(lateJob);
    await runner.run(lateJob);
    await runner.recover();

    await expect(stat(join(stateDirectory, "data", "workspaces", `${deletedWorkspace.id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
    expect(lifecycleUpdates).toEqual([]);
    expect(scheduledJobs).toEqual([]);
    expect(analyticsEvents).toEqual([]);
    expect(modelCalls).toBe(0);

    await writeFile(join(stateDirectory, "data", "workspaces", `${deletedWorkspace.id}.sqlite`), "orphaned");
    let orphanOpenCalls = 0;
    const recoveryRunner = createLocalExtractionRunner({
      productStoreOpener: () => {
        orphanOpenCalls += 1;
        return null;
      },
      stateDirectory,
      workspaceControl,
    });
    await recoveryRunner.recover();
    expect(orphanOpenCalls).toBe(0);
    await rm(join(stateDirectory, "data", "workspaces", `${deletedWorkspace.id}.sqlite`), { force: true });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("a retryable extraction failure does not requeue work after its Workspace is deleted", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-late-retry-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const scheduledJobs: string[] = [];
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  const lifecycleUpdates: LocalWorkspaceExtractionJobSummary[] = [];

  try {
    const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const user = await signUp.json() as { user: { id: string } };
    workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: "Ada Lovelace" });
    const retryWorkspace = workspaceControl.createWorkspace({ userId: user.user.id, name: "Retry Workspace" });
    const productStore = createLocalWorkspaceProductStore({
      stateDirectory,
      workspaceId: retryWorkspace.workspace_id,
    });
    const sourceFileKey = await sourceFiles.write({
      workspaceId: retryWorkspace.workspace_id,
      jobId: "job_retry",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [{ id: "invoice_number", name: "Invoice number", description: "Invoice number.", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_retry",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-10T12:01:00.000Z",
    });
    productStore.close();

    let extractionStarted: () => void = () => {};
    let failExtraction: (error: Error) => void = () => {};
    const extractionStartedPromise = new Promise<void>((resolve) => {
      extractionStarted = resolve;
    });
    const extractionResult = new Promise<never>((_resolve, reject) => {
      failExtraction = reject;
    });
    const runner = createLocalExtractionRunner({
      extract: async () => {
        extractionStarted();
        return extractionResult;
      },
      onJobLifecycleChange: (_workspaceId, job) => lifecycleUpdates.push(job),
      productAnalytics: {
        flush: async () => {},
        record: (event) => analyticsEvents.push(event),
      },
      scheduleJob: async (job) => {
        scheduledJobs.push(job.job_id);
      },
      sourceFileStore: sourceFiles,
      stateDirectory,
      workspaceControl,
    });
    const running = runner.run({
      job_id: "job_retry",
      workspace_id: retryWorkspace.workspace_id,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-10T12:01:00.000Z",
      attempt: 1,
    });

    await extractionStartedPromise;
    await createLocalWorkspaceDeletion({ sourceFileStore: sourceFiles, stateDirectory, workspaceControl }).deleteWorkspace({
      workspaceId: retryWorkspace.workspace_id,
      userId: user.user.id,
    });
    failExtraction(new RetryableError("Temporary model failure"));
    await running;

    expect(scheduledJobs).toEqual([]);
    expect(analyticsEvents).toEqual([]);
    expect(lifecycleUpdates.map((job) => job.status)).toEqual(["processing"]);
    await expect(stat(join(stateDirectory, "data", "workspaces", `${retryWorkspace.workspace_id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
