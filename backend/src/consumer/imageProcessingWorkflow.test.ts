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
};

function createWorkflowFixture(options: { hasSource: boolean }) {
  const job: JobRow = {
    id: "job_test",
    workspace_id: "workspace_test",
    template_id: "template_test",
    template_version: 1,
    status: "workflow_started",
    image_r2_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
    image_mime_type: "application/pdf",
    current_attempt: 0,
    error_code: null,
    error_message: null,
    last_failed_attempt: 0,
  };
  const results: Array<Record<string, unknown>> = [];
  const deletedKeys: string[] = [];

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
                  if (job.id === jobId && ["queued", "workflow_started"].includes(job.status) && job.current_attempt < Number(maxAttempt)) {
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
      async get() {
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

  return { deletedKeys, env, job, results };
}

function createStepRecorder() {
  const names: string[] = [];
  return {
    names,
    step: {
      async do(name: string, ...args: unknown[]) {
        names.push(name);
        const callback = args.at(-1) as () => Promise<unknown>;
        return await callback();
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
    const { names, step } = createStepRecorder();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(names).toEqual(["load job", "claim job", "load template fields", "extract and persist", "cleanup source file"]);
    expect(job.status).toBe("completed");
    expect(results).toHaveLength(1);
    expect(deletedKeys).toEqual([job.image_r2_key]);
  });

  it("marks the job failed when the uploaded source is missing", async () => {
    const { env, job } = createWorkflowFixture({ hasSource: false });
    const { step } = createStepRecorder();
    const workflow = new ImageProcessingWorkflow({} as ExecutionContext<unknown>, env as unknown as Env);

    await workflow.run(
      createWorkflowEvent({ job_id: job.id, workspace_id: job.workspace_id, attempt: 1 }),
      step as WorkflowStep,
    );

    expect(job.status).toBe("failed");
    expect(job.error_code).toBe("missing_image");
    expect(job.error_message).toBe("Source image is missing from R2");
    expect(job.last_failed_attempt).toBe(1);
  });
});

function createWorkflowEvent(payload: ImageWorkflowParams): WorkflowEvent<ImageWorkflowParams> {
  return {
    instanceId: `${payload.job_id}-attempt-${payload.attempt}`,
    payload,
    timestamp: new Date("2026-05-05T00:00:00.000Z"),
  };
}
