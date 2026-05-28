import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/auth", () => ({
  authenticate: authenticateMock,
  requireSession: vi.fn(),
}));

vi.mock("./lib/betterAuth", () => ({
  createAuth: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  WorkflowEntrypoint: class {},
}));

import worker from "./index";

const supportedLifecycleStates = ["queued", "processing", "completed", "failed"];
const obsoleteLifecycleStates = ["workflow_started", "retryable_failed"];

type ProductStoreStub = {
  listExtractionJobs: ReturnType<typeof vi.fn>;
  getExtractionJob: ReturnType<typeof vi.fn>;
  getExtractionJobDeletionCandidate: ReturnType<typeof vi.fn>;
  deleteExtractionJob: ReturnType<typeof vi.fn>;
};

describe("Extraction job routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateMock.mockResolvedValue({
      workspace: {
        id: "workspace_test",
        api_key_hash: "hash_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        created_by_user_id: "user_test",
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: null,
      },
    });
  });

  it("does not expose manual retry as an Extraction job route", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs/job_test/retry", {
        method: "POST",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      { DB: {} as D1Database } as Env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Route not found",
      },
    });
  });

  it("lists Extraction jobs from authoritative Workspace product data", async () => {
    const productStore = createProductStoreStub();
    productStore.listExtractionJobs.mockResolvedValue({
      jobs: [
        {
          job_id: "job_product",
          status: "queued",
          source_name: "invoice.pdf",
          template_id: "template_test",
          template_version: 1,
          error_code: null,
          error_message: null,
          created_at: "2026-05-06T12:00:00.000Z",
          updated_at: "2026-05-06T12:00:00.000Z",
          completed_at: null,
          current_attempt: 0,
          completed_attempt: 0,
          last_failed_attempt: 0,
          results: [],
        },
      ],
      nextCursor: null,
      has_more: false,
    });
    const env = createJobsRouteEnv({
      DB: {
        prepare() {
          throw new Error("legacy global D1 product tables should not be required for Extraction job list reads");
        },
      } as unknown as D1Database,
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs", {
        method: "GET",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobs: [
        {
          job_id: "job_product",
          status: "queued",
          source_name: "invoice.pdf",
          template_id: "template_test",
          template_version: 1,
          error_code: null,
          error_message: null,
          created_at: "2026-05-06T12:00:00.000Z",
          updated_at: "2026-05-06T12:00:00.000Z",
          completed_at: null,
          current_attempt: 0,
          completed_attempt: 0,
          last_failed_attempt: 0,
          results: [],
        },
      ],
      next_cursor: null,
      has_more: false,
    });
    expect(productStore.listExtractionJobs).toHaveBeenCalledWith({
      limit: 200,
      search: "",
      cursor: null,
    });
  });

  it("lists only Extraction jobs with supported durable lifecycle states", async () => {
    const rows = [...supportedLifecycleStates, ...obsoleteLifecycleStates].map((status, index) => ({
      id: `job_${status}`,
      status,
      template_id: "template_test",
      template_version: 1,
      source_name: `${status}.pdf`,
      error_code: null,
      error_message: null,
      created_at: `2026-05-06T12:0${index}:00.000Z`,
      updated_at: `2026-05-06T12:0${index}:00.000Z`,
      completed_at: status === "completed" ? `2026-05-06T12:0${index}:30.000Z` : null,
      current_attempt: status === "processing" ? 1 : 0,
      completed_attempt: status === "completed" ? 1 : 0,
      last_failed_attempt: status === "failed" ? 1 : 0,
      sort_at: `2026-05-06T12:0${index}:00.000Z`,
    }));
    const env = createJobsRouteEnv({ listRows: rows });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs", {
        method: "GET",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobs: Array<Record<string, unknown> & { status: string }> };
    expect(body.jobs.map((job: { status: string }) => job.status)).toEqual(supportedLifecycleStates);
    expect(body.jobs[0]).toMatchObject({ source_name: "queued.pdf" });
    expect(body.jobs[0]).not.toHaveProperty("image_name");
  });

  it("does not expose an obsolete stored lifecycle state from Extraction job detail", async () => {
    const env = createJobsRouteEnv({
      detailJob: {
        id: "job_workflow_started",
        status: "workflow_started",
        template_id: "template_test",
        template_version: 1,
        source_name: "invoice.pdf",
        error_code: null,
        error_message: null,
        created_at: "2026-05-06T12:00:00.000Z",
        updated_at: "2026-05-06T12:01:00.000Z",
        completed_at: null,
        current_attempt: 1,
        completed_attempt: 0,
        last_failed_attempt: 0,
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs/job_workflow_started", {
        method: "GET",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Job not found",
      },
    });
  });

  it("finds Extraction jobs by Source file name", async () => {
    const env = createJobsRouteEnv({
      listRows: [
        {
          id: "job_invoice",
          status: "completed",
          template_id: "template_test",
          template_version: 1,
          source_name: "invoice.pdf",
          error_code: null,
          error_message: null,
          created_at: "2026-05-06T12:00:00.000Z",
          updated_at: "2026-05-06T12:02:00.000Z",
          completed_at: "2026-05-06T12:02:00.000Z",
          current_attempt: 1,
          completed_attempt: 1,
          last_failed_attempt: 0,
          sort_at: "2026-05-06T12:02:00.000Z",
        },
      ],
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs?search=invoice", {
        method: "GET",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: [{ job_id: "job_invoice", source_name: "invoice.pdf" }],
    });
  });

  it("returns Extraction results for completed Extraction job detail", async () => {
    const env = createJobsRouteEnv({
      detailJob: {
        id: "job_completed",
        status: "completed",
        template_id: "template_test",
        template_version: 1,
        source_name: "invoice.pdf",
        error_code: null,
        error_message: null,
        created_at: "2026-05-06T12:00:00.000Z",
        updated_at: "2026-05-06T12:02:00.000Z",
        completed_at: "2026-05-06T12:02:00.000Z",
        current_attempt: 1,
        completed_attempt: 1,
        last_failed_attempt: 0,
      },
      resultRows: [
        {
          field_id: "field_total",
          name: "Total",
          data_type: "number",
          status: "ok",
          answer_json: "42",
          confidence: 0.98,
          evidence_text: "Total 42",
        },
      ],
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs/job_completed", {
        method: "GET",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      job_id: "job_completed",
      status: "completed",
      source_name: "invoice.pdf",
      results: [
        {
          field_id: "field_total",
          name: "Total",
          data_type: "number",
          status: "ok",
          answer: 42,
          confidence: 0.98,
          evidence: "Total 42",
        },
      ],
    });
    expect(body).not.toHaveProperty("image_name");
  });

  it("deletes Extraction jobs through authoritative Workspace product data and Source file storage", async () => {
    const productStore = createProductStoreStub();
    productStore.getExtractionJobDeletionCandidate.mockResolvedValue({
      job_id: "job_product",
      source_file_key: "workspaces/workspace_test/jobs/job_product/source.pdf",
    });
    productStore.deleteExtractionJob.mockResolvedValue(true);
    const deletedKeys: string[] = [];
    const env = createJobsRouteEnv({
      DB: {
        prepare() {
          throw new Error("legacy global D1 product tables should not be required for Extraction job deletion");
        },
      } as unknown as D1Database,
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      SOURCE_FILES_BUCKET: {
        async delete(key: string) {
          deletedKeys.push(key);
        },
      } as unknown as R2Bucket,
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs/job_product", {
        method: "DELETE",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(204);
    expect(productStore.getExtractionJobDeletionCandidate).toHaveBeenCalledWith("job_product");
    expect(deletedKeys).toEqual(["workspaces/workspace_test/jobs/job_product/source.pdf"]);
    expect(productStore.deleteExtractionJob).toHaveBeenCalledWith({
      jobId: "job_product",
      deletedAt: expect.any(String),
    });
  });

  it("returns not_found when deleting a missing Extraction job from Workspace product data", async () => {
    const productStore = createProductStoreStub();
    productStore.getExtractionJobDeletionCandidate.mockResolvedValue(null);
    const env = createJobsRouteEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      SOURCE_FILES_BUCKET: {
        async delete() {
          throw new Error("Source file storage should not be touched for a missing Extraction job");
        },
      } as unknown as R2Bucket,
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/jobs/job_missing", {
        method: "DELETE",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Job not found",
      },
    });
    expect(productStore.deleteExtractionJob).not.toHaveBeenCalled();
  });
});

