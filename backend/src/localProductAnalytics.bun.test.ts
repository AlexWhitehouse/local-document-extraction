import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalProductAnalytics } from "./localProductAnalytics";

test("local product analytics appends whitelisted events to daily JSONL files", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-analytics-"));
  const timestamps = [
    new Date("2026-07-09T12:00:00.000Z"),
    new Date("2026-07-10T08:30:00.000Z"),
  ];
  const analytics = createLocalProductAnalytics({
    now: () => timestamps.shift() ?? new Date("2026-07-10T08:30:00.000Z"),
    stateDirectory,
  });

  try {
    analytics.record({
      type: "document_submitted",
      workspaceId: "workspace_research",
      templateId: "tpl_invoice",
      templateVersion: 2,
      extractionJobId: "job_invoice",
      status: "queued",
      attempt: 1,
      sourceMimeType: "application/pdf",
      sourceByteSize: 2048,
    });
    analytics.record({
      type: "extraction_completed",
      workspaceId: "workspace_research",
      templateId: "tpl_invoice",
      templateVersion: 2,
      extractionJobId: "job_invoice",
      status: "completed",
      attempt: 1,
      sourceMimeType: "application/pdf",
      sourceByteSize: 2048,
      modelName: "local-model",
      fieldCount: 3,
    });
    await analytics.flush();

    const submittedLines = (await readFile(join(stateDirectory, "analytics", "2026-07-09.jsonl"), "utf8")).trim().split("\n");
    expect(submittedLines).toHaveLength(1);
    expect(JSON.parse(submittedLines[0]!)).toEqual({
      occurred_at: "2026-07-09T12:00:00.000Z",
      type: "document_submitted",
      workspace_id: "workspace_research",
      template_id: "tpl_invoice",
      template_version: 2,
      extraction_job_id: "job_invoice",
      status: "queued",
      attempt: 1,
      source_mime_type: "application/pdf",
      source_byte_size: 2048,
    });

    const completedLines = (await readFile(join(stateDirectory, "analytics", "2026-07-10.jsonl"), "utf8")).trim().split("\n");
    expect(completedLines).toHaveLength(1);
    expect(JSON.parse(completedLines[0]!)).toMatchObject({
      occurred_at: "2026-07-10T08:30:00.000Z",
      type: "extraction_completed",
      extraction_job_id: "job_invoice",
      model_name: "local-model",
      field_count: 3,
    });
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local product analytics serializes only the approved privacy-safe fields", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-analytics-privacy-"));
  const analytics = createLocalProductAnalytics({
    now: () => new Date("2026-07-09T12:00:00.000Z"),
    stateDirectory,
  });

  try {
    analytics.record({
      type: "extraction_failed",
      workspaceId: "workspace_research",
      templateId: "tpl_invoice",
      templateVersion: 2,
      extractionJobId: "job_invoice",
      status: "failed",
      attempt: 2,
      sourceMimeType: "image/png",
      errorCode: "processing_error",
      fieldCount: 3,
      sourceName: "customer-invoice.png",
      accountEmail: "ada@example.com",
      apiKey: "workspace_secret_key",
      answer: "INV-001",
      evidence: "Invoice number is INV-001",
      sourceBytes: "binary document contents",
    } as never);
    await analytics.flush();

    const content = await readFile(join(stateDirectory, "analytics", "2026-07-09.jsonl"), "utf8");
    expect(JSON.parse(content)).toEqual({
      occurred_at: "2026-07-09T12:00:00.000Z",
      type: "extraction_failed",
      workspace_id: "workspace_research",
      template_id: "tpl_invoice",
      template_version: 2,
      extraction_job_id: "job_invoice",
      status: "failed",
      attempt: 2,
      source_mime_type: "image/png",
      error_code: "processing_error",
      field_count: 3,
    });
    expect(content).not.toContain("customer-invoice.png");
    expect(content).not.toContain("ada@example.com");
    expect(content).not.toContain("workspace_secret_key");
    expect(content).not.toContain("INV-001");
    expect(content).not.toContain("binary document contents");
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local product analytics warnings do not fail the product operation that emitted an event", async () => {
  const warnings: Array<{ message: string; error: unknown }> = [];
  const analytics = createLocalProductAnalytics({
    append: async () => {
      throw new Error("local disk unavailable");
    },
    logger: {
      warn: (message, error) => warnings.push({ message, error }),
    },
    stateDirectory: "/unavailable-state-directory",
  });

  expect(() => analytics.record({
    type: "template_created",
    workspaceId: "workspace_research",
    templateId: "tpl_invoice",
    templateVersion: 1,
    status: "active",
    fieldCount: 3,
  })).not.toThrow();
  await analytics.flush();

  expect(warnings).toEqual([
    expect.objectContaining({
      message: "Local product analytics write failed",
      error: expect.any(Error),
    }),
  ]);
});
