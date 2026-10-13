import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue } from "../../shared/json";
import { indexedFieldValue } from "./jobFieldValueIndex";
import type { FieldDefinition } from "./lib/types";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";

type IndexRow = {
  job_id: string;
  field_id: string;
  data_type: string;
  value_state: string;
  text_value: string | null;
  num_value: number | null;
  date_value: string | null;
  bool_value: number | null;
};

const FIELDS: FieldDefinition[] = [
  { id: "reference", name: "Reference", description: "Reference", data_type: "string" },
  { id: "total", name: "Total", description: "Total", data_type: "number" },
  { id: "issued", name: "Issued", description: "Issued", data_type: "date" },
  { id: "paid", name: "Paid", description: "Paid", data_type: "boolean" },
  { id: "lines", name: "Lines", description: "Lines", data_type: "array<object>" },
];

type SeedResult = [fieldId: string, status: "ok" | "not_found" | "invalid_type" | "unreadable" | "error", answer: JsonValue, normalized: string | null];

function seedCompletedJob(
  store: LocalWorkspaceProductStore,
  { jobId, templateId = "tpl", templateVersion = 1, createdAt, results }: { jobId: string; templateId?: string; templateVersion?: number; createdAt: string; results: SeedResult[] },
) {
  store.createQueuedExtractionJob({
    jobId,
    templateId,
    templateVersion,
    sourceFileKey: `jobs/${jobId}/source.pdf`,
    sourceMimeType: "application/pdf",
    sourceName: `${jobId}.pdf`,
    sourceFilePageCount: 1,
    submittedAt: createdAt,
  });
  store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: createdAt });

  return store.completeExtractionJob({
    jobId,
    attempt: 1,
    completedAt: createdAt,
    modelName: "test-model",
    route: "test-route",
    results: results.map(([field_id, status, answer, normalized_value]) => ({
      field_id,
      status,
      answer,
      normalized_value,
      confidence: 1,
      evidence: null,
    })),
  });
}

