import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalExtractionRunner } from "./localExtractionRunner";
import { RetryableError } from "./consumer/modelGateway";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("runner startup recovers queued jobs across local Workspace product stores", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-runner-recovery-"));
  const scheduledJobs: Array<{ job_id: string; workspace_id: string; attempt: number }> = [];
  const workspaces = ["workspace_research", "workspace_legal"];

  try {
    for (const workspaceId of workspaces) {
      const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
      try {
        store.createTemplate({
          templateId: "tpl_invoice",
          name: "Invoice",
          description: "Extract invoice details.",
          fields: [
            { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
          ],
          createdAt: "2026-07-09T12:00:00.000Z",
        });
        store.createQueuedExtractionJob({
          jobId: `job_${workspaceId}`,
          templateId: "tpl_invoice",
          templateVersion: 1,
          sourceFileKey: `workspaces/${workspaceId}/jobs/job_${workspaceId}/source.png`,
          sourceMimeType: "image/png",
          sourceName: "invoice.png",
          sourceFilePageCount: null,
          submittedAt: "2026-07-09T12:01:00.000Z",
        });
      } finally {
        store.close();
      }
    }

    const runner = createLocalExtractionRunner({
      scheduleJob: async (job) => {
        scheduledJobs.push({ ...job, attempt: job.attempt ?? 1 });
      },
      stateDirectory,
    });
    await runner.recover();

    expect(scheduledJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ job_id: "job_workspace_research", workspace_id: "workspace_research", attempt: 1 }),
      expect.objectContaining({ job_id: "job_workspace_legal", workspace_id: "workspace_legal", attempt: 1 }),
    ]));
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("runner startup requeues stale processing work and stops jobs that exhaust their retry attempts", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-stale-runner-"));
  const workspaceId = "workspace_research";
  const scheduledJobs: Array<{ job_id: string; attempt: number }> = [];
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });

  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    for (const jobId of ["job_stale", "job_exhausted"]) {
      store.createQueuedExtractionJob({
        jobId,
        templateId: "tpl_invoice",
        templateVersion: 1,
        sourceFileKey: `workspaces/${workspaceId}/jobs/${jobId}/source.png`,
        sourceMimeType: "image/png",
        sourceName: "invoice.png",
        sourceFilePageCount: null,
        submittedAt: "2026-07-09T12:01:00.000Z",
      });
      store.claimExtractionJobForProcessing({
        jobId,
        attempt: 1,
        claimedAt: "2020-01-01T00:00:00.000Z",
      });
    }

    const runner = createLocalExtractionRunner({
      maxAttempts: 2,
      scheduleJob: async (job) => {
        scheduledJobs.push({ job_id: job.job_id, attempt: job.attempt ?? 1 });
      },
      staleProcessingAfterMs: 0,
      stateDirectory,
    });
    await runner.recover();
    expect(scheduledJobs).toEqual(expect.arrayContaining([
      { job_id: "job_stale", attempt: 2 },
      { job_id: "job_exhausted", attempt: 2 },
    ]));
    expect(store.getExtractionJob("job_stale")).toMatchObject({ status: "queued", current_attempt: 1 });

    store.claimExtractionJobForProcessing({
      jobId: "job_exhausted",
      attempt: 2,
      claimedAt: "2020-01-01T00:00:00.000Z",
    });
    await runner.recover();
    expect(store.getExtractionJob("job_exhausted")).toMatchObject({
      status: "failed",
      error_code: "retry_exhausted",
      last_failed_attempt: 2,
    });
  } finally {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("recovery selects ready queued jobs ahead of older deferred retries", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-ready-recovery-"));
  const workspaceId = "workspace_research";
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });

  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    for (const [jobId, requeuedAt, nextRetryAt] of [
      ["job_deferred_first", "2026-07-09T12:03:00.000Z", "2026-07-09T20:00:00.000Z"],
      ["job_deferred_second", "2026-07-09T12:04:00.000Z", "2026-07-09T21:00:00.000Z"],
    ] as const) {
      store.createQueuedExtractionJob({
        jobId,
        templateId: "tpl_invoice",
        templateVersion: 1,
        sourceFileKey: `workspaces/${workspaceId}/jobs/${jobId}/source.png`,
        sourceMimeType: "image/png",
        sourceName: "invoice.png",
        sourceFilePageCount: null,
        submittedAt: "2026-07-09T12:01:00.000Z",
      });
      store.claimExtractionJobForProcessing({
        jobId,
        attempt: 1,
        claimedAt: "2026-07-09T12:02:00.000Z",
      });
      store.requeueExtractionJob({
        jobId,
        attempt: 1,
        requeuedAt,
        errorCode: "model_gateway_retry",
        errorMessage: "Temporary failure",
        nextRetryAt,
      });
    }
    store.createQueuedExtractionJob({
      jobId: "job_ready",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey: `workspaces/${workspaceId}/jobs/job_ready/source.png`,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:05:00.000Z",
    });

    const recovered = store.recoverExtractionJobs({
      limit: 2,
      maxAttempts: 3,
      recoveredAt: "2026-07-09T13:00:00.000Z",
      staleProcessingBefore: "2026-07-09T11:00:00.000Z",
    });

    expect(recovered.map((job) => job.job_id)).toEqual(["job_ready", "job_deferred_first"]);
  } finally {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("runner retries transient model failures within bounds and protects terminal jobs from duplicate attempts", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-retry-runner-"));
  const workspaceId = "workspace_research";
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const scheduledJobs: Array<{ job_id: string; attempt: number }> = [];

  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: "job_retry",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    store.createQueuedExtractionJob({
      jobId: "job_retry",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:01:00.000Z",
    });
    let modelCalls = 0;
    const runner = createLocalExtractionRunner({
      extract: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          throw new RetryableError("Temporary LiteLLM failure");
        }
        return [{ field_id: "invoice_number", status: "ok", answer: "INV-001" }];
      },
      modelGatewayConfiguration: {
        AI_MODEL: "retry/model",
        MODEL_GATEWAY_URL: "https://retry-gateway.example/v1",
      },
      maxAttempts: 2,
      scheduleJob: async (job) => {
        scheduledJobs.push({ job_id: job.job_id, attempt: job.attempt ?? 1 });
      },
      sourceFileStore: sourceFiles,
      stateDirectory,
    });
    const firstAttempt = {
      job_id: "job_retry",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-09T12:01:00.000Z",
      attempt: 1,
    };
    await runner.run(firstAttempt);
    expect(store.getExtractionJob("job_retry")).toMatchObject({
      status: "queued",
      current_attempt: 1,
      last_failed_attempt: 1,
      error_code: "model_gateway_retry",
      model_name: "retry/model",
    });
    expect(scheduledJobs).toEqual([{ job_id: "job_retry", attempt: 2 }]);

    await runner.run({ ...firstAttempt, attempt: 2 });
    expect(store.getExtractionJob("job_retry")).toMatchObject({
      status: "completed",
      current_attempt: 2,
      completed_attempt: 2,
    });
    await runner.run({ ...firstAttempt, attempt: 2 });
    expect(store.getExtractionJob("job_retry")).toMatchObject({
      status: "completed",
      completed_attempt: 2,
    });
  } finally {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("runner schedules a retry no earlier than the configured retry delay", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-retry-delay-"));
  const workspaceId = "workspace_research";
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const scheduledJobs: Array<{ attempt: number; not_before?: string }> = [];

  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
      ],
      createdAt: "2026-07-10T20:00:00.000Z",
    });
    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: "job_retry_delay",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    store.createQueuedExtractionJob({
      jobId: "job_retry_delay",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-10T20:00:00.000Z",
    });
    let modelCalls = 0;
    const runner = createLocalExtractionRunner({
      extract: async () => {
        modelCalls += 1;
        throw new RetryableError("LiteLLM request terminated");
      },
      maxAttempts: 2,
      now: () => "2026-07-10T20:01:00.000Z",
      random: () => 1,
      retryDelayMs: 15 * 60 * 1000,
      scheduleJob: async (job) => {
        scheduledJobs.push({
          attempt: job.attempt ?? 1,
          not_before: job.not_before,
        });
      },
      sourceFileStore: sourceFiles,
      stateDirectory,
    });

    await runner.run({
      job_id: "job_retry_delay",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-10T20:00:00.000Z",
      attempt: 1,
    });

    expect(scheduledJobs).toEqual([{
      attempt: 2,
      not_before: "2026-07-10T20:16:00.000Z",
    }]);

    await runner.run({
      job_id: "job_retry_delay",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-10T20:01:00.000Z",
      attempt: 2,
    });
    expect(modelCalls).toBe(1);

    scheduledJobs.length = 0;
    await runner.recover();
    expect(scheduledJobs).toEqual([{
      attempt: 2,
      not_before: "2026-07-10T20:16:00.000Z",
    }]);
  } finally {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
