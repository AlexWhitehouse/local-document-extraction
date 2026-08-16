import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

test("Source retention deletes completed and expired failed binaries but preserves durable jobs", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-source-retention-"));
  const workspaceId = "workspace_retention";
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceKeys = new Map<string, string>();

  try {
    for (const jobId of ["job_completed", "job_failed_old", "job_failed_recent", "job_queued"]) {
      const sourceFileKey = await sourceFiles.write({
        workspaceId,
        jobId,
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      });
      sourceKeys.set(jobId, sourceFileKey);
      store.createQueuedExtractionJob({
        jobId,
        templateId: "template_retention",
        templateVersion: 1,
        sourceFileKey,
        sourceMimeType: "application/pdf",
        sourceName: `${jobId}.pdf`,
        sourceFilePageCount: 1,
        submittedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    store.failQueuedExtractionJob({
      jobId: "job_failed_old",
      failedAt: "2026-01-01T00:01:00.000Z",
      errorCode: "test",
      errorMessage: "old",
    });
    store.failQueuedExtractionJob({
      jobId: "job_failed_recent",
      failedAt: "2026-01-10T00:01:00.000Z",
      errorCode: "test",
      errorMessage: "recent",
    });
    store.claimExtractionJobForProcessing({
      jobId: "job_completed",
      attempt: 1,
      claimedAt: "2026-01-01T00:01:00.000Z",
    });
    store.completeExtractionJob({
      jobId: "job_completed",
      attempt: 1,
      completedAt: "2026-01-01T00:02:00.000Z",
      modelName: "test-model",
      route: "test-route",
      results: [],
    });
  } finally {
    store.close();
  }

  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  const retention = createLocalSourceFileRetention({
    now: () => Date.parse("2026-01-12T00:00:00.000Z"),
    productStoreRegistry: registry,
    sourceFileStore: sourceFiles,
    stateDirectory,
  });
  try {
    await retention.run();
    await retention.run();
    expect(await sourceFiles.read(sourceKeys.get("job_completed")!)).toBeNull();
    expect(await sourceFiles.read(sourceKeys.get("job_failed_old")!)).toBeNull();
    expect(await sourceFiles.read(sourceKeys.get("job_failed_recent")!)).not.toBeNull();
    expect(await sourceFiles.read(sourceKeys.get("job_queued")!)).not.toBeNull();
    expect(retention.snapshot()).toMatchObject({ deleted: 2, failures: 0, runs: 2 });
  } finally {
    registry.closeAll();
  }

  const database = new Database(join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`));
  try {
    expect(database.query("SELECT COUNT(*) AS count FROM jobs").get()).toEqual({ count: 4 });
    expect(database.query("SELECT COUNT(*) AS count FROM source_files WHERE deleted_at IS NOT NULL").get()).toEqual({ count: 2 });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
