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
  WorkflowEntrypoint: class {},
}));

import worker from "./index";

const supportedLifecycleStates = ["queued", "processing", "completed", "failed"];
const obsoleteLifecycleStates = ["workflow_started", "retryable_failed"];

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
});

function createJobsRouteEnv({
  listRows = [],
  detailJob = null,
  resultRows = [],
}: {
  listRows?: Array<Record<string, unknown>>;
  detailJob?: Record<string, unknown> | null;
  resultRows?: Array<Record<string, unknown>>;
} = {}): Env {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: sql.includes("FROM job_results") ? resultRows : listRows })),
        first: vi.fn(async () => detailJob),
      })),
    })),
  } as unknown as D1Database;

  return { DB: db } as Env;
}
