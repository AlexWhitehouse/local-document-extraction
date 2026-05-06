import { describe, expect, it } from "vitest";

import type { Env, QueueJobMessage } from "../lib/types";
import { processJob } from "./processJob";

function createProcessJobFixture() {
  const statusWrites: string[] = [];
  const job = {
    id: "job_test",
    workspace_id: "workspace_test",
    status: "queued",
    error_code: null as string | null,
    error_message: null as string | null,
    workflow_instance_id: null as string | null,
  };

  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async first() {
                if (sql.includes("FROM jobs")) {
                  const [jobId, workspaceId] = params;
                  return job.id === jobId && job.workspace_id === workspaceId
                    ? { id: job.id, status: job.status }
                    : null;
                }

                throw new Error(`Unhandled first SQL: ${sql}`);
              },
              async run() {
                if (sql.includes("workflow_instance_id = ?")) {
                  const [_updatedAt, workflowInstanceId, jobId] = params;
                  if (job.id === jobId && ["queued", "failed"].includes(job.status)) {
                    job.error_code = null;
                    job.error_message = null;
                    job.workflow_instance_id = String(workflowInstanceId);
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }

                if (sql.includes("SET status = 'queued'")) {
                  const [code, message, _updatedAt, jobId] = params;
                  if (job.id === jobId && job.status === "queued") {
                    statusWrites.push("queued");
                    job.status = "queued";
                    job.error_code = String(code);
                    job.error_message = String(message);
                    job.workflow_instance_id = null;
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }

                throw new Error(`Unhandled run SQL: ${sql}`);
              },
            };
          },
        };
      },
    },
    IMAGE_PROCESSING_WORKFLOW: {
      async create(): Promise<void> {
        throw new Error("Workflow service unavailable");
      },
    },
  };

  return { env, job, statusWrites };
}

describe("processJob", () => {
  it("starts the Cloudflare Workflow without exposing workflow metadata as a durable status", async () => {
    const { env, job, statusWrites } = createProcessJobFixture();
    env.IMAGE_PROCESSING_WORKFLOW.create = async () => undefined;
    const message: QueueJobMessage = {
      job_id: job.id,
      workspace_id: job.workspace_id,
      template_id: "template_test",
      template_version: 1,
      image_r2_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      attempt: 1,
      enqueued_at: "2026-05-06T12:00:00.000Z",
    };

    await processJob(message, env as unknown as Env);

    expect(job.status).toBe("queued");
    expect(statusWrites).not.toContain("workflow_started");
    expect(job.workflow_instance_id).toBe("job_test-attempt-1");
  });

  it("keeps Workflow start failures retryable by the queue without writing retryable_failed", async () => {
    const { env, job } = createProcessJobFixture();
    const message: QueueJobMessage = {
      job_id: job.id,
      workspace_id: job.workspace_id,
      template_id: "template_test",
      template_version: 1,
      image_r2_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      attempt: 1,
      enqueued_at: "2026-05-06T12:00:00.000Z",
    };

    await expect(processJob(message, env as unknown as Env)).rejects.toThrow(
      "Workflow service unavailable",
    );

    expect(job.status).toBe("queued");
    expect(job.status).not.toBe("retryable_failed");
    expect(job.error_code).toBe("workflow_start_error");
    expect(job.error_message).toBe("Workflow service unavailable");
    expect(job.workflow_instance_id).toBeNull();
  });
});
