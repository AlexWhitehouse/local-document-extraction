import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createLocalApplication } from "./localApplication";

import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { pdfWithPageTreeInObjectStream } from "./testing/pdfSourceFixtures";
import { PDF_INSPECTION_LIMITS } from "./lib/pdfInspectionLimits";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

test.each(["/v1/extract", "/v1/templates/generate"])(
  "%s rejects compressed PDF expansion before durable or gateway side effects",
  async (path) => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "pdf-admission-limits-"));
    cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));

    const workspace = workspaceFixture({
      id: "workspace_pdf_limits",
      name: "PDF limits",
      max_source_file_bytes: 1024 * 1024,
    });

    configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
    const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
    cleanups.push(registry.closeAll);
    const lease = registry.acquire({ workspaceId: workspace.id, mode: "existing" })!;

    try {
      lease.store.createTemplate({
        templateId: "tpl_invoice",
        name: "Invoice",
        description: null,
        fields: [{ id: "total", name: "Total", data_type: "number", description: "Invoice total" }],
        createdAt: new Date().toISOString(),
      });
    } finally {
      lease.release();
    }

    const scheduled: string[] = [];

    const application = createLocalApplication({
      auth: { handler: async () => new Response(null), getSession: async () => null },
      workspaceControl: workspaceControlFixture({
        authorizeApiKey: ({ apiKey }: { apiKey: string }) => (apiKey === "test-workspace-key" ? workspace : null),
        hasPendingStarterTemplateBootstrap: () => false,
      }),
      stateDirectory,
      productStoreRegistry: registry,
      sourceFileStore: createLocalSourceFileStore({ stateDirectory }),
      scheduleQueuedJob: async (job) => {
        scheduled.push(job.job_id);
      },
    });

    const gateway = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () =>
          Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: "Invoice",
                    description: "Invoice details",
                    fields: [{ name: "Total", description: "Invoice total", data_type: "number" }],
                  }),
                },
              },
            ],
          }),
        { preconnect: globalThis.fetch.preconnect },
      ),
    );

    cleanups.push(() => gateway.mockRestore());

    const submit = (bytes: Uint8Array) => {
      const body = new FormData();
      body.set("document", new File([new Uint8Array(bytes)], "invoice.pdf", { type: "application/pdf" }));

      if (path === "/v1/extract") body.set("template_id", "tpl_invoice");

      return application(
        new Request(`http://localhost${path}`, {
          method: "POST",
          body,
          headers: { authorization: "Bearer test-workspace-key" },
        }),
      );
    };

    // The page tree must be decoded to count pages, past the inspector's memory ceiling.
    const bomb = pdfWithPageTreeInObjectStream(PDF_INSPECTION_LIMITS.workerHardRssBytes + 64 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const response = await submit(bomb);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "pdf_source_file_limit_exceeded" } });
    expect(gateway).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
    expect(await readdir(join(stateDirectory, "temporary", "submissions"))).toEqual([]);
    expect(await readdir(join(stateDirectory, "source-files", "workspaces", workspace.id)).catch(() => [])).toEqual([]);
    const afterRejection = registry.acquire({ workspaceId: workspace.id, mode: "existing" })!;

    try {
      expect(afterRejection.store.listExtractionJobs({ limit: 10 })).toEqual([]);
    } finally {
      afterRejection.release();
    }

    // A rejected parser must release its process/permit so ordinary work remains usable.
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const valid = await submit(await pdf.save());
    expect(valid.status).toBe(path === "/v1/extract" ? 202 : 200);
    expect(await readdir(join(stateDirectory, "temporary", "submissions"))).toEqual([]);

    if (path === "/v1/extract") {
      expect(scheduled).toHaveLength(1);
      expect(gateway).not.toHaveBeenCalled();
    } else {
      expect(gateway).toHaveBeenCalledTimes(1);
    }
  },
);