async function withWorkspaceStore(run: (store: LocalWorkspaceProductStore, databasePath: string) => void | Promise<void>) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-field-index-"));
  const databasePath = join(stateDirectory, "data", "workspaces", "workspace.sqlite");
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace" });

  try {
    store.createTemplate({ templateId: "tpl", name: "Invoices", description: null, fields: FIELDS, createdAt: "2026-03-01T00:00:00.000Z" });
    await run(store, databasePath);
  } finally {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

function indexRows(databasePath: string): IndexRow[] {
  const database = new Database(databasePath, { readonly: true });

  try {
    return database
      .query<IndexRow, []>(
        "SELECT job_id, field_id, data_type, value_state, text_value, num_value, date_value, bool_value FROM job_field_values ORDER BY job_id, field_id",
      )
      .all();
  } finally {
    database.close();
  }
}

test("stored results map to distinct value states, keeping zero, false and empty apart from missing and invalid", () => {
  expect(indexedFieldValue("string", "ok", "ACME Ltd")).toMatchObject({ value_state: "value", text_value: "ACME Ltd", text_norm: "acme ltd" });
  expect(indexedFieldValue("string", "ok", "")).toMatchObject({ value_state: "empty", text_value: null });
  expect(indexedFieldValue("string", "ok", null)).toMatchObject({ value_state: "missing" });
  expect(indexedFieldValue("string", "not_found", null)).toMatchObject({ value_state: "missing" });
  expect(indexedFieldValue("string", "unreadable", "smudged")).toMatchObject({ value_state: "missing", text_value: null });
  expect(indexedFieldValue("number", "ok", "0")).toMatchObject({ value_state: "value", num_value: 0 });
  expect(indexedFieldValue("number", "ok", "not a number")).toMatchObject({ value_state: "invalid", num_value: null });
  expect(indexedFieldValue("number", "invalid_type", null)).toMatchObject({ value_state: "invalid" });
  expect(indexedFieldValue("number", "error", null)).toMatchObject({ value_state: "invalid" });
  expect(indexedFieldValue("boolean", "ok", "false")).toMatchObject({ value_state: "value", bool_value: 0 });
  expect(indexedFieldValue("boolean", "ok", "maybe")).toMatchObject({ value_state: "invalid" });
  expect(indexedFieldValue("date", "ok", "01/03/2026")).toMatchObject({ value_state: "value", date_value: "2026-03-01" });
  expect(indexedFieldValue("date", "ok", "31/02/2026")).toMatchObject({ value_state: "invalid", date_value: null });
  expect(indexedFieldValue("array<object>", "ok", null)).toBeNull();
  expect(indexedFieldValue("object", "ok", null)).toBeNull();
  expect(indexedFieldValue("array", "ok", null)).toBeNull();
});

test("completing a job indexes its scalar results in the same write, and deleting it removes them", async () => {
  await withWorkspaceStore((store, databasePath) => {
    expect(
      seedCompletedJob(store, {
        jobId: "job_a",
        createdAt: "2026-03-02T00:00:00.000Z",
        results: [
          ["reference", "ok", "", ""],
          ["total", "ok", 0, "0"],
          ["issued", "ok", "31/02/2026", "31/02/2026"],
          ["paid", "ok", false, "false"],
          ["lines", "ok", [{ sku: "A" }], null],
        ],
      }),
    ).toBe(true);

    expect(indexRows(databasePath)).toEqual([
      { job_id: "job_a", field_id: "issued", data_type: "date", value_state: "invalid", text_value: null, num_value: null, date_value: null, bool_value: null },
      { job_id: "job_a", field_id: "paid", data_type: "boolean", value_state: "value", text_value: null, num_value: null, date_value: null, bool_value: 0 },
      { job_id: "job_a", field_id: "reference", data_type: "string", value_state: "empty", text_value: null, num_value: null, date_value: null, bool_value: null },
      { job_id: "job_a", field_id: "total", data_type: "number", value_state: "value", text_value: null, num_value: 0, date_value: null, bool_value: null },
    ]);

    // A stale attempt neither completes the job nor writes index rows.
    store.createQueuedExtractionJob({
      jobId: "job_stale",
      templateId: "tpl",
      templateVersion: 1,
      sourceFileKey: "jobs/job_stale/source.pdf",
      sourceMimeType: "application/pdf",
      sourceName: "stale.pdf",
      sourceFilePageCount: 1,
      submittedAt: "2026-03-03T00:00:00.000Z",
    });
    store.claimExtractionJobForProcessing({ jobId: "job_stale", attempt: 2, claimedAt: "2026-03-03T00:00:00.000Z" });
    expect(
      store.completeExtractionJob({
        jobId: "job_stale",
        attempt: 1,
        completedAt: "2026-03-03T00:01:00.000Z",
        modelName: "test-model",
        route: "test-route",
        results: [{ field_id: "reference", status: "ok", answer: "X", normalized_value: "X", confidence: 1, evidence: null }],
      }),
    ).toBe(false);
    expect(indexRows(databasePath).some((row) => row.job_id === "job_stale")).toBe(false);

    expect(store.deleteExtractionJob({ jobId: "job_a" })).toMatchObject({ job_id: "job_a" });
    expect(indexRows(databasePath)).toEqual([]);
  });
});

test("opening a database created before version 17 backfills the index from completed jobs", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-field-index-backfill-"));
  const databasePath = join(stateDirectory, "data", "workspaces", "workspace.sqlite");

  try {
    const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace" });
    store.createTemplate({ templateId: "tpl", name: "Invoices", description: null, fields: FIELDS, createdAt: "2026-03-01T00:00:00.000Z" });
    seedCompletedJob(store, {
      jobId: "job_old",
      createdAt: "2026-03-02T00:00:00.000Z",
      results: [
        ["reference", "ok", "INV-0042", "INV-0042"],
        ["total", "invalid_type", "lots", null],
        ["issued", "ok", "01/03/2026", "01/03/2026"],
        ["paid", "not_found", null, null],
      ],
    });
    store.createQueuedExtractionJob({
      jobId: "job_queued",
      templateId: "tpl",
      templateVersion: 1,
      sourceFileKey: "jobs/job_queued/source.pdf",
      sourceMimeType: "application/pdf",
      sourceName: "queued.pdf",
      sourceFilePageCount: 1,
      submittedAt: "2026-03-03T00:00:00.000Z",
    });
    store.close();

    const database = new Database(databasePath);
    database.exec(`DROP TRIGGER job_field_values_search_insert; DROP TRIGGER job_field_values_search_delete;
      DROP TRIGGER job_field_values_search_update; DROP TABLE job_field_value_search; DROP TABLE job_field_values;
      DELETE FROM product_schema_version WHERE version = 17;`);
    database.close();

    const reopened = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace" });

    try {
      expect(indexRows(databasePath).map((row) => [row.job_id, row.field_id, row.value_state])).toEqual([
        ["job_old", "issued", "value"],
        ["job_old", "paid", "missing"],
        ["job_old", "reference", "value"],
        ["job_old", "total", "invalid"],
      ]);

      // The trigram index is rebuilt with the backfill, so plain words find the old value.
      const catalog = reopened.getSearchCatalog();

      expect(
        reopened
          .searchExtractionJobs({ filter: { text: "inv-004" }, catalog, cursor: null, limit: 10, countCap: 100, withMatches: true })
          .jobs.map((job) => [job.job_id, job.matches]),
      ).toEqual([
        [
          "job_old",
          [{ template_id: "tpl", field_id: "reference", field_name: "Reference", type: "text", value_state: "value", display: "INV-0042" }],
        ],
      ]);
    } finally {
      reopened.close();
    }

    const check = new Database(databasePath, { readonly: true });

    expect(check.query("SELECT version FROM product_schema_version WHERE version = 17").get()).toEqual({ version: 17 });
    check.close();
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("the catalogue lists active Templates' current fields with frequent short text values", async () => {
  await withWorkspaceStore((store) => {
    const long = "x".repeat(61);

    for (const [index, reference] of ["Acme", "ACME", "Globex", "Acme", long].entries()) {
      seedCompletedJob(store, {
        jobId: `job_${index}`,
        createdAt: `2026-03-0${index + 1}T00:00:00.000Z`,
        results: [["reference", "ok", reference, reference]],
      });
    }

    store.createTemplate({ templateId: "tpl_gone", name: "Gone", description: null, fields: FIELDS, createdAt: "2026-03-01T00:00:00.000Z" });
    store.deleteTemplate({ templateId: "tpl_gone", deletedAt: "2026-03-02T00:00:00.000Z" });
    store.updateTemplate({
      templateId: "tpl",
      fields: [FIELDS[0]!, { id: "total", name: "Amount", description: "Total", data_type: "string" }, FIELDS[4]!],
      updatedAt: "2026-03-09T00:00:00.000Z",
    });

    expect(store.getSearchCatalog()).toEqual({
      templates: [
        {
          id: "tpl",
          name: "Invoices",
          current_version: 2,
          fields: [
            { field_id: "reference", name: "Reference", data_type: "string", type: "text", known_values: ["ACME", "Globex"] },
            { field_id: "total", name: "Amount", data_type: "string", type: "text", known_values: [] },
            { field_id: "lines", name: "Lines", data_type: "array<object>", type: null },
          ],
        },
      ],
      models: ["test-model"],
    });
    expect(store.getSearchFields()).toEqual({
      templates: [
        {
          id: "tpl",
          name: "Invoices",
          current_version: 2,
          fields: [
            { field_id: "reference", name: "Reference", data_type: "string", type: "text" },
            { field_id: "total", name: "Amount", data_type: "string", type: "text" },
            { field_id: "lines", name: "Lines", data_type: "array<object>", type: null },
          ],
        },
      ],
    });
  });
});

test("retrying moves failed jobs to the queue on the current version and reports why others were skipped", async () => {
  await withWorkspaceStore((store) => {
    const queue = (jobId: string, templateId = "tpl") =>
      store.createQueuedExtractionJob({
        jobId,
        templateId,
        templateVersion: 1,
        sourceFileKey: `jobs/${jobId}/source.pdf`,
        sourceMimeType: "application/pdf",
        sourceName: `${jobId}.pdf`,
        sourceFilePageCount: 1,
        submittedAt: "2026-03-02T00:00:00.000Z",
      });

    queue("job_failed");

    for (const attempt of [1, 2, 3]) {
      store.claimExtractionJobForProcessing({ jobId: "job_failed", attempt, claimedAt: "2026-03-02T00:00:00.000Z" });

      if (attempt < 3)
        store.requeueExtractionJob({
          jobId: "job_failed",
          attempt,
          requeuedAt: "2026-03-02T00:00:00.000Z",
          errorCode: "model_gateway_retry",
          errorMessage: "Busy",
          nextRetryAt: "2026-03-02T00:00:00.000Z",
        });
    }

    store.failExtractionJob({ jobId: "job_failed", attempt: 3, failedAt: "2026-03-02T00:01:00.000Z", errorCode: "retry_exhausted", errorMessage: "Busy" });
    store.createTemplate({ templateId: "tpl_gone", name: "Gone", description: null, fields: FIELDS, createdAt: "2026-03-01T00:00:00.000Z" });
    queue("job_orphan", "tpl_gone");
    store.failQueuedExtractionJob({ jobId: "job_orphan", failedAt: "2026-03-02T00:00:00.000Z", errorCode: "x", errorMessage: "x" });
    store.deleteTemplate({ templateId: "tpl_gone", deletedAt: "2026-03-03T00:00:00.000Z" });
    queue("job_queued");
    store.updateTemplate({ templateId: "tpl", fields: FIELDS.slice(0, 2), updatedAt: "2026-03-04T00:00:00.000Z" });

    expect(
      store.retryFailedExtractionJobs({
        jobIds: ["job_failed", "job_orphan", "job_queued", "job_missing"],
        retriedAt: "2026-03-05T00:00:00.000Z",
      }),
    ).toEqual({
      retried: [{ job_id: "job_failed", template_id: "tpl", template_version: 2, attempt: 1 }],
      skipped: [
        { job_id: "job_orphan", reason: "template_unavailable" },
        { job_id: "job_queued", reason: "not_failed" },
        { job_id: "job_missing", reason: "not_found" },
      ],
      reopened_packet_ids: [],
    });

    expect(store.getExtractionJobSummary("job_failed")).toMatchObject({
      status: "queued",
      template_version: 2,
      error_code: null,
      error_message: null,
      current_attempt: 0,
      updated_at: "2026-03-05T00:00:00.000Z",
    });
    expect(store.getExtractionJobCounts().status_counts).toMatchObject({ queued: 2, failed: 1 });

    // Recovery keeps the retried job instead of exhausting its earlier attempts, and the claim succeeds.
    expect(
      store.recoverExtractionJobs({ maxAttempts: 3, recoveredAt: "2026-03-05T00:00:00.000Z", staleProcessingBefore: "2026-03-01T00:00:00.000Z" }),
    ).toContainEqual({ job_id: "job_failed", template_id: "tpl", template_version: 2, attempt: 1 });
    expect(
      store.claimExtractionJobForProcessing({ jobId: "job_failed", attempt: 1, claimedAt: "2026-03-05T00:00:01.000Z" }),
    ).toMatchObject({ template_version: 2, fields: FIELDS.slice(0, 2).map(({ id, name, description, data_type }) => ({ id, name, description, data_type })) });
  });
});
