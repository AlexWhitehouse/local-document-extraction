import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env, DocumentProcessingWorkflowParams } from "../lib/types";

type UnsupportedExtractionConfig =
  | "AI_GATEWAY_ACCOUNT_ID"
  | "AI_GATEWAY_PROVIDER"
  | "AI_GATEWAY_ROUTE"
  | "AI_GATEWAY_TOKEN"
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

  const env = {
    DB: {
      async batch(statements: D1PreparedStatement[]) {
        await Promise.all(statements.map((statement) => statement.run()));
        return [];
      },
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async first() {
                if (sql.includes("FROM jobs")) {
                  const [jobId, workspaceId] = params;
                  if (params.length === 1) {
                    return job.id === jobId
                      ? {
                          status: job.status,
                          current_attempt: job.current_attempt,
                        }
                      : null;
                  }
                  if (job.id !== jobId || job.workspace_id !== workspaceId) {
                    return null;
                  }
                  return {
                    template_id: job.template_id,
                    template_version: job.template_version,
                    source_file_key: job.source_file_key,
                    source_mime_type: job.source_mime_type,
                  };
                }

                throw new Error(`Unhandled first SQL: ${sql}`);
              },
              async all() {
                if (sql.includes("FROM template_fields")) {
                  const [_templateId, templateVersion] = params;
                  requestedTemplateVersions.push(Number(templateVersion));
                  return {
                    results: [
                      {
                        field_id: "patient_name",
                        name: "Patient Name",
                        description: "Patient name",
                        data_type: "string",
                        required: 1,
                      },
                    ],
                  };
                }

                throw new Error(`Unhandled all SQL: ${sql}`);
              },
              async run() {
                if (sql.includes("SET status = 'processing'")) {
                  const [_updatedAt, _workflowStartedAt, attempt, jobId, maxAttempt] = params;
                  if (job.id === jobId && job.status === "queued" && job.current_attempt < Number(maxAttempt)) {
                    job.status = "processing";
                    job.current_attempt = Number(attempt);
                    job.error_code = null;
                    job.error_message = null;
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }

                if (sql.includes("INSERT INTO job_results")) {
                  const [jobId, fieldId, status, answerJson, normalizedValue, confidence, evidenceText] = params;
                  results.push({
                    job_id: jobId,
                    field_id: fieldId,
                    status,
                    answer_json: answerJson,
                    normalized_value: normalizedValue,
                    confidence,
                    evidence_text: evidenceText,
                  });
                  return { meta: { changes: 1 } };
                }

                if (sql.includes("SET status = 'completed'")) {
                  const [_completedAt, _updatedAt, modelName, route, attempt, jobId] = params;
                  if (job.id === jobId) {
                    job.status = "completed";
                    job.current_attempt = Number(attempt);
                    completedMetadata.push({ modelName: String(modelName), route: String(route) });
                  }
                  return { meta: { changes: 1 } };
                }

                if (sql.includes("SET image_deleted_at")) {
                  const [deletedAt, _updatedAt, jobId] = params;
                  if (job.id === jobId) {
                    job.image_deleted_at = String(deletedAt);
                  }
                  return { meta: { changes: 1 } };
                }

                if (sql.includes("SET status = 'failed'")) {
                  const [code, message, _updatedAt, attempt, jobId] = params;
                  if (job.id === jobId) {
                    job.status = "failed";
                    job.error_code = String(code);
                    job.error_message = String(message);
                    job.last_failed_attempt = Number(attempt);
                  }
                  return { meta: { changes: 1 } };
                }

                throw new Error(`Unhandled run SQL: ${sql}`);
              },
            };
          },
        };
      },
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
  };

  return { completedMetadata, deletedKeys, env, job, requestedKeys, requestedTemplateVersions, results };
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
          required: true,
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
    expect(job.image_deleted_at).toEqual(expect.any(String));
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

  it("reloads job state inside later workflow steps instead of capturing loaded job state", async () => {
    const { deletedKeys, env, job, requestedKeys } = createWorkflowFixture({ hasSource: true });
    const initialSourceFileKey = job.source_file_key;
    const freshSourceFileKey = "workspaces/workspace_test/jobs/job_test/fresh-source.pdf";
    const { step } = createWorkflowStep({
      beforeStep(name) {
        if (name === "extract and persist") {
          job.source_file_key = freshSourceFileKey;
        }
      },
    });
    const workflow = new DocumentProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(requestedKeys).toEqual([freshSourceFileKey]);
    expect(deletedKeys).toEqual([freshSourceFileKey]);
    expect(deletedKeys).not.toContain(initialSourceFileKey);
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

function createWorkflowEvent(payload: DocumentProcessingWorkflowParams): WorkflowEvent<DocumentProcessingWorkflowParams> {
  return {
    instanceId: `${payload.job_id}-attempt-${payload.attempt}`,
    payload,
    timestamp: new Date("2026-05-05T00:00:00.000Z"),
  };
}
