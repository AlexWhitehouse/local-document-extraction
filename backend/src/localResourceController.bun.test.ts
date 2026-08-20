import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalExtractionQueue } from "./localExtractionQueue";
import { createLocalResourceController } from "./localResourceController";

test("the resource controller exposes storage/process telemetry and backs off on gateway throttling", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-resources-"));
  await mkdir(join(stateDirectory, "source-files", "workspaces", "workspace_one"), { recursive: true });
  await mkdir(join(stateDirectory, "data", "workspaces"), { recursive: true });
  await writeFile(join(stateDirectory, "source-files", "workspaces", "workspace_one", "source.pdf"), new Uint8Array(128));
  await writeFile(join(stateDirectory, "data", "workspaces", "workspace_one.sqlite"), new Uint8Array(256));
  await writeFile(join(stateDirectory, "data", "workspaces", "workspace_one.sqlite-wal"), new Uint8Array(64));
  const permits: number[] = [];
  const controller = createLocalResourceController({
    diskReserveBytes: Number.MAX_SAFE_INTEGER,
    getQueueSnapshot: () => ({
      accepting: true,
      active: 8,
      deferred: 0,
      durableDeferrals: 0,
      maxBuffered: 10_000,
      maxConcurrent: 8,
      oldestEnqueuedAt: "2026-08-16T12:00:00.000Z",
      pending: 1,
      readyWorkspaces: 1,
    }),
    initialPermits: 8,
    maximumPermits: 16,
    setPermits: (value) => permits.push(value),
    stateDirectory,
  });

  try {
    controller.recordCompletedJob();
    controller.recordGatewayOutcome("throttled");
    await controller.sampleNow();
    const snapshot = controller.snapshot();
    expect(snapshot.completedJobs).toBe(1);
    expect(snapshot.gateway.throttled).toBe(1);
    expect(snapshot.disk).toMatchObject({ sourceBytes: 128, sqliteBytes: 256, walBytes: 64 });
    expect(snapshot.memory.rssBytes).toBeGreaterThan(0);
    expect(snapshot.permits).toMatchObject({ current: 5, lastChangeReason: "gateway_throttled" });
    expect(permits).toEqual([5]);
    expect(await controller.canReserveSubmission({ requestBytes: 1, reservedBytes: 0 })).toBe(false);
  } finally {
    controller.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("OS memory pressure applies immediate admission policy and recovers only after sampled hysteresis", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-memory-pressure-"));
  await mkdir(join(stateDirectory, "source-files"), { recursive: true });
  await mkdir(join(stateDirectory, "data", "workspaces"), { recursive: true });
  const permits: number[] = [];
  let clock = Date.parse("2026-08-20T12:00:00.000Z");
  let evictedIdleStores = 0;
  const controller = createLocalResourceController({
    diskReserveBytes: 0,
    evictIdleStores: () => {
      evictedIdleStores += 2;
      return 2;
    },
    getQueueSnapshot: () => ({
      accepting: true,
      active: 2,
      deferred: 1,
      durableDeferrals: 0,
      maxBuffered: 100,
      maxConcurrent: 8,
      oldestEnqueuedAt: "2026-08-20T11:59:00.000Z",
      pending: 3,
      readyWorkspaces: 2,
    }),
    initialPermits: 8,
    maximumPermits: 16,
    memoryPressureLargeSubmissionBytes: 100,
    now: () => clock,
    setPermits: (value) => permits.push(value),
    stateDirectory,
  });

  try {
    await controller.handleMemoryPressure("warning");
    expect(permits).toEqual([4]);
    expect(await controller.canReserveSubmission({ requestBytes: 99, reservedBytes: 0 })).toBe(true);
    expect(await controller.canReserveSubmission({ requestBytes: 100, reservedBytes: 0 })).toBe(false);
    expect(controller.snapshot().memoryPressure).toMatchObject({
      activeLevel: "warning",
      evictedIdleStores: 0,
      healthySamples: 1,
      lastLevel: "warning",
      permitAfter: 4,
      permitBefore: 8,
      policyReason: "os_memory_pressure_warning",
      recoveredAt: null,
      recoveryDurationMs: null,
      signaledAt: "2026-08-20T12:00:00.000Z",
    });

    clock += 5_000;
    await controller.sampleNow();
    expect(controller.snapshot().memoryPressure.activeLevel).toBe("warning");
    expect(permits).toEqual([4]);
    clock += 5_000;
    await controller.sampleNow();
    expect(controller.snapshot().memoryPressure).toMatchObject({
      activeLevel: null,
      healthySamples: 3,
      recoveredAt: "2026-08-20T12:00:10.000Z",
      recoveryDurationMs: 10_000,
    });
    expect(permits).toEqual([4, 8]);

    clock += 1_000;
    await controller.handleMemoryPressure("critical");
    expect(permits).toEqual([4, 8, 0]);
    expect(evictedIdleStores).toBe(2);
    expect(await controller.canReserveSubmission({ requestBytes: 1, reservedBytes: 0 })).toBe(false);
    expect(controller.snapshot().memoryPressure).toMatchObject({
      activeLevel: "critical",
      evictedIdleStores: 2,
      lastLevel: "critical",
      permitAfter: 0,
      permitBefore: 8,
      policyReason: "os_memory_pressure_critical",
    });
    expect(JSON.stringify(controller.snapshot().memoryPressure)).not.toContain("workspace_");
  } finally {
    controller.stop();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("critical pressure pauses new queue claims without losing active or durable pending work", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-pressure-queue-"));
  await mkdir(join(stateDirectory, "source-files"), { recursive: true });
  await mkdir(join(stateDirectory, "data", "workspaces"), { recursive: true });
  const queue = createLocalExtractionQueue({ maxConcurrent: 2 });
  const started: string[] = [];
  const releases: Array<() => void> = [];
  queue.subscribe(async (job) => {
    started.push(job.job_id);
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  const controller = createLocalResourceController({
    diskReserveBytes: 0,
    getQueueSnapshot: queue.snapshot,
    initialPermits: 2,
    maximumPermits: 2,
    setPermits: queue.setMaxConcurrent,
    stateDirectory,
  });

  try {
    await queue.schedule(queuedJob("job_active_one", "workspace_one"));
    await queue.schedule(queuedJob("job_active_two", "workspace_two"));
    await queue.schedule(queuedJob("job_durable_pending", "workspace_three"));
    expect(queue.snapshot()).toMatchObject({ active: 2, maxConcurrent: 2, pending: 1 });

    await controller.handleMemoryPressure("critical");
    expect(queue.snapshot()).toMatchObject({ active: 2, maxConcurrent: 0, pending: 1 });
    for (const release of releases.splice(0)) release();
    await waitFor(() => queue.snapshot().active === 0);
    expect(started).toEqual(["job_active_one", "job_active_two"]);
    expect(queue.snapshot()).toMatchObject({ active: 0, maxConcurrent: 0, pending: 1 });

    await controller.sampleNow();
    await controller.sampleNow();
    await waitFor(() => started.length === 3);
    expect(started).toEqual(["job_active_one", "job_active_two", "job_durable_pending"]);
    releases.shift()?.();
    await queue.waitForIdle();
    expect(queue.snapshot()).toMatchObject({ active: 0, pending: 0 });
  } finally {
    for (const release of releases.splice(0)) release();
    controller.stop();
    await queue.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function queuedJob(jobId: string, workspaceId: string) {
  return {
    job_id: jobId,
    workspace_id: workspaceId,
    template_id: "template_pressure",
    template_version: 1,
    enqueued_at: "2026-08-20T12:00:00.000Z",
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for memory-pressure queue state");
}
