import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "./localAuth";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceExtractionJob } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";

test("Workspace deletion aborts and drains in-flight extraction before hard erasure", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-in-flight-delete-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const workspaceProductOperations = createLocalWorkspaceProductOperations();
  const lifecycleUpdates: LocalWorkspaceExtractionJob[] = [];
  const scheduledJobs: string[] = [];
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  let extractionStarted: () => void = () => {};
  const extractionStartedPromise = new Promise<void>((resolve) => {
    extractionStarted = resolve;
  });
  let wasAborted = false;

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
      jobId: "job_in_flight",
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
      jobId: "job_in_flight",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-10T12:01:00.000Z",
    });
    productStore.close();

    const runner = createLocalExtractionRunner({
      extract: async ({ signal }) => {
        extractionStarted();
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            wasAborted = true;
            reject(new DOMException("Workspace deletion cancelled extraction", "AbortError"));
          }, { once: true });
        });
      },
      onJobLifecycleChange: (_workspaceId, job) => lifecycleUpdates.push(job),
      productAnalytics: {
        flush: async () => {},
        record: (event) => analyticsEvents.push(event),
      } satisfies LocalProductAnalytics,
      scheduleJob: async (job) => {
        scheduledJobs.push(job.job_id);
      },
      sourceFileStore: sourceFiles,
      stateDirectory,
      workspaceControl,
      workspaceProductOperations,
    });
    const running = runner.run({
      job_id: "job_in_flight",
      workspace_id: deletedWorkspace.id,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-10T12:01:00.000Z",
      attempt: 1,
    });

    await extractionStartedPromise;
    await createLocalWorkspaceDeletion({
      sourceFileStore: sourceFiles,
      stateDirectory,
      workspaceControl,
      workspaceProductOperations,
    }).deleteWorkspace({ workspaceId: deletedWorkspace.id, userId: user.user.id });
    await running;

    expect(wasAborted).toBe(true);
    expect(lifecycleUpdates.map((job) => job.status)).toEqual(["processing"]);
    expect(scheduledJobs).toEqual([]);
    expect(analyticsEvents).toEqual([]);
    await expect(stat(join(stateDirectory, "data", "workspaces", `${deletedWorkspace.id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
