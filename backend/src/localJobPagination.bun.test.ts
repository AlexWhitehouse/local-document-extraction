import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// @ts-expect-error The frontend's JavaScript sources are type-checked by its Vite build.
import { createDocumentRequestAdapter } from "../../frontend/src/features/documents/documentRequestAdapter.js";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("the Document adapter traverses stable, opaque, search-bound job pages without duplicates", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-job-pagination-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);

  try {
    const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const user = await signUp.json() as { user: { id: string; name: string } };
    const workspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
    const isolatedWorkspace = workspaceControl.createWorkspace({ userId: user.user.id, name: "Isolated Workspace" });
    createJobs({ stateDirectory, workspaceId: workspace.id });
    createJobs({ stateDirectory, workspaceId: isolatedWorkspace.workspace_id, ids: ["job_999"] });
    const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id }).api_key;
    const application = createLocalApplication({ auth, jobPageSize: 2, stateDirectory, workspaceControl });
    const adapter = createDocumentRequestAdapter({ request: createApiKeyRequest(application, apiKey) });

    const firstPage = await adapter.listDocuments();
    const statusCounts = { queued: 2, processing: 1, completed: 1, failed: 1 };
    expect(firstPage.status_counts).toEqual(statusCounts);
    expect(firstPage).toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_5" }), expect.objectContaining({ job_id: "job_4" })],
      total: 5,
      has_more: true,
    });
    expect(firstPage.next_cursor).toEqual(expect.any(String));
    const repeatedFirstPage = await adapter.listDocuments();
    expect(repeatedFirstPage).toEqual(firstPage);

    const secondPage = await adapter.listDocuments({ cursor: firstPage.next_cursor });
    expect(secondPage.status_counts).toEqual(statusCounts);
    expect(secondPage).toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_3" }), expect.objectContaining({ job_id: "job_2" })],
      total: 5,
      has_more: true,
    });
    const finalPage = await adapter.listDocuments({ cursor: secondPage.next_cursor });
    expect(finalPage).toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_1" })],
      total: 5,
      has_more: false,
      next_cursor: null,
    });

    const filteredFirstPage = await adapter.listDocuments({ search: "invoice" });
    expect(filteredFirstPage.status_counts).toEqual(statusCounts);
    expect(filteredFirstPage).toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_5" }), expect.objectContaining({ job_id: "job_3" })],
      total: 5,
      has_more: true,
    });
    const filteredFinalPage = await adapter.listDocuments({
      search: "invoice",
      cursor: filteredFirstPage.next_cursor,
    });
    expect(filteredFinalPage).toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_1" })],
      total: 5,
      has_more: false,
    });
    await expect(adapter.listDocuments({ search: "report", cursor: filteredFirstPage.next_cursor }))
      .rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
    const dateFilteredFirstPage = await adapter.listDocuments({
      filters: { dateFrom: "2026-07-10" },
    });
    expect(dateFilteredFirstPage).toMatchObject({ has_more: true });
    await expect(adapter.listDocuments({
      cursor: dateFilteredFirstPage.next_cursor,
      filters: { dateFrom: "2026-07-10" },
    })).resolves.toMatchObject({ has_more: true });
    await expect(adapter.listDocuments({ cursor: dateFilteredFirstPage.next_cursor }))
      .rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
    await expect(adapter.listDocuments({ cursor: "not-a-valid-cursor" }))
      .rejects.toMatchObject({ code: "invalid_cursor", status: 400 });
    await adapter.deleteDocument("job_1");
    await expect(adapter.getDocumentCounts()).resolves.toEqual({ total: 4, status_counts: { ...statusCounts, completed: 0 } });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function createJobs({
  stateDirectory,
  workspaceId,
  ids = ["job_1", "job_2", "job_3", "job_4", "job_5"],
}: {
  stateDirectory: string;
  workspaceId: string;
  ids?: string[];
}) {
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: null,
      fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    store.createTemplate({
      templateId: "tpl_report",
      name: "Report",
      description: null,
      fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    for (const jobId of ids) {
      const isInvoice = ["job_1", "job_3", "job_5"].includes(jobId);
      store.createQueuedExtractionJob({
        jobId,
        templateId: isInvoice ? "tpl_invoice" : "tpl_report",
        templateVersion: 1,
        sourceFileKey: `workspaces/${workspaceId}/jobs/${jobId}/source.png`,
        sourceMimeType: "image/png",
        sourceName: isInvoice ? `invoice-${jobId}.png` : `report-${jobId}.png`,
        sourceFilePageCount: null,
        submittedAt: "2026-07-10T12:00:00.000Z",
      });
      if (jobId === "job_1" || jobId === "job_3") {
        store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: "2026-07-10T12:01:00.000Z" });
      }
      if (jobId === "job_1") {
        store.completeExtractionJob({ jobId, attempt: 1, completedAt: "2026-07-10T12:02:00.000Z", modelName: "test", route: "test", results: [] });
      }
      if (jobId === "job_2") {
        store.failQueuedExtractionJob({ jobId, failedAt: "2026-07-10T12:02:00.000Z", errorCode: "test", errorMessage: "test" });
      }
    }
  } finally {
    store.close();
  }
}

test("status count migration backfills existing jobs and remains correct after reopening and retrying", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-status-counts-"));
  const workspaceId = "workspace_counts";
  try {
    createJobs({ stateDirectory, workspaceId });
    const db = new Database(join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`));
    try {
      db.exec(`DROP TRIGGER jobs_status_count_insert; DROP TRIGGER jobs_status_count_delete;
        DROP TRIGGER jobs_status_count_update; DROP TABLE job_status_totals;
        DELETE FROM product_schema_version WHERE version = 5;`);
    } finally { db.close(); }
    for (let pass = 0; pass < 2; pass++) {
      const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
      try {
        expect(store.getExtractionJobCounts()).toEqual({ total: 5, status_counts: { queued: 2, processing: 1, completed: 1, failed: 1 } });
        if (pass === 1) {
          expect(store.requeueExtractionJob({ jobId: "job_3", attempt: 1, requeuedAt: "2026-07-10T12:03:00.000Z", nextRetryAt: "2026-07-10T12:04:00.000Z", errorCode: "timeout", errorMessage: "test" })).toBe(true);
          expect(store.getExtractionJobCounts()).toEqual({ total: 5, status_counts: { queued: 3, processing: 0, completed: 1, failed: 1 } });
        }
      } finally { store.close(); }
    }
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});

function createApiKeyRequest(application: (request: Request) => Response | Promise<Response>, apiKey: string) {
  return async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${apiKey}`);
    const response = await application(new Request(`http://127.0.0.1:8787/v1${path}`, { ...options, headers }));
    const data = await response.json() as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw Object.assign(new Error(data.error?.message || `Request failed (${response.status})`), {
        code: data.error?.code || null,
        status: response.status,
      });
    }
    return data;
  };
}
