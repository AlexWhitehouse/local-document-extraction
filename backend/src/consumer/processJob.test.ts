import { describe, expect, it, vi } from "vitest";

import type { QueueJobMessage } from "../lib/types";
import { processJob } from "./processJob";

type ProductStoreStub = {
  startExtractionWorkflow: ReturnType<typeof vi.fn>;
  noteExtractionWorkflowStartFailure: ReturnType<typeof vi.fn>;
};

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
  const productStore = createProductStoreStub();
  productStore.startExtractionWorkflow.mockImplementation(async (input) => {
    if (job.status !== "queued" || job.workflow_instance_id) {
      return false;
    }
    job.error_code = null;
    job.error_message = null;
    job.workflow_instance_id = String(input.workflowInstanceId);
    return true;
  });
  productStore.noteExtractionWorkflowStartFailure.mockImplementation(async (input) => {
    statusWrites.push("queued");
    job.status = "queued";
    job.error_code = String(input.errorCode);
    job.error_message = String(input.errorMessage);
    job.workflow_instance_id = null;
  });

  const env = createProductStoreProcessJobEnv(productStore, {
    DOCUMENT_PROCESSING_WORKFLOW: {
      create: vi.fn(async () => {
        throw new Error("Workflow service unavailable");
      }),
    } as unknown as Workflow,
  });

  return { env, job, statusWrites };
}

describe("processJob", () => {
  it("starts the Cloudflare Workflow from authoritative Workspace product data", async () => {
    const productStore = createProductStoreStub();
    productStore.startExtractionWorkflow.mockResolvedValue(true);
    const env = createProductStoreProcessJobEnv(productStore, {
      DB: {
        prepare() {
          throw new Error("legacy global D1 product tables should not be required to start processing");
        },
      } as unknown as D1Database,
    });
    const message: QueueJobMessage = {
      job_id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 1,
      attempt: 1,
      enqueued_at: "2026-05-06T12:00:00.000Z",
    };

    await processJob(message, env);

    expect(productStore.startExtractionWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job_test",
        attempt: 1,
        workflowInstanceId: "job_test-attempt-1",
      }),
    );
    expect(env.DOCUMENT_PROCESSING_WORKFLOW.create).toHaveBeenCalledWith({
      id: "job_test-attempt-1",
      params: {
        job_id: "job_test",
        workspace_id: "workspace_test",
        attempt: 1,
      },
    });
  });

  it("starts the Cloudflare Workflow without exposing workflow metadata as a durable status", async () => {
    const { env, job, statusWrites } = createProcessJobFixture();
    (env.DOCUMENT_PROCESSING_WORKFLOW.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const message: QueueJobMessage = {
      job_id: job.id,
      workspace_id: job.workspace_id,
      template_id: "template_test",
      template_version: 1,
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

function createProductStoreStub(): ProductStoreStub {
  return {
    startExtractionWorkflow: vi.fn(),
    noteExtractionWorkflowStartFailure: vi.fn(),
  };
}

function createProductStoreProcessJobEnv(productStore: ProductStoreStub, overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    WORKSPACE_PRODUCT_STORE: {
      getByName: vi.fn(() => productStore),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"],
    DOCUMENT_PROCESSING_WORKFLOW: {
      create: vi.fn(async () => undefined),
    } as unknown as Workflow,
    ...overrides,
  } as Env;
}
