import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { createLocalWorkspaceProductStore, openLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalResourceController } from "./localResourceController";
import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalSourceFileStore } from "./localSourceFileStore";

test("indexed search preserves literal substring semantics, lifecycle updates and deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extraction-search-index-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory: dir, workspaceId: "test" });
  const names = ['Invoice 100%_paid\\today.pdf', 'say "hello".pdf', 'école 中文文档.pdf', 'QUEUED-REPORT.pdf', 'nothing.pdf'];
  try {
    names.forEach((name, i) => store.createQueuedExtractionJob({ jobId: `job_${i}`, templateId: "tpl_test", templateVersion: 1, sourceFileKey: `source_${i}`, sourceMimeType: "application/pdf", sourceName: name, sourceFilePageCount: 1, submittedAt: "2026-09-04T12:00:00.000Z" }));
    const db = new Database(join(dir, "data/workspaces/test.sqlite"));
    try {
      for (const search of ['invoice', '100%_', '_paid\\', '"hello"', 'école', '中文文', 'qu', '%', '_', '\\', 'jOb_1', 'tpl_test', 'does not exist', ' OR ', '"']) {
        const term = search.trim().toLowerCase();
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
        const expected = db.query(`SELECT id FROM jobs WHERE LOWER(COALESCE(source_name, '')) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\' OR LOWER(template_id) LIKE ? ESCAPE '\\' OR LOWER(status) LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id DESC`).all(pattern, pattern, pattern, pattern) as { id: string }[];
        expect(store.listExtractionJobs({ search }).map((job) => job.job_id)).toEqual(expected.map((row) => row.id));
      }
      store.failQueuedExtractionJob({ jobId: "job_0", failedAt: "2026-09-04T12:01:00.000Z", errorCode: "test", errorMessage: "test" });
      expect(store.listExtractionJobs({ search: "failed" }).map((job) => job.job_id)).toEqual(["job_0"]);
      expect(store.listExtractionJobs({ search: "queued" })).toHaveLength(4);
      expect(store.countExtractionJobs()).toBe(5);
      store.deleteExtractionJob({ jobId: "job_0" });
      expect(store.listExtractionJobs({ search: "invoice" })).toEqual([]);
      expect(store.countExtractionJobs()).toBe(4);
      db.transaction(() => {
        db.exec("DELETE FROM jobs");
        expect(store.countExtractionJobs()).toBe(4); // separate connection cannot see an uncommitted transaction
      })();
      expect(store.countExtractionJobs()).toBe(0);
    } finally { db.close(); }
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("search and count migration backfills an existing history once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extraction-search-migration-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory: dir, workspaceId: "test" });
  store.createQueuedExtractionJob({ jobId: "job_old", templateId: "tpl", templateVersion: 1, sourceFileKey: "old", sourceMimeType: "image/png", sourceName: "old invoice", sourceFilePageCount: null, submittedAt: "2026-09-04T12:00:00.000Z" });
  store.close();
  const db = new Database(join(dir, "data/workspaces/test.sqlite"));
  db.exec(`DROP TRIGGER jobs_count_insert; DROP TRIGGER jobs_count_delete;
    DROP TRIGGER jobs_search_insert; DROP TRIGGER jobs_search_delete; DROP TRIGGER jobs_search_update;
    DROP TABLE job_totals; DROP TABLE job_search; DROP INDEX idx_sources_uncleaned; DROP INDEX idx_jobs_runnable;
    DELETE FROM product_schema_version WHERE version = 4;`);
  db.close();
  try {
    for (let i = 0; i < 2; i++) {
      const reopened = openLocalWorkspaceProductStore({ stateDirectory: dir, workspaceId: "test" })!;
      try {
        expect(reopened.countExtractionJobs()).toBe(1);
        expect(reopened.listExtractionJobs({ search: "invoice" })[0]?.job_id).toBe("job_old");
      } finally { reopened.close(); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("admission samples free disk without scanning Source history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extraction-admission-sampling-"));
  await mkdir(join(dir, "source-files"));
  await writeFile(join(dir, "source-files", "source"), new Uint8Array(123));
  const queue = createLocalExtractionQueue();
  const controller = createLocalResourceController({ stateDirectory: dir, diskReserveBytes: 0, setPermits() {}, getQueueSnapshot: queue.snapshot });
  try {
    expect(await controller.canReserveSubmission({ requestBytes: 1, reservedBytes: 0 })).toBe(true);
    expect(controller.snapshot().disk.availableBytes).toBeGreaterThan(0);
    expect(controller.snapshot().disk.sourceBytes).toBe(0);
    await controller.sampleNow();
    expect(controller.snapshot().disk.sourceBytes).toBe(123);
  } finally { controller.stop(); await queue.close(); await rm(dir, { recursive: true, force: true }); }
});

test("recovery preserves actively owned attempts while recovering abandoned work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extraction-active-recovery-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory: dir, workspaceId: "test" });
  try {
    for (const id of ["active", "abandoned"]) {
      store.createQueuedExtractionJob({ jobId: id, templateId: "tpl", templateVersion: 1, sourceFileKey: id, sourceMimeType: "image/png", sourceName: null, sourceFilePageCount: null, submittedAt: "2026-09-04T12:00:00.000Z" });
      store.claimExtractionJobForProcessing({ jobId: id, attempt: 1, claimedAt: "2026-09-04T12:00:00.000Z" });
    }
    const recovered = store.recoverExtractionJobs({ maxAttempts: 3, recoveredAt: "2026-09-04T13:00:00.000Z", staleProcessingBefore: "2026-09-04T12:55:00.000Z", isJobActive: (id) => id === "active" });
    expect(recovered.map((job) => job.job_id)).toEqual(["abandoned"]);
    expect(store.getExtractionJobSummary("active")?.status).toBe("processing");
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Source deletion removes only its empty job directory and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extraction-source-directories-"));
  const sources = createLocalSourceFileStore({ stateDirectory: dir });
  try {
    const key = await sources.write({ workspaceId: "test", jobId: "job", mimeType: "image/png", bytes: new Uint8Array([1]) });
    const jobDir = join(dir, "source-files/workspaces/test/jobs/job");
    await writeFile(join(jobDir, "sibling"), "keep");
    await sources.delete(key);
    expect(await stat(join(jobDir, "sibling"))).toBeDefined();
    await rm(join(jobDir, "sibling"));
    await sources.delete(key);
    await sources.delete(key);
    expect(await stat(jobDir).catch(() => null)).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
