import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createConfiguredTestProductStore as createLocalWorkspaceProductStore } from "./testing/workspaceModelFixture";
import { openLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";

test("live Document deletion aborts and drains only its target job before erasure", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-live-document-delete-"));
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
  const workspaceProductOperations = createLocalWorkspaceProductOperations();
  const lifecycleUpdates: Array<{ jobId: string; status: string }> = [];
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  let extractionStarted: () => void = () => {};
  const extractionStartedPromise = new Promise<void>((resolve) => {
    extractionStarted = resolve;
  });
  let targetWasAborted = false;

  try {
    const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const user = await signUp.json() as { user: { id: string; name: string } };
    const workspace = workspaceControl.listAcceptedWorkspaces({
      userId: user.user.id,
      userName: user.user.name,
    })[0]!;
    const sourceFileKeys = await createJobs({ sourceFiles, stateDirectory, workspaceId: workspace.id });
    const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id }).api_key;
    const application = createLocalApplication({
      auth,
      productAnalytics: {
        flush: async () => {},
        record: (event) => analyticsEvents.push(event),
      } satisfies LocalProductAnalytics,
      sourceFileStore: sourceFiles,
      stateDirectory,
      workspaceControl,
      workspaceProductOperations,
    });
    const runner = createLocalExtractionRunner({
      extract: async ({ signal, sourceBytes }) => {
        if (new Uint8Array(sourceBytes)[0] === 1) {
          extractionStarted();
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => {
              targetWasAborted = true;
              reject(new DOMException("Document deletion cancelled extraction", "AbortError"));
            }, { once: true });
          });
        }
        return [{ field_id: "invoice_number", status: "ok", answer: "INV-002" }];
      },
      onJobLifecycleChange: (_workspaceId, job) => {
        lifecycleUpdates.push({ jobId: job.job_id, status: job.status });
      },
      productAnalytics: {
        flush: async () => {},
        record: (event) => analyticsEvents.push(event),
      } satisfies LocalProductAnalytics,
      sourceFileStore: sourceFiles,
      stateDirectory,
      workspaceControl,
      workspaceProductOperations,
    });

    const runningTarget = runner.run(job("job_processing", workspace.id));
    await extractionStartedPromise;
    const deleteResponse = await application(deleteRequest("job_processing", apiKey));
    await runningTarget;

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ deleted: true, job_id: "job_processing" });
    expect(targetWasAborted).toBe(true);
    expect(lifecycleUpdates.filter((update) => update.jobId === "job_processing"))
      .toEqual([{ jobId: "job_processing", status: "processing" }]);
    expect(analyticsEvents.filter((event) => isJobAnalyticsEvent(event, "job_processing"))).toEqual([]);
    await expect(sourceFiles.read(sourceFileKeys.processing)).resolves.toBeNull();

    const queuedDelete = await application(deleteRequest("job_queued", apiKey));
    expect(queuedDelete.status).toBe(200);
    await runner.run(job("job_queued", workspace.id));
    expect(lifecycleUpdates.some((update) => update.jobId === "job_queued")).toBe(false);
    expect(analyticsEvents.some((event) => isJobAnalyticsEvent(event, "job_queued"))).toBe(false);
    await expect(sourceFiles.read(sourceFileKeys.queued)).resolves.toBeNull();

    await runner.run(job("job_unrelated", workspace.id));
    const store = openLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id })!;
    try {
      expect(store.getExtractionJob("job_processing")).toBeNull();
      expect(store.getExtractionJob("job_queued")).toBeNull();
      expect(store.getExtractionJob("job_unrelated")).toEqual(expect.objectContaining({ status: "completed" }));
    } finally {
      store.close();
    }
    expect(lifecycleUpdates.filter((update) => update.jobId === "job_unrelated").map((update) => update.status))
      .toEqual(["processing", "completed"]);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function createJobs({
  sourceFiles,
  stateDirectory,
  workspaceId,
}: {
  sourceFiles: ReturnType<typeof createLocalSourceFileStore>;
  stateDirectory: string;
  workspaceId: string;
}) {
  const sourceFileKeys = {
    processing: await writeSource(sourceFiles, workspaceId, "job_processing", 1),
    queued: await writeSource(sourceFiles, workspaceId, "job_queued", 2),
    unrelated: await writeSource(sourceFiles, workspaceId, "job_unrelated", 3),
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
      ["job_processing", sourceFileKeys.processing],
      ["job_queued", sourceFileKeys.queued],
      ["job_unrelated", sourceFileKeys.unrelated],
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
  } finally {
    store.close();
  }
  return sourceFileKeys;
}

function job(jobId: string, workspaceId: string) {
  return {
    job_id: jobId,
    workspace_id: workspaceId,
    template_id: "tpl_invoice",
    template_version: 1,
    enqueued_at: "2026-07-10T12:00:00.000Z",
    attempt: 1,
  };
}

function deleteRequest(jobId: string, apiKey: string) {
  return new Request(`http://127.0.0.1:8787/v1/jobs/${jobId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

async function writeSource(
  sourceFiles: ReturnType<typeof createLocalSourceFileStore>,
  workspaceId: string,
  jobId: string,
  marker: number,
) {
  return sourceFiles.write({
    workspaceId,
    jobId,
    mimeType: "image/png",
    bytes: new Uint8Array([marker, 80, 78, 71]),
  });
}

function isJobAnalyticsEvent(event: LocalWorkspaceProductAnalyticsEvent, jobId: string): boolean {
  return (
    (event.type === "extraction_completed" || event.type === "extraction_failed") &&
    event.extractionJobId === jobId
  );
}