function createJobsRouteEnv({
  DB,
  WORKSPACE_PRODUCT_STORE,
  SOURCE_FILES_BUCKET,
  listRows = [],
  detailJob = null,
  resultRows = [],
}: {
  DB?: D1Database;
  WORKSPACE_PRODUCT_STORE?: Env["WORKSPACE_PRODUCT_STORE"];
  SOURCE_FILES_BUCKET?: R2Bucket;
  listRows?: Array<Record<string, unknown>>;
  detailJob?: Record<string, unknown> | null;
  resultRows?: Array<Record<string, unknown>>;
} = {}): Env {
  const db = DB || {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: sql.includes("FROM job_results") ? resultRows : listRows })),
        first: vi.fn(async () => detailJob),
      })),
    })),
  } as unknown as D1Database;
  const productStore = WORKSPACE_PRODUCT_STORE || createProductStoreBinding({
    listExtractionJobs: vi.fn(async () => ({
      jobs: listRows
        .filter((row) => supportedLifecycleStates.includes(String(row.status)))
        .map(toListedJob),
      nextCursor: null,
      has_more: false,
    })),
    getExtractionJob: vi.fn(async () => {
      if (!detailJob || !supportedLifecycleStates.includes(String(detailJob.status))) {
        return null;
      }
      return toJobDetail(detailJob, resultRows);
    }),
    getExtractionJobDeletionCandidate: vi.fn(async () => null),
    deleteExtractionJob: vi.fn(async () => false),
  });

  return { DB: db, WORKSPACE_PRODUCT_STORE: productStore, SOURCE_FILES_BUCKET } as Env;
}

