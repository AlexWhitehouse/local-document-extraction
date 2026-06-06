import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { DocumentProcessingWorkflowParams } from "../lib/types";

type UnsupportedExtractionConfig =
  | "AI_GATEWAY_ACCOUNT_ID"
  | "AI_GATEWAY_PROVIDER"
  | "AI_GATEWAY_ROUTE"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY";
type EnvExcludesUnsupportedExtractionConfig = Extract<
  UnsupportedExtractionConfig,
  keyof Env
> extends never
  ? true
  : never;

const envExcludesUnsupportedExtractionConfig: EnvExcludesUnsupportedExtractionConfig = true;

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    env: unknown;

    constructor(_ctx: unknown, env: unknown) {
      this.env = env;
    }
  },
}));

vi.mock("./aiGateway", () => ({
  getAiGatewayId: (env: Env) => env.AI_GATEWAY_ID || "default",
  getExtractionModelName: (env: Env) => env.AI_MODEL || "google/gemini-3-flash",
  RetryableError: class RetryableError extends Error {},
  runExtraction: vi.fn(async () => [
    {
      field_id: "patient_name",
      status: "ok",
      answer: "Ada Lovelace",
    },
  ]),
}));

vi.mock("./modelResultNormalizer", () => ({
  normalizeModelResults: vi.fn(() => [
    {
      field_id: "patient_name",
      status: "ok",
      answer: "Ada Lovelace",
      normalized_value: "Ada Lovelace",
      confidence: null,
      evidence: null,
    },
  ]),
}));

const { DocumentProcessingWorkflow } = await import("./documentProcessingWorkflow");
const aiGateway = await import("./aiGateway");
const modelResultNormalizer = await import("./modelResultNormalizer");

type ProductStoreStub = {
  claimExtractionJobForProcessing: ReturnType<typeof vi.fn>;
  completeExtractionJob: ReturnType<typeof vi.fn>;
  failExtractionJob: ReturnType<typeof vi.fn>;
  markSourceFileCleaned: ReturnType<typeof vi.fn>;
};

type AnalyticsBindingStub = Env["WORKSPACE_PRODUCT_ANALYTICS"] & {
  writeDataPoint: ReturnType<typeof vi.fn>;
};

type JobRow = {
  id: string;
  workspace_id: string;
  template_id: string;
  template_version: number;
  status: string;
  source_file_key: string;
  source_mime_type: string;
  current_attempt: number;
  error_code: string | null;
  error_message: string | null;
  last_failed_attempt: number;
  image_deleted_at: string | null;
};

