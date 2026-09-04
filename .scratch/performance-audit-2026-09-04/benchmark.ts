import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkspaceProductStore } from '../../backend/src/localWorkspaceProductStore';
import { createDocumentReconciliation } from '../../frontend/src/features/documents/documentReconciliation.js';

// Synthetic data only; no local runtime state or model endpoints are used.
const out: any = { bun: Bun.version, cpu: cpus()[0]?.model, samples: [] };
function measure(fn: () => unknown, count = 9) {
  fn(); fn();
  const times = Array.from({ length: count }, () => {
    const start = performance.now(); fn(); return performance.now() - start;
  }).sort((a, b) => a - b);
  return { medianMs: times[Math.floor(count / 2)], maxMs: times.at(-1) };
}
const source = readFileSync(new URL('../../backend/src/localWorkspaceProductStore.ts', import.meta.url), 'utf8');
const select = source.match(/const select = `([^`]+)`/)![1];
const oldCursor = `${select} WHERE (j.created_at < ? OR (j.created_at = ? AND j.id < ?)) ORDER BY j.created_at DESC, j.id DESC LIMIT 51`;
const newCursor = `${select} WHERE (j.created_at, j.id) < (?, ?) ORDER BY j.created_at DESC, j.id DESC LIMIT 51`;
const oldRetention = `SELECT j.id AS job_id, s.key AS source_file_key FROM jobs j JOIN source_files s ON s.job_id = j.id WHERE s.deleted_at IS NULL AND (j.status = 'completed' OR (j.status = 'failed' AND j.updated_at <= ?)) ORDER BY j.updated_at ASC, j.id ASC LIMIT ?`;
const newRetention = `SELECT j.id AS job_id, s.key AS source_file_key FROM source_files s CROSS JOIN jobs j ON j.id = s.job_id WHERE s.deleted_at IS NULL AND (j.status = 'completed' OR (j.status = 'failed' AND j.updated_at <= ?)) ORDER BY j.updated_at ASC, j.id ASC LIMIT ?`;
for (const n of [100_000, 1_000_000]) {
  const dir = mkdtempSync(join(tmpdir(), 'extraction-perf-'));
  const store = createLocalWorkspaceProductStore({ stateDirectory: dir, workspaceId: 'bench' });
  const db = new Database(join(dir, 'data/workspaces/bench.sqlite'));
  try {
    out.sqlite = db.query('SELECT sqlite_version() AS version').get();
    const stamp = (i: number) => new Date(1700000000000 + Math.floor(i / 10) * 1000).toISOString();
    const id = (i: number) => `job_${String(i).padStart(9, '0')}`;
    const job = db.prepare(`INSERT INTO jobs (id, template_id, template_version, status, source_file_key, source_mime_type, source_name, created_at, updated_at) VALUES (?, 'tpl', 1, 'completed', ?, 'application/pdf', ?, ?, ?)`);
    const file = db.prepare(`INSERT INTO source_files (key, job_id, mime_type, created_at, deleted_at) VALUES (?, ?, 'application/pdf', ?, ?)`);
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        job.run(id(i), id(i), `invoice-${i}.pdf`, stamp(i), stamp(i));
        file.run(id(i), id(i), stamp(i), stamp(i));
      }
    })();
    const cursor = { createdAt: stamp(Math.floor(n / 10)), jobId: id(Math.floor(n / 10)) };
    const currentPage = () => store.listExtractionJobs({ cursor, limit: 51 });
    const candidatePage = () => db.query(newCursor).all(cursor.createdAt, cursor.jobId);
    if (JSON.stringify(currentPage()) !== JSON.stringify(candidatePage())) throw new Error('Cursor result mismatch');
    const sample: any = { n, cursor90Percent: { current: measure(currentPage), candidate: measure(candidatePage), equal: true },
      cursorPlan: { originalSQL: db.query('EXPLAIN QUERY PLAN ' + oldCursor).all(cursor.createdAt, cursor.createdAt, cursor.jobId), tupleSeekSQL: db.query('EXPLAIN QUERY PLAN ' + newCursor).all(cursor.createdAt, cursor.jobId) },
      firstPage: measure(() => store.listExtractionJobs({ limit: 51 })),
      noMatchSearch: measure(() => store.listExtractionJobs({ search: 'does-not-exist', limit: 51 }), 5),
      count: measure(() => store.countExtractionJobs()),
      retentionEmpty: { current: measure(() => store.listRetainedTerminalSourceFiles({ failedBefore: stamp(n), limit: 500 }), 5) },
    };
    db.exec('CREATE INDEX idx_audit_uncleaned ON source_files(job_id, key) WHERE deleted_at IS NULL');
    sample.retentionEmpty.candidate = measure(() => db.query(newRetention).all(stamp(n), 500));
    sample.retentionPlan = { originalSQL: db.query('EXPLAIN QUERY PLAN ' + oldRetention).all(stamp(n), 500), sourceFirstSQL: db.query('EXPLAIN QUERY PLAN ' + newRetention).all(stamp(n), 500) };
    db.exec(`UPDATE source_files SET deleted_at = NULL WHERE job_id IN (SELECT id FROM jobs ORDER BY id DESC LIMIT 100)`);
    if (JSON.stringify(store.listRetainedTerminalSourceFiles({ failedBefore: stamp(n), limit: 500 })) !== JSON.stringify(db.query(newRetention).all(stamp(n), 500))) throw new Error('Retention result mismatch');
    sample.retention100 = { current: measure(() => store.listRetainedTerminalSourceFiles({ failedBefore: stamp(n), limit: 500 }), 5), candidate: measure(() => db.query(newRetention).all(stamp(n), 500)), equal: true };
    db.exec("UPDATE jobs SET status = 'queued', completed_at = NULL");
    sample.recoveryQueued = measure(() => store.recoverExtractionJobs({ limit: 1000, maxAttempts: 3, recoveredAt: stamp(n), staleProcessingBefore: stamp(0) }), 5);
    out.samples.push(sample);
    console.error(`Finished ${n} rows`);
  } finally { db.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
}
out.reconciliation = [];
for (const n of [50, 1000, 10000]) {
  const cache = { get: () => null, clearAll() {} };
  const reconciliation = createDocumentReconciliation({ cache });
  reconciliation.configure({ sessionId: 'session', workspaceId: 'workspace', enabled: true, requests: {} });
  const jobs = Array.from({ length: n }, (_, i) => ({ job_id: `job_${i}`, status: 'queued', source_name: `Invoice ${i}`, created_at: new Date(1700000000000 + i * 1000).toISOString() }));
  reconciliation.receiveLiveUpdates(jobs);
  out.reconciliation.push({ n, selection: measure(() => reconciliation.selectDocument('job_0')), liveUpdate: measure(() => reconciliation.receiveLiveUpdates([{ ...jobs[0], status: 'processing' }])) });
  reconciliation.dispose();
}
console.log(JSON.stringify(out, null, 2));
