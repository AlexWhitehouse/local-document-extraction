import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

import type { Env, ImageWorkflowParams } from "../lib/types";

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    env: unknown;

    constructor(_ctx: unknown, env: unknown) {
      this.env = env;
    }
  },
}));

vi.mock("./aiGateway", () => ({
  RetryableError: class RetryableError extends Error {},
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
  runExtraction: vi.fn(async () => [
    {
      field_id: "patient_name",
      status: "ok",
      answer: "Ada Lovelace",
    },
  ]),
}));

const { ImageProcessingWorkflow } = await import("./imageProcessingWorkflow");
const aiGateway = await import("./aiGateway");

type JobRow = {
  id: string;
  workspace_id: string;
  template_id: string;
  template_version: number;
  status: string;
  image_r2_key: string;
  image_mime_type: string;
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
    image_r2_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
    image_mime_type: "application/pdf",
    current_attempt: 0,
    error_code: null,
    error_message: null,
    last_failed_attempt: 0,
    image_deleted_at: null,
  };
  const results: Array<Record<string, unknown>> = [];
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
                    image_r2_key: job.image_r2_key,
                    image_mime_type: job.image_mime_type,
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
                  const [jobId, fieldId, status, answerJson, normalizedValue] = params;
                  results.push({ job_id: jobId, field_id: fieldId, status, answer_json: answerJson, normalized_value: normalizedValue });
                  return { meta: { changes: 1 } };
                }

                if (sql.includes("SET status = 'completed'")) {
                  const [_completedAt, _updatedAt, _modelName, _route, attempt, jobId] = params;
                  if (job.id === jobId) {
                    job.status = "completed";
                    job.current_attempt = Number(attempt);
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
    IMAGES_BUCKET: {
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
    AI_GATEWAY_ROUTE: "default",
  };

  return { deletedKeys, env, job, requestedKeys, requestedTemplateVersions, results };
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

describe("ImageProcessingWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not persist uploaded file bytes as workflow step output", async () => {
    const { deletedKeys, env, job, results } = createWorkflowFixture({ hasSource: true });
    const { step } = createWorkflowStep();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("completed");
    expect(results).toHaveLength(1);
    expect(deletedKeys).toEqual([job.image_r2_key]);
    expect(job.image_deleted_at).toEqual(expect.any(String));
  });

  it("keeps completed Extraction results when Source file cleanup fails", async () => {
    const { deletedKeys, env, job, results } = createWorkflowFixture({ hasSource: true });
    const cleanupError = new Error("R2 delete unavailable");
    env.IMAGES_BUCKET.delete = async (key: string) => {
      deletedKeys.push(key);
      throw cleanupError;
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { step } = createWorkflowStep();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

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
      expect(deletedKeys).toEqual([job.image_r2_key]);
      expect(job.image_deleted_at).toBeNull();
      expect(consoleError).toHaveBeenCalledWith("R2 cleanup failed", cleanupError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reloads job state inside later workflow steps instead of capturing loaded job state", async () => {
    const { deletedKeys, env, job, requestedKeys } = createWorkflowFixture({ hasSource: true });
    const initialImageKey = job.image_r2_key;
    const freshImageKey = "workspaces/workspace_test/jobs/job_test/fresh-source.pdf";
    const { step } = createWorkflowStep({
      beforeStep(name) {
        if (name === "extract and persist") {
          job.image_r2_key = freshImageKey;
        }
      },
    });
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(requestedKeys).toEqual([freshImageKey]);
    expect(deletedKeys).toEqual([freshImageKey]);
    expect(deletedKeys).not.toContain(initialImageKey);
  });

  it("interprets Extraction results against the submitted Template version", async () => {
    const { env, job, requestedTemplateVersions } = createWorkflowFixture({ hasSource: true });
    job.template_version = 3;
    const { step } = createWorkflowStep();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(requestedTemplateVersions).toEqual([3]);
    expect(job.status).toBe("completed");
  });

  it("marks the job failed when the Source file is missing", async () => {
    const { env, job } = createWorkflowFixture({ hasSource: false });
    const { step } = createWorkflowStep();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

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
    env.IMAGES_BUCKET.get = async (key: string) => {
      return {
        async arrayBuffer() {
          throw new Error(`Cannot read ${key}`);
        },
      };
    };
    const { step } = createWorkflowStep();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

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
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

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
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: "missing_workspace", attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("queued");
    expect(requestedKeys).toEqual([]);
    expect(results).toEqual([]);
  });
});

function createWorkflowEvent(payload: ImageWorkflowParams): WorkflowEvent<ImageWorkflowParams> {
  return {
    instanceId: `${payload.job_id}-attempt-${payload.attempt}`,
    payload,
    timestamp: new Date("2026-05-05T00:00:00.000Z"),
  };
}