function createWorkflowFixture(options: { hasSource: boolean }) {
  const job: JobRow = {
    id: "job_test",
    workspace_id: "workspace_test",
    template_id: "template_test",
    template_version: 1,
    status: "queued",
    source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
    source_mime_type: "application/pdf",
    current_attempt: 0,
    error_code: null,
    error_message: null,
    last_failed_attempt: 0,
    image_deleted_at: null,
  };
  const results: Array<Record<string, unknown>> = [];
  const completedMetadata: Array<{ modelName: string; route: string }> = [];
  const deletedKeys: string[] = [];
  const requestedKeys: string[] = [];
  const requestedTemplateVersions: number[] = [];
  const productStore = createProductStoreStub();
  productStore.claimExtractionJobForProcessing.mockImplementation(async (input) => {
    if (job.id !== input.jobId || job.status !== "queued" || job.current_attempt >= Number(input.attempt)) {
      return null;
    }
    job.status = "processing";
    job.current_attempt = Number(input.attempt);
    job.error_code = null;
    job.error_message = null;
    requestedTemplateVersions.push(job.template_version);
    return {
      job_id: job.id,
      template_id: job.template_id,
      template_version: job.template_version,
      source_file_key: job.source_file_key,
      source_mime_type: job.source_mime_type,
      fields: [
        {
          id: "patient_name",
          name: "Patient Name",
          description: "Patient name",
          data_type: "string",
        },
      ],
    };
  });
  productStore.completeExtractionJob.mockImplementation(async (input) => {
    if (job.id !== input.jobId || job.status !== "processing" || job.current_attempt !== Number(input.attempt)) {
      return false;
    }
    input.results.forEach((row: {
      field_id: string;
      status: string;
      answer: unknown;
      normalized_value: string | null;
      confidence: number | null;
      evidence: string | null;
    }) => {
      results.push({
        job_id: input.jobId,
        field_id: row.field_id,
        status: row.status,
        answer_json: JSON.stringify(row.answer),
        normalized_value: row.normalized_value,
        confidence: row.confidence,
        evidence_text: row.evidence,
      });
    });
    job.status = "completed";
    job.current_attempt = Number(input.attempt);
    completedMetadata.push({ modelName: String(input.modelName), route: String(input.route) });
    return true;
  });
  productStore.failExtractionJob.mockImplementation(async (input) => {
    if (job.id !== input.jobId || job.status !== "processing" || job.current_attempt !== Number(input.attempt)) {
      return false;
    }
    job.status = "failed";
    job.error_code = String(input.errorCode);
    job.error_message = String(input.errorMessage);
    job.last_failed_attempt = Number(input.attempt);
    return true;
  });
  productStore.markSourceFileCleaned.mockImplementation(async (input) => {
    if (job.id !== input.jobId || job.source_file_key !== input.sourceFileKey) {
      return false;
    }
    job.image_deleted_at = String(input.cleanedAt);
    return true;
  });

  const env = {
    WORKSPACE_PRODUCT_STORE: {
      getByName: vi.fn((workspaceId: string) => {
        if (workspaceId !== job.workspace_id) {
          const missingStore = createProductStoreStub();
          missingStore.claimExtractionJobForProcessing.mockResolvedValue(null);
          return missingStore;
        }
        return productStore;
      }),
    },
    SOURCE_FILES_BUCKET: {
      async get(key: string) {
        requestedKeys.push(key);
        return options.hasSource
          ? { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
          : null;
      },
      async delete(key: string) {
        deletedKeys.push(key);
      },
    },
    AI_GATEWAY_ID: "configured-gateway",
    WORKSPACE_PRODUCT_ANALYTICS: undefined as Env["WORKSPACE_PRODUCT_ANALYTICS"] | undefined,
  };

  return { completedMetadata, deletedKeys, env, job, productStore, requestedKeys, requestedTemplateVersions, results };
}

function createWorkflowStep(options: { beforeStep?: (name: string) => void } = {}) {
  return {
    step: {
      async do(name: string, ...args: unknown[]) {
        options.beforeStep?.(name);
        const callback = args.at(-1) as () => Promise<unknown>;
        const result = await callback();
        return structuredClone(result);
      },
    },
  };
}

describe("DocumentProcessingWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes Extraction jobs through authoritative Workspace product data", async () => {
    const productStore = createProductStoreStub();
    productStore.claimExtractionJobForProcessing.mockResolvedValue({
      job_id: "job_test",
      template_id: "template_test",
      template_version: 3,
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      fields: [
        {
          id: "patient_name",
          name: "Patient Name",
          description: "Patient name",
          data_type: "string",
        },
      ],
    });
    productStore.completeExtractionJob.mockResolvedValue(true);
    const deletedKeys: string[] = [];
    const requestedKeys: string[] = [];
    const analytics = createAnalyticsBinding();
    const env = createProductStoreWorkflowEnv(productStore, {
      DB: {
        prepare() {
          throw new Error("legacy global D1 product tables should not be required for Workflow processing");
        },
      } as unknown as D1Database,
      SOURCE_FILES_BUCKET: {
        async get(key: string) {
          requestedKeys.push(key);
          return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        },
        async delete(key: string) {
          deletedKeys.push(key);
        },
      } as unknown as R2Bucket,
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env);

    await workflow.run(
      createWorkflowEvent({ job_id: "job_test", workspace_id: "workspace_test", attempt: 1 }),
      step as WorkflowStep,
    );

    expect(productStore.claimExtractionJobForProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job_test",
        attempt: 1,
      }),
    );
    expect(requestedKeys).toEqual(["workspaces/workspace_test/jobs/job_test/source.pdf"]);
    expect(productStore.completeExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job_test",
        attempt: 1,
        modelName: "google/gemini-3-flash",
        route: "configured-gateway",
        results: [
          {
            field_id: "patient_name",
            status: "ok",
            answer: "Ada Lovelace",
            normalized_value: "Ada Lovelace",
            confidence: null,
            evidence: null,
          },
        ],
      }),
    );
    expect(deletedKeys).toEqual(["workspaces/workspace_test/jobs/job_test/source.pdf"]);
    expect(analytics.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["workspace_test"],
        blobs: expect.arrayContaining([
          "extraction_completed",
          "workspace_test",
          "template_test",
          "job_test",
          "completed",
          "application/pdf",
          "google/gemini-3-flash",
        ]),
        doubles: expect.arrayContaining([1, 3]),
      }),
    );
    expect(JSON.stringify(analytics.writeDataPoint.mock.calls[0]?.[0])).not.toContain("Ada Lovelace");
  });

  it("does not persist uploaded file bytes as workflow step output", async () => {
    const { deletedKeys, env, job, results } = createWorkflowFixture({ hasSource: true });
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("completed");
    expect(results).toHaveLength(1);
    expect(modelResultNormalizer.normalizeModelResults).toHaveBeenCalledWith(
      [
        {
          id: "patient_name",
          name: "Patient Name",
          description: "Patient name",
          data_type: "string",
        },
      ],
      [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Ada Lovelace",
        },
      ],
    );
    expect(deletedKeys).toEqual([job.source_file_key]);
  });

  it("keeps Workflow completion successful when analytics emission fails", async () => {
    const { deletedKeys, env, job, results } = createWorkflowFixture({ hasSource: true });
    const analyticsError = new Error("analytics unavailable");
    env.WORKSPACE_PRODUCT_ANALYTICS = {
      writeDataPoint: vi.fn(() => {
        throw analyticsError;
      }),
    } as unknown as Env["WORKSPACE_PRODUCT_ANALYTICS"];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("completed");
    expect(results).toHaveLength(1);
    expect(deletedKeys).toEqual([job.source_file_key]);
    expect(consoleError).toHaveBeenCalledWith("Workspace product analytics emission failed", analyticsError);
    consoleError.mockRestore();
  });

  it("persists normalized Extraction results with confidence and evidence", async () => {
    const { env, job, results } = createWorkflowFixture({ hasSource: true });
    vi.mocked(aiGateway.runExtraction).mockResolvedValueOnce([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada L.",
        confidence: 0.51,
        evidence: "Raw model evidence",
      },
    ]);
    vi.mocked(modelResultNormalizer.normalizeModelResults).mockReturnValueOnce([
      {
        field_id: "patient_name",
        status: "ok",
        answer: "Ada Lovelace",
        normalized_value: "Ada Lovelace",
        confidence: 0.97,
        evidence: "Patient: Ada Lovelace",
      },
    ]);
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(results).toEqual([
      expect.objectContaining({
        job_id: job.id,
        field_id: "patient_name",
        status: "ok",
        answer_json: JSON.stringify("Ada Lovelace"),
        normalized_value: "Ada Lovelace",
        confidence: 0.97,
        evidence_text: "Patient: Ada Lovelace",
      }),
    ]);
  });

  it("records successful Source file cleanup in authoritative Workspace product data", async () => {
    const { deletedKeys, env, job, productStore } = createWorkflowFixture({ hasSource: true });
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(deletedKeys).toEqual([job.source_file_key]);
    expect(productStore.markSourceFileCleaned).toHaveBeenCalledWith({
      jobId: job.id,
      sourceFileKey: job.source_file_key,
      cleanedAt: expect.any(String),
    });
    expect(job.image_deleted_at).toEqual(expect.any(String));
  });

  it("keeps completed Extraction results when Source file cleanup fails", async () => {
    const { deletedKeys, env, job, results } = createWorkflowFixture({ hasSource: true });
    const cleanupError = new Error("R2 delete unavailable");
    env.SOURCE_FILES_BUCKET.delete = async (key: string) => {
      deletedKeys.push(key);
      throw cleanupError;
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    try {
      await workflow.run(
        createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
        step as WorkflowStep,
      );

      expect(job.status).toBe("completed");
      expect(job.error_code).toBeNull();
      expect(job.error_message).toBeNull();
      expect(results).toEqual([
        expect.objectContaining({
          job_id: job.id,
          field_id: "patient_name",
          status: "ok",
          answer_json: JSON.stringify("Ada Lovelace"),
        }),
      ]);
      expect(deletedKeys).toEqual([job.source_file_key]);
      expect(job.image_deleted_at).toBeNull();
      expect(consoleError).toHaveBeenCalledWith("R2 cleanup failed", cleanupError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses the Source file metadata returned by the Workspace product data claim", async () => {
    const { deletedKeys, env, job, requestedKeys } = createWorkflowFixture({ hasSource: true });
    const claimedSourceFileKey = job.source_file_key;
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(requestedKeys).toEqual([claimedSourceFileKey]);
    expect(deletedKeys).toEqual([claimedSourceFileKey]);
  });

  it("interprets Extraction results against the submitted Template version", async () => {
    const { env, job, requestedTemplateVersions } = createWorkflowFixture({ hasSource: true });
    job.template_version = 3;
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(requestedTemplateVersions).toEqual([3]);
    expect(job.status).toBe("completed");
  });

  it("persists the actual AI Gateway identifier used by extraction", async () => {
    const { completedMetadata, env, job } = createWorkflowFixture({ hasSource: true });
    env.AI_GATEWAY_ID = "actual-gateway";
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(completedMetadata).toEqual([
      { modelName: "google/gemini-3-flash", route: "actual-gateway" },
    ]);
  });

  it("marks the job failed when the Source file is missing", async () => {
    const { env, job } = createWorkflowFixture({ hasSource: false });
    const analytics = createAnalyticsBinding();
    env.WORKSPACE_PRODUCT_ANALYTICS = analytics;
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("failed");
    expect(job.error_code).toBe("missing_source_file");
    expect(job.error_message).toBe("Source file is missing from storage");
    expect(job.last_failed_attempt).toBe(1);
    expect(analytics.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["workspace_test"],
        blobs: expect.arrayContaining([
          "extraction_failed",
          "workspace_test",
          "template_test",
          "job_test",
          "failed",
          "missing_source_file",
          "application/pdf",
        ]),
        doubles: expect.arrayContaining([1]),
      }),
    );
    expect(JSON.stringify(analytics.writeDataPoint.mock.calls[0]?.[0])).not.toContain("Source file is missing from storage");
  });

  it("marks the job failed when permanent processing fails", async () => {
    const { env, job } = createWorkflowFixture({ hasSource: true });
    env.SOURCE_FILES_BUCKET.get = async (key: string) => {
      return {
        async arrayBuffer() {
          throw new Error(`Cannot read ${key}`);
        },
      };
    };
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("failed");
    expect(job.error_code).toBe("processing_error");
    expect(job.error_message).toContain("Cannot read");
    expect(job.last_failed_attempt).toBe(1);
  });

  it("lets Cloudflare Workflow retry transient extraction failures without writing a retryable durable status", async () => {
    const { env, job } = createWorkflowFixture({ hasSource: true });
    vi.mocked(aiGateway.runExtraction).mockRejectedValueOnce(
      new aiGateway.RetryableError("AI gateway rate limited"),
    );
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await expect(
      workflow.run(
        createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
        step as WorkflowStep,
      ),
    ).rejects.toThrow("AI gateway rate limited");

    expect(job.status).toBe("processing");
    expect(job.status).not.toBe("retryable_failed");
    expect(job.error_code).toBeNull();
    expect(job.error_message).toBeNull();
  });

  it("stops safely when the Extraction job record is missing", async () => {
    const { env, job, requestedKeys, results } = createWorkflowFixture({ hasSource: true });
    const { step } = createWorkflowStep();
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: "missing_workspace", attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("queued");
    expect(requestedKeys).toEqual([]);
    expect(results).toEqual([]);
  });
});

function createProductStoreStub(): ProductStoreStub {
  return {
    claimExtractionJobForProcessing: vi.fn(),
    completeExtractionJob: vi.fn(),
    failExtractionJob: vi.fn(),
    markSourceFileCleaned: vi.fn(),
  };
}

function createProductStoreWorkflowEnv(productStore: ProductStoreStub, overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    WORKSPACE_PRODUCT_STORE: {
      getByName: vi.fn(() => productStore),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"],
    SOURCE_FILES_BUCKET: {
      get: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    } as unknown as R2Bucket,
    AI_GATEWAY_ID: "configured-gateway",
    ...overrides,
  } as Env;
}

function createAnalyticsBinding(): AnalyticsBindingStub {
  return {
    writeDataPoint: vi.fn(),
  } as unknown as AnalyticsBindingStub;
}

function createWorkflowEvent(payload: DocumentProcessingWorkflowParams): WorkflowEvent<DocumentProcessingWorkflowParams> {
  return {
    instanceId: `${payload.job_id}-attempt-${payload.attempt}`,
    payload,
    timestamp: new Date("2026-05-05T00:00:00.000Z"),
    workflowName: "document-processing-workflow",
  };
}
