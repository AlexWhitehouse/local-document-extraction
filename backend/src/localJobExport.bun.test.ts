import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import ExcelJS from "exceljs";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("job export returns a best-effort authenticated workbook for terminal jobs", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-job-export-"));
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
    const signUp = await auth.handler(new Request(
      "http://127.0.0.1:8787/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@example.com",
          password: "Strong1!",
        }),
      },
    ));
    const user = await signUp.json() as { user: { id: string; name: string } };
    const workspace = workspaceControl.listAcceptedWorkspaces({
      userId: user.user.id,
      userName: user.user.name,
    })[0]!;
    seedJobs({ stateDirectory, workspaceId: workspace.id });
    const apiKey = workspaceControl.rotateApiKey({
      workspaceId: workspace.id,
      userId: user.user.id,
    }).api_key;
    const application = createLocalApplication({
      auth,
      stateDirectory,
      workspaceControl,
    });
    const oversized = await application(exportRequest(apiKey, Array.from({ length: 501 }, (_, i) => `job_${i}`)));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "export_too_large" } });

    const detailResponse = await application(new Request(
      "http://127.0.0.1:8787/v1/jobs/job_completed",
      { headers: { authorization: `Bearer ${apiKey}` } },
    ));
    expect(await detailResponse.json()).toMatchObject({
      job_id: "job_completed",
      model_name: "test-model",
    });
    const listResponse = await application(new Request(
      "http://127.0.0.1:8787/v1/jobs",
      { headers: { authorization: `Bearer ${apiKey}` } },
    ));
    expect(await listResponse.json()).toMatchObject({
      jobs: expect.arrayContaining([
        expect.objectContaining({
          job_id: "job_completed",
          model_name: "test-model",
        }),
      ]),
    });

    const response = await application(exportRequest(apiKey, [
      "job_completed",
      "job_failed",
      "job_queued",
      "job_missing",
    ]));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="ada-lovelace-workspace-job-export-.*\.xlsx"$/,
    );
    expect(response.headers.get("x-exported-job-count")).toBe("2");
    expect(response.headers.get("x-skipped-job-count")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "Invoice — Headers",
      "Invoice — Line Items",
    ]);
    const headerRows = records(workbook.getWorksheet("Invoice — Headers")!);
    expect(headerRows).toEqual([
      expect.objectContaining({
        "Job ID": "job_failed",
        "Job Status": "failed",
        "Error Code": "extract_failed",
        "Error Message": "OCR failed",
        "Model Name": "test-failure-model",
      }),
      expect.objectContaining({
        "Job ID": "job_completed",
        "Job Status": "completed",
        "Model Name": "test-model",
        "Invoice Number": "INV-42",
      }),
    ]);

    const noneResponse = await application(exportRequest(apiKey, [
      "job_queued",
      "job_missing",
    ]));
    expect(noneResponse.status).toBe(409);
    expect(await noneResponse.json()).toEqual({
      error: {
        code: "no_exportable_jobs",
        message: "None of the selected jobs are completed or failed",
      },
    });

    const invalidResponse = await application(new Request(
      "http://127.0.0.1:8787/v1/jobs/export",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ job_ids: [] }),
      },
    ));
    expect(invalidResponse.status).toBe(400);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function seedJobs({
  stateDirectory,
  workspaceId,
}: {
  stateDirectory: string;
  workspaceId: string;
}): void {
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: null,
      fields: [
        {
          id: "invoice_number",
          name: "Invoice Number",
          description: "Invoice identifier.",
          data_type: "string",
        },
        {
          id: "line_items",
          name: "Line Items",
          description: [
            "Invoice rows.",
            "[[OBJECT_SCHEMA]]",
            JSON.stringify({
              columns: [
                { key: "description", heading: "Description", data_type: "string" },
              ],
            }),
            "[[/OBJECT_SCHEMA]]",
          ].join("\n"),
          data_type: "array<object>",
        },
      ],
      createdAt: "2026-08-16T09:00:00.000Z",
    });
    for (const [index, jobId] of [
      "job_completed",
      "job_failed",
      "job_queued",
    ].entries()) {
      store.createQueuedExtractionJob({
        jobId,
        templateId: "tpl_invoice",
        templateVersion: 1,
        sourceFileKey: `workspaces/${workspaceId}/jobs/${jobId}/source.pdf`,
        sourceMimeType: "application/pdf",
        sourceName: `${jobId}.pdf`,
        sourceFilePageCount: index + 1,
        submittedAt: `2026-08-16T09:0${index}:00.000Z`,
      });
    }
    store.claimExtractionJobForProcessing({
      jobId: "job_completed",
      attempt: 1,
      claimedAt: "2026-08-16T09:10:00.000Z",
    });
    store.completeExtractionJob({
      jobId: "job_completed",
      attempt: 1,
      completedAt: "2026-08-16T09:11:00.000Z",
      modelName: "test-model",
      route: "test-route",
      results: [
        {
          field_id: "invoice_number",
          status: "ok",
          answer: "INV-42",
          normalized_value: "INV-42",
          confidence: 0.99,
          evidence: "INV-42",
        },
        {
          field_id: "line_items",
          status: "ok",
          answer: [{ description: "Consulting" }],
          normalized_value: null,
          confidence: 0.91,
          evidence: "Consulting",
        },
      ],
    });
    store.claimExtractionJobForProcessing({
      jobId: "job_failed",
      attempt: 1,
      claimedAt: "2026-08-16T09:12:00.000Z",
    });
    store.failExtractionJob({
      jobId: "job_failed",
      attempt: 1,
      failedAt: "2026-08-16T09:13:00.000Z",
      errorCode: "extract_failed",
      errorMessage: "OCR failed",
      modelName: "test-failure-model",
      route: "test-failure-route",
    });
  } finally {
    store.close();
  }
}

function exportRequest(apiKey: string, jobIds: string[]): Request {
  return new Request("http://127.0.0.1:8787/v1/jobs/export", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ job_ids: jobIds }),
  });
}

function records(worksheet: ExcelJS.Worksheet): Array<Record<string, unknown>> {
  const headings = (worksheet.getRow(1).values as unknown[]).slice(1).map(String);
  return Array.from({ length: Math.max(worksheet.rowCount - 1, 0) }, (_, index) => {
    const values = (worksheet.getRow(index + 2).values as unknown[]).slice(1);
    return Object.fromEntries(headings.map((heading, valueIndex) => [
      heading,
      values[valueIndex] ?? null,
    ]));
  });
}
