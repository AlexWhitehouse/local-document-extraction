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
import type { Env } from "./lib/types";

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
    const env = createExtractEnv();
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

function createExtractEnv(overrides: Partial<Env> = {}): Env {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
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
