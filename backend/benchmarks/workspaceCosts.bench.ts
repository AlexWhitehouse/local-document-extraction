import { type SQLQueryBindings, Database } from "bun:sqlite";
/** Synthetic completed read models at scale, followed by real ingestion/projection interleaved with reads. */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { createLocalWorkspaceProductStore } from "../src/localWorkspaceProductStore";
import { emptyCosts, emptyMetrics } from "../src/workspaceCostProjection";
import { costAmount } from "../../shared/processingCosts";
import { parseCostRange, type CostDocument, type CostUpload } from "../../shared/workspaceCosts";
import { readModelCallUsage } from "../src/consumer/modelUsage";

const documents = Number(process.env.COST_BENCH_DOCUMENTS ?? 1_200_000);

if (!Number.isSafeInteger(documents) || documents < 1000 || documents > 5_000_000)
  throw new Error("COST_BENCH_DOCUMENTS must be between 1000 and 5000000");

const scratch = resolve(import.meta.dir, "../../.scratch");

mkdirSync(scratch, { recursive: true });

const stateDirectory = mkdtempSync(join(scratch, "cost-benchmark-"));

const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "benchmark" });

store.closeCostUpdates();

const path = join(stateDirectory, "data/workspaces/benchmark.sqlite");

const db = new Database(path);

db.exec("PRAGMA synchronous=FULL; PRAGMA busy_timeout=250");

const year = parseCostRange("2025-10-05", "2026-10-05", "day");

const upload = db.query("INSERT INTO cost_uploads VALUES(?,?,?,?,?,?,?,?,?)");

const document = db.query("INSERT INTO cost_documents VALUES(?,?,?,?,?,?,?)");

const populations = new Map<string, number>();

const costs = emptyCosts();

costs.extraction = costs.total = costAmount(0.01, 1, 0);

const metric = {
  ...emptyMetrics(),
  costs,
  documents: 1,
  pages: 2,
  fullyCostedDocuments: 1,
  fullyCostedPages: 2,
  fullyCostedAmount: 0.01,
};

const metricJSON = JSON.stringify(metric);

const durations: Record<string, number[]> = {};

function timed<T>(name: string, task: () => T): T {
  const start = performance.now();
  const result = task();
  (durations[name] ??= []).push(performance.now() - start);

  return result;
}

