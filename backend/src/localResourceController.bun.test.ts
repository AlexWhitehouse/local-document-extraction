import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