function createProductStoreStub(): ProductStoreStub {
  return {
    listExtractionJobs: vi.fn(),
    getExtractionJob: vi.fn(),
    getExtractionJobDeletionCandidate: vi.fn(),
    deleteExtractionJob: vi.fn(),
  };
}

function createProductStoreBinding(productStore: ProductStoreStub): Env["WORKSPACE_PRODUCT_STORE"] {
  return {
    getByName: vi.fn(() => productStore),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}

function toListedJob(row: Record<string, unknown>) {
  return {
    job_id: row.id,
    status: row.status,
    source_name: row.source_name,
    template_id: row.template_id,
    template_version: row.template_version,
    error_code: row.error_code,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    current_attempt: row.current_attempt,
    completed_attempt: row.completed_attempt,
    last_failed_attempt: row.last_failed_attempt,
    results: [],
  };
}

function toJobDetail(job: Record<string, unknown>, resultRows: Array<Record<string, unknown>>) {
  const summary = {
    job_id: job.id,
    status: job.status,
    source_name: job.source_name,
    template_id: job.template_id,
    template_version: job.template_version,
    error_code: job.error_code,
    error_message: job.error_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    current_attempt: job.current_attempt,
    completed_attempt: job.completed_attempt,
    last_failed_attempt: job.last_failed_attempt,
  };

  if (job.status !== "completed") {
    return summary;
  }

  return {
    ...summary,
    results: resultRows.map((row) => ({
      field_id: row.field_id,
      name: row.name,
      data_type: row.data_type,
      status: row.status,
      answer: typeof row.answer_json === "string" ? safeJsonParse(row.answer_json) : null,
      confidence: row.confidence,
      evidence: row.evidence_text,
    })),
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
