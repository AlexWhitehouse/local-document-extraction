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

type ProductStoreStub = {
  validateTemplateForDocumentSubmission: ReturnType<typeof vi.fn>;
  createQueuedExtractionJob: ReturnType<typeof vi.fn>;
  failQueuedExtractionJob: ReturnType<typeof vi.fn>;
};

type AnalyticsBindingStub = Env["WORKSPACE_PRODUCT_ANALYTICS"] & {
  writeDataPoint: ReturnType<typeof vi.fn>;
};

describe("Extraction submission route", () => {
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

  it("rejects legacy image field submissions", async () => {
    const response = await worker.fetch(createExtractRequest("image"), createExtractEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_document",
        message: "document is required",
      },
    });
  });

  it("rejects generic file field submissions", async () => {
    const response = await worker.fetch(createExtractRequest("file"), createExtractEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_document",
        message: "document is required",
      },
    });
  });

  it("accepts supported Document submissions", async () => {
    const legacyProductRead = vi.fn(async () => {
      throw new Error("legacy global D1 product tables should not be required for Document submission");
    });
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    }));
    const analytics = createAnalyticsBinding();
    const env = createExtractEnv({
      DB: createLegacyProductDb({ legacyProductRead }),
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_PRODUCT_ANALYTICS: analytics,
    });
    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(202);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "queued",
      source_name: "invoice.pdf",
      template_id: "template_test",
      template_version: 1,
    });
    expect(body).not.toHaveProperty("image_name");
    expect(env.SOURCE_FILES_BUCKET.put).toHaveBeenCalledWith(
      expect.stringMatching(/^workspaces\/workspace_test\/jobs\/job_/),
      expect.any(ArrayBuffer),
      {
        httpMetadata: {
          contentType: "application/pdf",
        },
      },
    );
    expect(env.EXTRACTION_JOBS_QUEUE.send).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "workspace_test",
        template_id: "template_test",
        template_version: 1,
      }),
      { contentType: "json" },
    );
    expect(productStore.validateTemplateForDocumentSubmission).toHaveBeenCalledWith("template_test");
    expect(productStore.createQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "template_test",
        templateVersion: 1,
        sourceMimeType: "application/pdf",
        sourceName: "invoice.pdf",
      }),
    );
    expect(legacyProductRead).not.toHaveBeenCalled();
    expect(analytics.writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        indexes: ["workspace_test"],
        blobs: expect.arrayContaining(["document_submitted", "workspace_test", "template_test", "application/pdf"]),
        doubles: expect.arrayContaining([6, 1]),
      }),
    );
    expect(JSON.stringify(analytics.writeDataPoint.mock.calls[0]?.[0])).not.toContain("invoice.pdf");
  });

  it("rejects Documents that exceed the workspace Source file byte limit", async () => {
    authenticateMock.mockResolvedValueOnce({
      workspace: {
        id: "workspace_test",
        api_key_hash: "hash_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        created_by_user_id: "user_test",
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: 5,
      },
    });

    const response = await worker.fetch(createExtractRequest("document", "oversized"), createExtractEnv());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "source_file_too_large",
        message: "Source file exceeds max size of 5 bytes",
      },
    });
  });

  it("returns Template validation errors from Workspace product data before uploading the Source file", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      error: {
        status: 400,
        code: "template_invalid",
        message: "Template has no fields",
      },
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "template_invalid",
        message: "Template has no fields",
      },
    });
    expect(env.SOURCE_FILES_BUCKET.put).not.toHaveBeenCalled();
    expect(productStore.createQueuedExtractionJob).not.toHaveBeenCalled();
  });

  it("deletes the uploaded Source file when queued Extraction job creation fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockResolvedValue({
      error: {
        status: 500,
        code: "queued_job_create_failed",
        message: "Could not create queued Extraction job",
      },
    });
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "queued_job_create_failed",
        message: "Could not create queued Extraction job",
      },
    });
    const objectKey = String((env.SOURCE_FILES_BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(objectKey).toMatch(/^workspaces\/workspace_test\/jobs\/job_/);
    expect(env.SOURCE_FILES_BUCKET.delete).toHaveBeenCalledWith(objectKey);
    expect(env.EXTRACTION_JOBS_QUEUE.send).not.toHaveBeenCalled();
  });

  it("keeps accepted Document submissions successful when analytics emission fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    }));
    const analyticsError = new Error("analytics unavailable");
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      WORKSPACE_PRODUCT_ANALYTICS: {
        writeDataPoint: vi.fn(() => {
          throw analyticsError;
        }),
      } as unknown as Env["WORKSPACE_PRODUCT_ANALYTICS"],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: "queued",
      template_id: "template_test",
      template_version: 1,
    });
    expect(env.EXTRACTION_JOBS_QUEUE.send).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Workspace product analytics emission failed", analyticsError);
    consoleError.mockRestore();
  });

  it("marks the Extraction job failed and deletes the uploaded Source file when queue send fails", async () => {
    const productStore = createProductStoreStub();
    productStore.validateTemplateForDocumentSubmission.mockResolvedValue({
      template_id: "template_test",
      template_version: 1,
    });
    productStore.createQueuedExtractionJob.mockImplementation(async (input) => ({
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    }));
    productStore.failQueuedExtractionJob.mockResolvedValue(true);
    const env = createExtractEnv({
      WORKSPACE_PRODUCT_STORE: createProductStoreBinding(productStore),
      EXTRACTION_JOBS_QUEUE: {
        send: vi.fn(async () => {
          throw new Error("queue unavailable");
        }),
      } as unknown as Queue,
    });

    const response = await worker.fetch(createExtractRequest("document"), env);

    expect(response.status).toBe(500);
    const objectKey = String((env.SOURCE_FILES_BUCKET.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    const jobId = String((productStore.createQueuedExtractionJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.jobId);
    expect(productStore.failQueuedExtractionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        errorCode: "queue_send_failed",
        errorMessage: "queue unavailable",
      }),
    );
    expect(env.SOURCE_FILES_BUCKET.delete).toHaveBeenCalledWith(objectKey);
  });

  it("rejects Documents that exceed the default Source file byte limit", async () => {
    const env = createExtractEnv({ MAX_SOURCE_FILE_BYTES: "5" });
    const response = await worker.fetch(createExtractRequest("document", "oversized"), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "source_file_too_large",
        message: "Source file exceeds max size of 5 bytes",
      },
    });
  });
});

