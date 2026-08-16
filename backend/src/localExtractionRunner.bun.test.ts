import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import type { ModelGatewayConfiguration } from "./consumer/modelGateway";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("the local extraction runner completes a queued job with normalized results and Source file cleanup", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-local-runner-"));
  const workspaceId = "workspace_research";
  const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });

  try {
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "total_amount", name: "Total Amount", description: "Invoice total.", data_type: "number" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: "job_invoice",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_invoice",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:01:00.000Z",
    });

    const runner = createLocalExtractionRunner({
      extract: async () => [
        { field_id: "total_amount", status: "ok", answer: "£12.50", confidence: 0.9, evidence: "Total due" },
      ],
      sourceFileStore: sourceFiles,
      stateDirectory,
    });
    await runner.run({
      job_id: "job_invoice",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-09T12:01:00.000Z",
    });

    expect(productStore.getExtractionJob("job_invoice")).toMatchObject({
      job_id: "job_invoice",
      status: "completed",
      completed_attempt: 1,
      results: [
        {
          field_id: "total_amount",
          name: "Total Amount",
          data_type: "number",
          status: "ok",
          answer: 12.5,
          confidence: 0.9,
          evidence: "Total due",
        },
      ],
    });
    expect(await sourceFiles.read(sourceFileKey)).toBeNull();
  } finally {
    productStore.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("the local extraction runner resolves current model settings for each extraction attempt", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-dynamic-model-"));
  const workspaceId = "workspace_dynamic_model";
  const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  let activeModelConfiguration: ModelGatewayConfiguration = {
    AI_MODEL: "initial/model",
    MODEL_GATEWAY_URL: "https://initial-gateway.example/v1",
  };

  try {
    productStore.createTemplate({
      templateId: "tpl_dynamic",
      name: "Dynamic model",
      description: null,
      fields: [
        { id: "reference", name: "Reference", description: "Document reference.", data_type: "string" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: "job_dynamic",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_dynamic",
      templateId: "tpl_dynamic",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "dynamic.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:01:00.000Z",
    });

    const runner = createLocalExtractionRunner({
      extract: async () => [
        { field_id: "reference", status: "ok", answer: "REF-1", confidence: 1, evidence: "REF-1" },
      ],
      modelGatewayConfiguration: {
        AI_MODEL: "captured/model",
        MODEL_GATEWAY_URL: "https://captured-gateway.example/v1",
      },
      modelGatewayConfigurationProvider: () => activeModelConfiguration,
      productAnalytics: {
        flush: async () => {},
        record: (event) => analyticsEvents.push(event),
      },
      sourceFileStore: sourceFiles,
      stateDirectory,
    });

    activeModelConfiguration = {
      AI_MODEL: "updated/model",
      MODEL_GATEWAY_URL: "http://127.0.0.1:11434/v1",
    };
    await runner.run({
      job_id: "job_dynamic",
      workspace_id: workspaceId,
      template_id: "tpl_dynamic",
      template_version: 1,
      enqueued_at: "2026-07-09T12:01:00.000Z",
    });

    expect(analyticsEvents).toEqual([
      expect.objectContaining({
        type: "extraction_completed",
        extractionJobId: "job_dynamic",
        modelName: "updated/model",
      }),
    ]);
    expect(productStore.getExtractionJob("job_dynamic")).toMatchObject({
      model_name: "updated/model",
    });
    const database = new Database(
      join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`),
      { readonly: true },
    );
    try {
      expect(database.query(
        "SELECT model_name, model_gateway_route FROM jobs WHERE id = ?",
      ).get("job_dynamic")).toEqual({
        model_name: "updated/model",
        model_gateway_route: "127.0.0.1",
      });
    } finally {
      database.close();
    }
  } finally {
    productStore.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("the local extraction runner records durable failures for missing Source files and model errors", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-local-runner-failures-"));
  const workspaceId = "workspace_research";
  const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  const productAnalytics: LocalProductAnalytics = {
    flush: async () => {},
    record: (event) => analyticsEvents.push(event),
  };

  try {
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "total_amount", name: "Total Amount", description: "Invoice total.", data_type: "number" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_missing_source",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey: "workspaces/workspace_research/jobs/job_missing_source/source.png",
      sourceMimeType: "image/png",
      sourceName: "missing.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:01:00.000Z",
    });
    const modelSourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: "job_model_failure",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_model_failure",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey: modelSourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:02:00.000Z",
    });

    const runner = createLocalExtractionRunner({
      extract: async () => {
        throw new Error("LiteLLM is unavailable");
      },
      modelGatewayConfiguration: {
        AI_MODEL: "failure/model",
        MODEL_GATEWAY_URL: "https://failure-gateway.example/v1",
      },
      productAnalytics,
      sourceFileStore: sourceFiles,
      stateDirectory,
    });
    await runner.run({
      job_id: "job_missing_source",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-09T12:01:00.000Z",
    });
    await runner.run({
      job_id: "job_model_failure",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-09T12:02:00.000Z",
    });

    expect(productStore.getExtractionJob("job_missing_source")).toMatchObject({
      status: "failed",
      error_code: "missing_source_file",
      error_message: "Source file is missing from local storage",
      model_name: null,
      results: [],
    });
    expect(productStore.getExtractionJob("job_model_failure")).toMatchObject({
      status: "failed",
      error_code: "processing_error",
      error_message: "LiteLLM is unavailable",
      model_name: "failure/model",
      results: [],
    });
    expect(await sourceFiles.read(modelSourceFileKey)).not.toBeNull();
    expect(analyticsEvents).toEqual([
      expect.objectContaining({
        type: "extraction_failed",
        extractionJobId: "job_missing_source",
        errorCode: "missing_source_file",
      }),
      expect.objectContaining({
        type: "extraction_failed",
        extractionJobId: "job_model_failure",
        errorCode: "processing_error",
      }),
    ]);
  } finally {
    productStore.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("a Source file cleanup failure leaves completed results intact", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-local-runner-cleanup-"));
  const workspaceId = "workspace_research";
  const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [
        { id: "total_amount", name: "Total Amount", description: "Invoice total.", data_type: "number" },
      ],
      createdAt: "2026-07-09T12:00:00.000Z",
    });
    const sourceFileKey = await sourceFiles.write({
      workspaceId,
      jobId: "job_cleanup_failure",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    productStore.createQueuedExtractionJob({
      jobId: "job_cleanup_failure",
      templateId: "tpl_invoice",
      templateVersion: 1,
      sourceFileKey,
      sourceMimeType: "image/png",
      sourceName: "invoice.png",
      sourceFilePageCount: null,
      submittedAt: "2026-07-09T12:01:00.000Z",
    });

    const runner = createLocalExtractionRunner({
      extract: async () => [
        { field_id: "total_amount", status: "ok", answer: 12.5 },
      ],
      sourceFileStore: {
        delete: async () => {
          throw new Error("Disk unavailable");
        },
        eraseWorkspace: async () => {},
        read: sourceFiles.read,
        write: sourceFiles.write,
      },
      stateDirectory,
    });
    await runner.run({
      job_id: "job_cleanup_failure",
      workspace_id: workspaceId,
      template_id: "tpl_invoice",
      template_version: 1,
      enqueued_at: "2026-07-09T12:01:00.000Z",
    });

    expect(productStore.getExtractionJob("job_cleanup_failure")).toMatchObject({
      status: "completed",
      results: [expect.objectContaining({ field_id: "total_amount", answer: 12.5 })],
    });
    expect(await sourceFiles.read(sourceFileKey)).not.toBeNull();
  } finally {
    console.error = originalConsoleError;
    productStore.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
