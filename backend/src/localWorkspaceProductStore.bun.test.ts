import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { localDocumentRequestBodyLimit } from "./localDocumentBodyLimit";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import type { FetchApplication } from "./localRuntime";
import {
  createLocalWorkspaceProductStore,
  openLocalWorkspaceProductStore,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { validateTemplatePayload } from "./lib/validation";

test("starter Templates use unique generated IDs and remain idempotent after edits, restart, and deletion", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-starter-template-"));
  const workspaceId = "workspace_starter";
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const other = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_other" });
  const createdAt = "2026-09-27T12:00:00.000Z";

  try {
    store.ensureStarterInvoiceTemplate({ createdAt });
    other.ensureStarterInvoiceTemplate({ createdAt });
    const starter = store.listTemplates()[0]!;
    expect(starter.id).toMatch(/^tpl_[0-9a-f]{32}$/);
    expect(other.listTemplates()[0]!.id).toMatch(/^tpl_[0-9a-f]{32}$/);
    expect(other.listTemplates()[0]!.id).not.toBe(starter.id);
    expect(store.getTemplate(starter.id)?.fields.map((field) => field.id)).toEqual([
      "invoice_number", "invoice_date", "vendor_name", "total_amount", "currency",
    ]);
    store.ensureStarterInvoiceTemplate({ createdAt });
    expect(store.listTemplates()).toEqual([starter]);

    store.updateTemplate({ templateId: starter.id, name: "My invoices", updatedAt: createdAt });
    store.close();
    store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
    store.ensureStarterInvoiceTemplate({ createdAt });
    expect(store.listTemplates()).toEqual([expect.objectContaining({ id: starter.id, name: "My invoices" })]);

    store.deleteTemplate({ templateId: starter.id, deletedAt: createdAt });
    store.ensureStarterInvoiceTemplate({ createdAt });
    expect(store.listTemplates()).toEqual([]);
  } finally {
    store.close();
    other.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("starter bootstrap preserves legacy and manually created Templates", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-existing-starter-"));
  try {
    for (const templateId of ["tpl_starter_invoice", "tpl_existing"]) {
      const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: templateId });
      try {
        store.createTemplate({
          templateId,
          name: "Customized template",
          description: "Keep my changes",
          fields: [{ id: "reference", name: "Reference", description: "My reference", data_type: "string" }],
          createdAt: "2026-09-26T12:00:00.000Z",
        });
        const before = store.getTemplate(templateId);
        store.ensureStarterInvoiceTemplate({ createdAt: "2026-09-27T12:00:00.000Z" });
        expect(store.listTemplates()).toHaveLength(1);
        expect(store.getTemplate(templateId)).toEqual(before);
      } finally {
        store.close();
      }
    }
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local Workspace product data creates Templates in an isolated per-Workspace database", async () => {
  await withProductStore(async (research, stateDirectory) => {
    const legal = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_legal" });
    try {
      expect(research.createTemplate(INVOICE_TEMPLATE)).toEqual({ template_id: "tpl_invoice", version: 1, status: "active" });
      expect(research.listTemplates()).toEqual([
        expect.objectContaining({ id: "tpl_invoice", name: "Invoice", current_version: 1 }),
      ]);
      expect(legal.listTemplates()).toEqual([]);
    } finally {
      legal.close();
    }
  });
});

test("opening missing Workspace product data does not initialize a database", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-product-open-"));
  const databasePath = join(stateDirectory, "data", "workspaces", "workspace_missing.sqlite");

  try {
    expect(openLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_missing" })).toBeNull();
    await expect(stat(databasePath)).rejects.toMatchObject({ code: "ENOENT" });

    const initialized = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_missing" });
    initialized.close();
    const opened = openLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_missing" });
    expect(opened).not.toBeNull();
    opened?.close();
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local Workspace product data reads a Template's current version and fields", async () => {
  await withProductStore(async (store) => {
    store.createTemplate(INVOICE_TEMPLATE);
    expect(store.getTemplate("tpl_invoice")).toEqual({
      id: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      status: "active",
      current_version: 1,
      created_at: "2026-07-09T12:00:00.000Z",
      updated_at: "2026-07-09T12:00:00.000Z",
      fields: [{ ...INVOICE_TEMPLATE.fields[0], position: 0 }],
    });
  });
});

test("local Workspace product data versions Template fields while retaining the prior version", async () => {
  await withProductStore(async (store) => {
    store.createTemplate(INVOICE_TEMPLATE);
    expect(store.updateTemplate({
      templateId: "tpl_invoice",
      name: "Invoice v2",
      fields: [
        { id: "invoice_reference", name: "Invoice Reference", description: "Reference printed on the invoice.", data_type: "string" },
      ],
      updatedAt: "2026-07-09T12:05:00.000Z",
    })).toEqual({ template_id: "tpl_invoice", version: 2, status: "active" });

    expect(store.getTemplate("tpl_invoice")).toMatchObject({
      name: "Invoice v2",
      current_version: 2,
      updated_at: "2026-07-09T12:05:00.000Z",
      fields: [expect.objectContaining({ id: "invoice_reference", position: 0 })],
    });
    expect(store.getTemplate("tpl_invoice", 1)?.fields).toEqual([{ ...INVOICE_TEMPLATE.fields[0], position: 0 }]);
  });
});

test("local Workspace product data soft-deletes Templates without exposing them again", async () => {
  await withProductStore(async (store) => {
    store.createTemplate(INVOICE_TEMPLATE);
    expect(store.deleteTemplate({ templateId: "tpl_invoice", deletedAt: "2026-07-09T12:10:00.000Z" })).toBe(true);
    expect(store.getTemplate("tpl_invoice")).toBeNull();
    expect(store.listTemplates()).toEqual([]);
    expect(store.deleteTemplate({ templateId: "tpl_invoice", deletedAt: "2026-07-09T12:10:01.000Z" })).toBe(false);
  });
});

test("local Workspace product data has no Template count or field count cap", async () => {
  await withProductStore(async (store) => {
    for (let index = 1; index <= 6; index += 1) {
      store.createTemplate({
        templateId: `tpl_${index}`,
        name: `Template ${index}`,
        description: "Extract a document field.",
        fields: [{ id: `field_${index}`, name: `Field ${index}`, description: "A value.", data_type: "string" }],
        createdAt: `2026-07-09T12:00:0${index}.000Z`,
      });
    }
    expect(store.listTemplates()).toHaveLength(6);

    const fields = Array.from({ length: 26 }, (_, index) => ({
      id: `field_${index + 1}`,
      name: `Field ${index + 1}`,
      description: `Extract field ${index + 1}.`,
      data_type: "string" as const,
    }));
    expect(store.updateTemplate({ templateId: "tpl_1", fields, updatedAt: "2026-07-09T12:01:00.000Z" }))
      .toEqual({ template_id: "tpl_1", version: 2, status: "active" });
    expect(store.getTemplate("tpl_1")?.fields).toHaveLength(26);
  });
});

test("Template validation keeps local table shape constraints", () => {
  const tableField = (name: string, columns: number) => ({
    name,
    description: `${name} details.`,
    data_type: "array<object>",
    object_schema: {
      data_type: "array<object>",
      columns: Array.from({ length: columns }, (_, index) => ({
        heading: `Column ${index + 1}`,
        data_type: "string",
        description: `Column ${index + 1} value.`,
      })),
    },
  });

  expect(() => validateTemplatePayload({
    name: "Two tables",
    fields: [tableField("Line Items", 1), tableField("Tax Lines", 1)],
  })).toThrow("at most one table-shaped Template field");
  expect(() => validateTemplatePayload({
    name: "Wide table",
    fields: [tableField("Line Items", 21)],
  })).toThrow("at most 20 table columns");
  expect(validateTemplatePayload({
    name: "Twenty columns remain valid",
    fields: [
      { name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
      tableField("Line Items", 20),
    ],
  }).fields).toHaveLength(2);
});

test("authenticated Template create/list routes use the authorized Workspace product store", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-product-api-"));
  const { auth, control, database, headers, workspace } = await createAuthenticatedLocalWorkspace(stateDirectory);
  const { cookie } = headers;
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  const productAnalytics: LocalProductAnalytics = {
    flush: async () => {},
    record: (event) => analyticsEvents.push(event),
  };
  const application = createLocalApplication({ auth, productAnalytics, stateDirectory, workspaceControl: control });

  try {
    const starterList = await application(new Request("http://127.0.0.1:8787/v1/templates", { headers }));
    await expect(starterList.json()).resolves.toMatchObject({
      templates: [expect.objectContaining({ name: "Example Invoice", id: expect.stringMatching(/^tpl_[0-9a-f]{32}$/) })],
    });

    const created = await application(new Request("http://127.0.0.1:8787/v1/templates", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invoice Archive",
        description: "Extract archived invoice information.",
        fields: [
          { name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
        ],
      }),
    }));
    expect(created.status).toBe(201);
    const createdTemplate = await created.json() as { template_id: string };

    const detail = await application(new Request(
      `http://127.0.0.1:8787/v1/templates/${createdTemplate.template_id}`,
      { headers },
    ));
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      id: createdTemplate.template_id,
      name: "Invoice Archive",
      fields: [expect.objectContaining({ name: "Invoice Number", position: 0 })],
    });

    const updated = await application(new Request(
      `http://127.0.0.1:8787/v1/templates/${createdTemplate.template_id}`,
      {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invoice Archive v2",
          fields: [
            { name: "Invoice Reference", description: "Reference printed on the invoice.", data_type: "string" },
          ],
        }),
      },
    ));
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({
      template_id: createdTemplate.template_id,
      version: 2,
      status: "active",
    });
    expect(analyticsEvents).toEqual([
      expect.objectContaining({
        type: "template_created",
        workspaceId: workspace.id,
        templateId: createdTemplate.template_id,
        templateVersion: 1,
        fieldCount: 1,
      }),
      expect.objectContaining({
        type: "template_updated",
        workspaceId: workspace.id,
        templateId: createdTemplate.template_id,
        templateVersion: 2,
        fieldCount: 1,
      }),
    ]);

    const updatedDetail = await application(new Request(
      `http://127.0.0.1:8787/v1/templates/${createdTemplate.template_id}`,
      { headers },
    ));
    await expect(updatedDetail.json()).resolves.toMatchObject({
      name: "Invoice Archive v2",
      current_version: 2,
      fields: [expect.objectContaining({ id: "invoice_reference" })],
    });

    const listed = await application(new Request("http://127.0.0.1:8787/v1/templates", { headers }));
    await expect(listed.json()).resolves.toMatchObject({
      templates: expect.arrayContaining([expect.objectContaining({ name: "Invoice Archive v2" })]),
    });

    const deleted = await application(new Request(
      `http://127.0.0.1:8787/v1/templates/${createdTemplate.template_id}`,
      { method: "DELETE", headers },
    ));
    expect(deleted.status).toBe(204);
    const deletedDetail = await application(new Request(
      `http://127.0.0.1:8787/v1/templates/${createdTemplate.template_id}`,
      { headers },
    ));
    expect(deletedDetail.status).toBe(404);

    const keyResponse = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}/api-key`, {
      method: "POST",
      headers: { cookie },
    }));
    const keyBody = await keyResponse.json() as { api_key: string };
    expect(keyResponse.status).toBe(200);
    expect(keyBody.api_key).toMatch(/^key_/);

    const keyTemplates = await application(new Request("http://127.0.0.1:8787/v1/templates", {
      headers: { authorization: `Bearer ${keyBody.api_key}` },
    }));
    expect(keyTemplates.status).toBe(200);

    const keyDelete = await application(new Request(`http://127.0.0.1:8787/v1/workspaces/${workspace.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${keyBody.api_key}` },
    }));
    expect(keyDelete.status).toBe(401);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("Template routes reject sessions without accepted Workspace membership before product routing", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-product-authz-"));
  const database = new Database(":memory:");
  const linksByEmail = new Map();
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        linksByEmail.set(message.to, message.text.match(/https?:\/\/\S+/)?.[0]);
      },
    },
    secret: "01234567890123456789012345678901",
  });
  const control = createLocalWorkspaceControl(database);
  const application = createLocalApplication({ auth, stateDirectory, workspaceControl: control });

  try {
    for (const [name, email] of [["Ada", "ada@example.com"], ["Grace", "grace@example.com"]]) {
      await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password: "Strong1!" }),
      }));
      await auth.handler(new Request(linksByEmail.get(email), { redirect: "manual" }));
    }

    const adaSignIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    const adaCookie = adaSignIn.headers.get("set-cookie")?.split(";", 1)[0]!;
    const adaSession = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie: adaCookie } }));
    const adaWorkspace = control.listAcceptedWorkspaces({ userId: adaSession!.id, userName: adaSession!.name })[0]!;

    const graceSignIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "grace@example.com", password: "Strong1!" }),
    }));
    const graceCookie = graceSignIn.headers.get("set-cookie")?.split(";", 1)[0]!;
    const response = await application(new Request("http://127.0.0.1:8787/v1/templates", {
      headers: { cookie: graceCookie, "x-workspace-id": adaWorkspace.id },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: "You do not have access to this workspace" },
    });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("authenticated local Document submission queues the selected Template and notifies the local runner", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-local-submit-"));
  const { auth, control, database, headers, workspace } = await createAuthenticatedLocalWorkspace(stateDirectory);
  const liveUpdateHub = createLocalLiveUpdateHub();
  const scheduledJobs: Array<{
    job_id: string;
    workspace_id: string;
    template_id: string;
    template_version: number;
    enqueued_at: string;
  }> = [];
  const analyticsEvents: LocalWorkspaceProductAnalyticsEvent[] = [];
  const productAnalytics: LocalProductAnalytics = {
    flush: async () => {},
    record: (event) => analyticsEvents.push(event),
  };
  const application = createLocalApplication({
    auth,
    liveUpdateHub,
    productAnalytics,
    stateDirectory,
    workspaceControl: control,
    scheduleQueuedJob: async (job) => {
      scheduledJobs.push(job);
    },
  });

  try {
    const lifecycleMessages: string[] = [];
    liveUpdateHub.subscribe({
      workspaceId: workspace.id,
      socket: { send: (message) => lifecycleMessages.push(message) },
    });
    const templateId = await starterTemplateId(application, headers);
    const response = await submitPngDocument(application, headers, templateId);

    expect(response.status).toBe(202);
    const queued = await response.json() as { job_id: string; status: string; template_id: string; template_version: number; source_name: string | null };
    expect(queued).toMatchObject({
      status: "queued",
      source_name: "invoice.png",
      template_id: templateId,
      template_version: 1,
    });
    expect(scheduledJobs).toEqual([
      expect.objectContaining({
        job_id: queued.job_id,
        workspace_id: workspace.id,
        template_id: templateId,
        template_version: 1,
      }),
    ]);
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: workspace.id });
    try {
      expect(productStore.getExtractionJob(queued.job_id)).toMatchObject({
        job_id: queued.job_id,
        status: "queued",
        source_mime_type: "image/png",
        source_file_page_count: null,
        template_id: templateId,
        template_version: 1,
      });
    } finally {
      productStore.close();
    }

    const listed = await application(new Request("http://127.0.0.1:8787/v1/jobs", { headers }));
    await expect(listed.json()).resolves.toMatchObject({
      jobs: [expect.objectContaining({ job_id: queued.job_id, status: "queued", results: [] })],
      next_cursor: null,
      has_more: false,
    });
    const detail = await application(new Request(`http://127.0.0.1:8787/v1/jobs/${queued.job_id}`, { headers }));
    await expect(detail.json()).resolves.toMatchObject({ job_id: queued.job_id, status: "queued", results: [] });

    const runner = createLocalExtractionRunner({
      extract: async () => [
        { field_id: "invoice_number", status: "ok", answer: "INV-001" },
      ],
      onJobLifecycleChange: liveUpdateHub.broadcastJob,
      productAnalytics,
      stateDirectory,
    });
    await runner.run(scheduledJobs[0]!);
    const completedDetail = await application(new Request(
      `http://127.0.0.1:8787/v1/jobs/${queued.job_id}`,
      { headers },
    ));
    await expect(completedDetail.json()).resolves.toMatchObject({
      job_id: queued.job_id,
      status: "completed",
      results: expect.arrayContaining([
        expect.objectContaining({ field_id: "invoice_number", answer: "INV-001" }),
      ]),
    });
    expect(lifecycleMessages.map((message) => {
      const envelope = JSON.parse(message) as { events: Array<{ job: { status: string } }> };
      return envelope.events[0]?.job.status;
    })).toEqual(["queued", "processing", "completed"]);
    expect(lifecycleMessages.join("\n")).not.toContain("invoice.png");
    expect(lifecycleMessages.join("\n")).not.toContain("INV-001");
    expect(analyticsEvents).toEqual([
      expect.objectContaining({
        type: "document_submitted",
        workspaceId: workspace.id,
        extractionJobId: queued.job_id,
        sourceMimeType: "image/png",
      }),
      expect.objectContaining({
        type: "extraction_completed",
        workspaceId: workspace.id,
        extractionJobId: queued.job_id,
        sourceMimeType: "image/png",
        fieldCount: 5,
      }),
    ]);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local Document submission removes a written Source file when product job creation fails", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-submit-store-failure-"));
  const fixture = await createAuthenticatedLocalWorkspace(stateDirectory);
  const deletedSourceFileKeys: string[] = [];
  const application = createLocalApplication({
    auth: fixture.auth,
    stateDirectory,
    workspaceControl: fixture.control,
    productStoreFactory: (input) => {
      const store = createLocalWorkspaceProductStore(input);
      return {
        ...store,
        createQueuedExtractionJob: () => {
          throw new Error("Workspace product data unavailable");
        },
      };
    },
    sourceFileStore: {
      delete: async (sourceFileKey) => {
        deletedSourceFileKeys.push(sourceFileKey);
      },
      eraseWorkspace: async () => {},
      read: async () => null,
      write: async ({ jobId }) => `memory/${jobId}/source.png`,
    },
  });

  try {
    const templateId = await starterTemplateId(application, fixture.headers);
    const response = await submitPngDocument(application, fixture.headers, templateId);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "document_submission_failed", message: "Document submission could not be queued" },
    });
    expect(deletedSourceFileKeys).toEqual([expect.stringMatching(/^memory\/job_/)]);
  } finally {
    fixture.database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local Document submission fails the queued job and retains its Source file when scheduling fails", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-submit-schedule-failure-"));
  const fixture = await createAuthenticatedLocalWorkspace(stateDirectory);
  const deletedSourceFileKeys: string[] = [];
  const application = createLocalApplication({
    auth: fixture.auth,
    stateDirectory,
    workspaceControl: fixture.control,
    scheduleQueuedJob: async () => {
      throw new Error("Local runner is unavailable");
    },
    sourceFileStore: {
      delete: async (sourceFileKey) => {
        deletedSourceFileKeys.push(sourceFileKey);
      },
      eraseWorkspace: async () => {},
      read: async () => null,
      write: async ({ jobId }) => `memory/${jobId}/source.png`,
    },
  });

  try {
    const templateId = await starterTemplateId(application, fixture.headers);
    const response = await submitPngDocument(application, fixture.headers, templateId);

    expect(response.status).toBe(500);
    expect(deletedSourceFileKeys).toEqual([]);
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: fixture.workspace.id });
    try {
      expect(productStore.listExtractionJobs()).toEqual([
        expect.objectContaining({
          status: "failed",
          error_code: "local_runner_schedule_failed",
          error_message: "Local runner is unavailable",
        }),
      ]);
      expect(productStore.listRetainedTerminalSourceFiles({
        failedBefore: new Date(Date.now() + 1_000).toISOString(),
      })).toEqual([
        expect.objectContaining({ source_file_key: expect.stringMatching(/^memory\/job_/) }),
      ]);
    } finally {
      productStore.close();
    }
  } finally {
    fixture.database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local Document submission rejects unsafe input before Source file storage", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-submit-safety-"));
  const fixture = await createAuthenticatedLocalWorkspace(stateDirectory);
  const writtenSourceFiles: string[] = [];
  const sourceFileStore = {
    delete: async () => {},
    eraseWorkspace: async () => {},
    read: async () => null,
    write: async ({ jobId }: { jobId: string }) => {
      writtenSourceFiles.push(jobId);
      return `memory/${jobId}/source.bin`;
    },
  };
  const application = createLocalApplication({
    auth: fixture.auth,
    maxSourceFileBytes: 100,
    sourceFileStore,
    stateDirectory,
    workspaceControl: fixture.control,
  });

  try {
    const templateId = await starterTemplateId(application, fixture.headers);
    const unsupported = await submitDocument(
      application,
      fixture.headers,
      templateId,
      new File(["plain text"], "invoice.txt", { type: "text/plain" }),
    );
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ error: { code: "invalid_document" } });

    const malformedPdf = await submitDocument(
      application,
      fixture.headers,
      templateId,
      new File(["not a pdf"], "invoice.pdf", { type: "application/pdf" }),
    );
    expect(malformedPdf.status).toBe(400);
    await expect(malformedPdf.json()).resolves.toMatchObject({ error: { code: "invalid_pdf_source_file" } });

    const oversizedApplication = createLocalApplication({
      auth: fixture.auth,
      maxSourceFileBytes: 3,
      sourceFileStore,
      stateDirectory,
      workspaceControl: fixture.control,
    });
    const oversized = await submitPngDocument(oversizedApplication, fixture.headers, templateId);
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "source_file_too_large" } });
    expect(writtenSourceFiles).toEqual([]);
  } finally {
    fixture.database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("known oversized bodies use the same authenticated preflight for sessions and Workspace API keys", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-body-preflight-"));
  const fixture = await createAuthenticatedLocalWorkspace(stateDirectory);
  let scheduledJobs = 0;
  const maximumSourceBytes = 100;
  const application = createLocalApplication({
    auth: fixture.auth,
    maxSourceFileBytes: maximumSourceBytes,
    scheduleQueuedJob: () => {
      scheduledJobs += 1;
    },
    stateDirectory,
    workspaceControl: fixture.control,
  });
  const session = await fixture.auth.getSession(new Request("http://127.0.0.1", {
    headers: fixture.headers,
  }));
  const rotated = fixture.control.rotateApiKey({
    userId: session!.id,
    workspaceId: fixture.workspace.id,
  });
  const limit = localDocumentRequestBodyLimit(maximumSourceBytes);

  try {
    for (const headers of [
      fixture.headers,
      { authorization: `Bearer ${rotated.api_key}` },
    ]) {
      const form = new FormData();
      form.set("template_id", "template_unused");
      form.set("document", new File([new Uint8Array([1])], "source.png", { type: "image/png" }));
      const requestHeaders = new Headers(headers);
      requestHeaders.set("content-length", String(limit + 1));
      const response = await application(new Request("http://127.0.0.1/v1/extract", {
        method: "POST",
        headers: requestHeaders,
        body: form,
      }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "source_file_too_large",
          message: `Request exceeds max size of ${limit} bytes`,
        },
      });
    }
    expect(scheduledJobs).toBe(0);
    const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: fixture.workspace.id });
    expect(store.countExtractionJobs()).toBe(0);
    expect(store.listTemplates()).toEqual([]);
    store.close();
  } finally {
    fixture.database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

async function createAuthenticatedLocalWorkspace(stateDirectory: string) {
  const database = new Database(":memory:");
  const verificationLinks: string[] = [];
  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        const url = message.text.match(/https?:\/\/\S+/)?.[0];
        if (url) verificationLinks.push(url);
      },
    },
    secret: "01234567890123456789012345678901",
  });
  const control = createLocalWorkspaceControl(database);
  await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
  }));
  await auth.handler(new Request(verificationLinks[0]!, { redirect: "manual" }));
  const signIn = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
  }));
  const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0]!;
  const session = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie } }));
  const workspace = control.listAcceptedWorkspaces({ userId: session!.id, userName: session!.name })[0]!;
  configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
  return { auth, control, database, headers: { cookie, "x-workspace-id": workspace.id }, workspace };
}

