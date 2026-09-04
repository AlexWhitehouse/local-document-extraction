import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkspaceProductStore } from '../../backend/src/localWorkspaceProductStore';
import { createLocalExtractionQueue } from '../../backend/src/localExtractionQueue';
import { createLocalResourceController } from '../../backend/src/localResourceController';
import { runExtraction } from '../../backend/src/consumer/modelGateway';

const results: any = { bun: Bun.version, writes: [], storageSamples: [] };
const stamp = '2026-09-04T12:00:00.000Z';
for (const mode of ['DELETE', 'WAL']) {
  const dir = mkdtempSync(join(tmpdir(), 'extraction-writes-'));
  const store = createLocalWorkspaceProductStore({ stateDirectory: dir, workspaceId: 'bench' });
  const db = new Database(join(dir, 'data/workspaces/bench.sqlite'));
  try {
    db.exec(`PRAGMA journal_mode = ${mode}`);
    results.sqlite = store.diagnostics();
    store.createTemplate({ templateId: 'tpl', name: 'Benchmark', description: null, fields: [{ id: 'value', name: 'Value', description: '', data_type: 'string' }], createdAt: stamp });
    const times: number[] = [];
    for (let i = 0; i < 250; i++) {
      const jobId = `job_${i}`;
      const start = performance.now();
      store.createQueuedExtractionJob({ jobId, templateId: 'tpl', templateVersion: 1, sourceFileKey: jobId, sourceMimeType: 'image/png', sourceName: null, sourceFilePageCount: null, submittedAt: stamp });
      store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: stamp });
      store.recordExtractionJobModel({ jobId, attempt: 1, modelName: 'synthetic', route: 'chat' });
      store.completeExtractionJob({ jobId, attempt: 1, completedAt: stamp, modelName: 'synthetic', route: 'chat', results: [] });
      store.markSourceFileCleaned({ jobId, sourceFileKey: jobId, cleanedAt: stamp });
      if (i >= 20) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    results.writes.push({ mode, actualMode: store.diagnostics().journalMode, synchronous: store.diagnostics().synchronous, medianLifecycleMs: times[Math.floor(times.length / 2)], p95LifecycleMs: times[Math.floor(times.length * .95)] });
  } finally { db.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
}

for (const n of [1000, 10000]) {
  const dir = mkdtempSync(join(tmpdir(), 'extraction-dirs-'));
  try {
    for (let i = 0; i < n; i++) mkdirSync(join(dir, 'source-files/workspaces/bench/jobs', `job_${i}`), { recursive: true });
    const controller = createLocalResourceController({ stateDirectory: dir, setPermits() {}, getQueueSnapshot: () => ({ pending: 0, active: 0, deferred: 0 }) as any });
    const start = performance.now();
    await controller.sampleNow();
    const sampleMs = performance.now() - start;
    const admissionController = createLocalResourceController({ stateDirectory: dir, setPermits() {}, getQueueSnapshot: () => ({ pending: 0, active: 0, deferred: 0 }) as any });
    const admissionStart = performance.now();
    await admissionController.canReserveSubmission({ requestBytes: 1024, reservedBytes: 0 });
    results.storageSamples.push({ emptyJobDirectories: n, sampleMs, admissionCheckMs: performance.now() - admissionStart, sourceBytes: controller.snapshot().disk.sourceBytes });
    controller.stop();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Use the real queue and gateway scheduler, with all HTTP replaced locally.
const originalFetch = globalThis.fetch;
const releases: Array<() => void> = [];
const calls: string[] = [];
globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
  calls.push(JSON.parse(String(init.body)).model);
  await new Promise<void>((resolve) => releases.push(resolve));
  return Response.json({ choices: [{ message: { content: '{"results":[]}' } }] });
}) as any;
const queue = createLocalExtractionQueue({ maxConcurrent: 8, getWorkspaceMaxConcurrent: () => 1 });
queue.subscribe(async (job) => {
  await runExtraction({ AI_MODEL: job.workspace_id, MODEL_GATEWAY_URL: 'https://synthetic.invalid', LITELLM_KEY: 'synthetic', MODEL_GATEWAY_WORKSPACE_ID: job.workspace_id, MODEL_GATEWAY_SEQUENTIAL_CALLS: 'true' }, [], new ArrayBuffer(1024), 'image/png');
});
try {
  for (let i = 0; i < 8; i++) await queue.schedule({ job_id: `a_${i}`, workspace_id: 'workspace-a', template_id: 'tpl', template_version: 1, enqueued_at: stamp });
  await queue.schedule({ job_id: 'b_0', workspace_id: 'workspace-b', template_id: 'tpl', template_version: 1, enqueued_at: stamp });
  await Bun.sleep(10);
  results.sequentialScheduling = { queue: queue.snapshot(), gatewayCallsStarted: [...calls] };
  while (queue.snapshot().active || queue.snapshot().pending) {
    for (const release of releases.splice(0)) release();
    await Bun.sleep(1);
  }
  await queue.waitForIdle();
} finally { await queue.close(); globalThis.fetch = originalFetch; }
console.log(JSON.stringify(results, null, 2));
