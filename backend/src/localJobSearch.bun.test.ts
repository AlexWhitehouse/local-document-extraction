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

test("the Document adapter searches one Workspace's stable job metadata and returns its unfiltered total", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-job-search-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
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
    createSearchableJobs({ stateDirectory, workspaceId: workspace.id });
    createIsolatedJob({ stateDirectory, workspaceId: isolatedWorkspace.workspace_id });
    const apiKey = workspaceControl.rotateApiKey({ workspaceId: workspace.id, userId: user.user.id }).api_key;
    const application = createLocalApplication({ auth, stateDirectory, workspaceControl });
    const adapter = createDocumentRequestAdapter({ request: createApiKeyRequest(application, apiKey) });

    await expect(adapter.listDocuments({ search: "invoice" })).resolves.toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({ job_id: "job_invoice", source_name: "invoice-2026.pdf" }),
      ]),
      total: 4,
    });
    await expect(adapter.listDocuments({ search: "job_report" })).resolves.toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_report" })],
      total: 4,
    });
    await expect(adapter.listDocuments({ search: "tpl_receipts" })).resolves.toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_receipt_failed", template_id: "tpl_receipts" })],
      total: 4,
    });
    await expect(adapter.listDocuments({ search: "failed" })).resolves.toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_receipt_failed", status: "failed" })],
      total: 4,
    });
    await expect(adapter.listDocuments({
      filters: { dateFrom: "2026-07-10", dateTo: "2026-07-10" },
    })).resolves.toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_receipt_failed" })],
      total: 4,
    });
    await expect(adapter.listDocuments({
      filters: { model: "test-model" },
    })).resolves.toMatchObject({
      jobs: [expect.objectContaining({ job_id: "job_completed", model_name: "test-model" })],
      total: 4,
    });
    await expect(adapter.getFilterOptions()).resolves.toEqual({
      available_models: ["test-model"],
    });
    await expect(adapter.listDocuments({
      filters: { dateFrom: "2026-02-30" },
    })).rejects.toMatchObject({ code: "invalid_job_filters", status: 400 });
    await expect(adapter.listDocuments({
      filters: { dateFrom: "2026-07-11", dateTo: "2026-07-10" },
    })).rejects.toMatchObject({ code: "invalid_job_filters", status: 400 });
    await expect(adapter.listDocuments({ search: "isolated" })).resolves.toEqual({
      jobs: [],
      total: 4,
      next_cursor: null,
      has_more: false,
    });
    await expect(adapter.listDocuments()).resolves.toMatchObject({
      jobs: expect.not.arrayContaining([expect.objectContaining({ job_id: "job_isolated" })]),
      total: 4,
    });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function createSearchableJobs({ stateDirectory, workspaceId }: { stateDirectory: string; workspaceId: string }) {
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    store.createTemplate({
      templateId: "tpl_invoices",
      name: "Invoices",
      description: null,
      fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    store.createTemplate({
      templateId: "tpl_receipts",
      name: "Receipts",
      description: null,
      fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    for (const [jobId, templateId, sourceName, submittedAt] of [
      ["job_invoice", "tpl_invoices", "invoice-2026.pdf", "2026-07-08T12:00:00.000Z"],
      ["job_report", "tpl_invoices", "report.png", "2026-07-09T12:00:00.000Z"],
      ["job_receipt_failed", "tpl_receipts", "receipt.jpg", "2026-07-10T12:00:00.000Z"],
      ["job_completed", "tpl_invoices", "completed.png", "2026-07-11T12:00:00.000Z"],
    ]) {
      store.createQueuedExtractionJob({
        jobId,
        templateId,
        templateVersion: 1,
        sourceFileKey: `workspaces/${workspaceId}/jobs/${jobId}/source.png`,
        sourceMimeType: "image/png",
        sourceName,
        sourceFilePageCount: null,
        submittedAt,
      });
    }
    store.claimExtractionJobForProcessing({ jobId: "job_report", attempt: 1, claimedAt: "2026-07-10T12:01:00.000Z" });
    store.failQueuedExtractionJob({ jobId: "job_receipt_failed", failedAt: "2026-07-10T12:01:00.000Z", errorCode: "test_failure", errorMessage: "Test failure" });
    store.claimExtractionJobForProcessing({ jobId: "job_completed", attempt: 1, claimedAt: "2026-07-11T12:01:00.000Z" });
    store.completeExtractionJob({
      jobId: "job_completed",
      attempt: 1,
      completedAt: "2026-07-11T12:02:00.000Z",
      modelName: "test-model",
      route: "test-route",
      results: [{ field_id: "reference", status: "ok", answer: "COMPLETE", normalized_value: "COMPLETE", confidence: 1, evidence: null }],
    });
  } finally {
    store.close();
  }
}

function createIsolatedJob({ stateDirectory, workspaceId }: { stateDirectory: string; workspaceId: string }) {
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    store.createTemplate({
      templateId: "tpl_isolated",
      name: "Isolated",
      description: null,
      fields: [{ id: "value", name: "Value", description: "Value", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    store.createQueuedExtractionJob({
      jobId: "job_isolated",
      templateId: "tpl_isolated",
      templateVersion: 1,
      sourceFileKey: `workspaces/${workspaceId}/jobs/job_isolated/source.png`,
      sourceMimeType: "image/png",
      sourceName: "isolated.pdf",
      sourceFilePageCount: null,
      submittedAt: "2026-07-10T12:00:00.000Z",
    });
    store.claimExtractionJobForProcessing({
      jobId: "job_isolated",
      attempt: 1,
      claimedAt: "2026-07-10T12:01:00.000Z",
    });
    store.completeExtractionJob({
      jobId: "job_isolated",
      attempt: 1,
      completedAt: "2026-07-10T12:02:00.000Z",
      modelName: "isolated-model",
      route: "isolated-route",
      results: [{
        field_id: "value",
        status: "ok",
        answer: "ISOLATED",
        normalized_value: "ISOLATED",
        confidence: 1,
        evidence: null,
      }],
    });
  } finally {
    store.close();
  }
}

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