async function starterTemplateId(application: FetchApplication, headers: Record<string, string>): Promise<string> {
  const templates = await application(new Request("http://127.0.0.1:8787/v1/templates", { headers }));
  return ((await templates.json()) as { templates: Array<{ id: string }> }).templates[0]!.id;
}

async function submitPngDocument(
  application: FetchApplication,
  headers: Record<string, string>,
  templateId: string,
): Promise<Response> {
  return submitDocument(
    application,
    headers,
    templateId,
    new File([new Uint8Array([137, 80, 78, 71])], "invoice.png", { type: "image/png" }),
  );
}

async function submitDocument(
  application: FetchApplication,
  headers: Record<string, string>,
  templateId: string,
  document: File,
): Promise<Response> {
  const formData = new FormData();
  formData.append("template_id", templateId);
  formData.append("document", document);
  return application(new Request("http://127.0.0.1:8787/v1/extract", { method: "POST", headers, body: formData }));
}

const INVOICE_TEMPLATE = {
  templateId: "tpl_invoice",
  name: "Invoice",
  description: "Extract invoice details.",
  fields: [
    { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" as const },
  ],
  createdAt: "2026-07-09T12:00:00.000Z",
};

async function withProductStore(
  run: (store: LocalWorkspaceProductStore, stateDirectory: string) => Promise<void>,
): Promise<void> {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-product-store-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace_research" });
  try {
    await run(store, stateDirectory);
  } finally {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}