function createExtractRequest(sourceFieldName: string, sourceText = "source"): Request {
  const formData = new FormData();
  formData.append("template_id", "template_test");
  formData.append(sourceFieldName, new File([sourceText], "invoice.pdf", { type: "application/pdf" }));

  return new Request("https://example.com/v1/extract", {
    method: "POST",
    headers: { authorization: "Bearer workspace-api-key" },
    body: formData,
  });
}

type ExtractTestEnv = Omit<Env, "MAX_SOURCE_FILE_BYTES"> & {
  MAX_SOURCE_FILE_BYTES?: string;
};

function createExtractEnv(overrides: Partial<ExtractTestEnv> = {}): Env {
  const db = createLegacyProductDb();

  return {
    DB: db,
    SOURCE_FILES_BUCKET: {
      put: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    } as unknown as R2Bucket,
    EXTRACTION_JOBS_QUEUE: {
      send: vi.fn(async () => null),
    } as unknown as Queue,
    ...overrides,
  } as Env;
}

function createLegacyProductDb(input: {
  legacyProductRead?: () => unknown | Promise<unknown>;
} = {}): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          await input.legacyProductRead?.();
          if (sql.includes("FROM templates")) {
            return {
              id: "template_test",
              current_version: 1,
              status: "active",
              deleted_at: null,
            };
          }
          if (sql.includes("FROM template_fields")) {
            return { exists_flag: 1 };
          }
          return null;
        }),
        run: vi.fn(async () => ({ meta: { changes: 1 } })),
      })),
    })),
  } as unknown as D1Database;
}

function createProductStoreStub(): ProductStoreStub {
  return {
    validateTemplateForDocumentSubmission: vi.fn(),
    createQueuedExtractionJob: vi.fn(),
    failQueuedExtractionJob: vi.fn(),
  };
}

function createProductStoreBinding(productStore: ProductStoreStub): Env["WORKSPACE_PRODUCT_STORE"] {
  return {
    getByName: vi.fn(() => productStore),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}

function createAnalyticsBinding(): AnalyticsBindingStub {
  return {
    writeDataPoint: vi.fn(),
  } as unknown as AnalyticsBindingStub;
}