try {
  const seedStart = performance.now();

  // Bulk-load fixtures without maintaining secondary indexes row by row. Restore the exact
  // production indexes and rebuild FTS before any measurements or real ingestion.
  const indexes = db
    .query<{ type: string; name: string; sql: string }, SQLQueryBindings[]>(
      "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND ((type='index' AND name LIKE 'cost_%') OR (type='trigger' AND name LIKE 'cost_search_%'))",
    )
    .all();

  for (const entry of indexes) db.exec(`DROP ${entry.type.toUpperCase()} ${entry.name}`);

  const batch = db.transaction((first: number, end: number) => {
    for (let index = first; index < end; index++) {
      const id = `benchmark_${String(index).padStart(8, "0")}`;
      const created_at = new Date(Date.parse(year.start) + (index % 365) * 86400000 + 12 * 3600000).toISOString();
      const day = created_at.slice(0, 10);

      const item: CostUpload = {
        id,
        kind: "document",
        name: `${id}.pdf`,
        created_at,
        pages: 2,
        pageNumbers: [1, 2],
        excludedPages: 0,
        excludedPageNumbers: [],
        documentCount: 1,
        deleted: false,
        status: "completed",
        costs,
      };

      const child: CostDocument = {
        id,
        kind: "document",
        name: item.name,
        created_at,
        pages: 2,
        pageNumbers: [1, 2],
        templateId: "invoice",
        template: "Invoice",
        status: "completed",
        deleted: false,
        retried: false,
        costs,
      };

      upload.run(id, day, created_at, 0, 0.01, 0.005, JSON.stringify(item), metricJSON, `${item.name} invoice`);
      document.run(
        id,
        id,
        day,
        created_at,
        1,
        createHash("sha256").update(id).digest("hex").slice(0, 16),
        JSON.stringify(child),
      );
      populations.set(day, (populations.get(day) ?? 0) + 1);
    }
  });

  for (let first = 0; first < documents; first += 5000) {
    batch(first, Math.min(documents, first + 5000));

    if ((first + 5000) % 100000 === 0) console.log(JSON.stringify({ seeded: Math.min(documents, first + 5000) }));
    await Bun.sleep(0);
  }

  db.transaction(() => {
    for (const [day, count] of populations) {
      const sum = emptyCosts();
      sum.extraction = sum.total = costAmount(count * 0.01, count, 0);

      const data = JSON.stringify({
        ...metric,
        costs: sum,
        documents: count,
        pages: count * 2,
        fullyCostedDocuments: count,
        fullyCostedPages: count * 2,
        fullyCostedAmount: count * 0.01,
      });

      db.query("INSERT INTO cost_buckets VALUES(?,?)").run(day, data);
      db.query("INSERT INTO cost_buckets VALUES(?,?)").run(`${day}T12`, data);
    }

    db.exec("UPDATE cost_backfill SET phase='done',cursor=0");
  })();

  for (const entry of indexes) db.exec(entry.sql);
  db.exec("INSERT INTO cost_upload_search(cost_upload_search) VALUES('rebuild')");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); ANALYZE");
  console.log(
    JSON.stringify({
      documents,
      seedSeconds: (performance.now() - seedStart) / 1000,
      databaseMiB: statSync(path).size / 1048576,
    }),
  );
  const overview = timed("year overview + serialization", () => JSON.stringify(store.getCostOverview(year)));
  console.log(
    JSON.stringify({ overviewBytes: Buffer.byteLength(overview), samples: JSON.parse(overview).samples.length }),
  );
  const uploadedAt = "2026-10-04T12:00:00.000Z";
  store.createTemplate({
    templateId: "invoice",
    name: "Invoice",
    description: null,
    fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" }],
    createdAt: uploadedAt,
  });

  for (let iteration = 0; iteration < 30; iteration++) {
    timed("ingestion + receipt + completion", () => {
      const jobId = `new_${iteration}`;
      store.createQueuedExtractionJob({
        jobId,
        templateId: "invoice",
        templateVersion: 1,
        sourceFileKey: `${jobId}/source.pdf`,
        sourceMimeType: "application/pdf",
        sourceName: `${jobId}.pdf`,
        sourceFilePageCount: 2,
        submittedAt: uploadedAt,
      });
      store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: uploadedAt });

      const call = store.modelCallObserver({
        ownerId: jobId,
        stage: "extraction",
        model: "model",
        configurationRevision: 1,
        now: () => uploadedAt,
      });

      call.finished(call.started(), readModelCallUsage({ usage: { cost: 0.01 } }));
      store.completeExtractionJob({
        jobId,
        attempt: 1,
        completedAt: uploadedAt,
        modelName: "model",
        route: "text",
        results: [],
      });
    });
    timed("incremental summary batch", () => store.processCostUpdates());
    timed("year overview + serialization", () => JSON.stringify(store.getCostOverview(year)));

    for (const sort of ["recent", "total", "perPage"] as const) {
      const first = timed(`year list ${sort}`, () => store.listCostUploads({ ...year, sort, kind: "all", search: "" }));
      timed(`year list ${sort} next`, () =>
        store.listCostUploads({ ...year, sort, kind: "all", search: "", cursor: first.cursor }),
      );
    }

    timed("year sparse search batch", () =>
      store.listCostUploads({ ...year, sort: "total", kind: "all", search: "nonexistent" }),
    );
    await Bun.sleep(5);
  }

  const stats = Object.fromEntries(
    Object.entries(durations).map(([name, values]) => {
      values.sort((a, b) => a - b);

      return [
        name,
        {
          samples: values.length,
          p50Ms: +values[Math.floor(values.length * 0.5)]!.toFixed(2),
          p95Ms: +values[Math.floor(values.length * 0.95)]!.toFixed(2),
          maxMs: +values.at(-1)!.toFixed(2),
        },
      ];
    }),
  );

  console.log(JSON.stringify({ runtime: Bun.version, sqlite: store.diagnostics(), stats }, null, 2));

  if (store.getCostOverview(year).totals.documents !== documents + 30)
    throw new Error("Summary did not reconcile after interleaved ingestion");
  console.log(
    JSON.stringify({
      verifiedDocuments: documents + 30,
      queryPlan: db
        .query(
          "EXPLAIN QUERY PLAN SELECT id,total_sort FROM cost_uploads WHERE day=? AND (total_sort,id)<(?,?) ORDER BY total_sort DESC,id DESC LIMIT 51",
        )
        .all("2026-01-01", 1, "id"),
    }),
  );
} finally {
  db.close();
  store.close();
  rmSync(stateDirectory, { recursive: true, force: true });
}
