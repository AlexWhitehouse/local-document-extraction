import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalExtractionRunner } from "./localExtractionRunner";
import {
  createLocalWorkspaceProductStore,
  openLocalWorkspaceProductStore,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const minute = (value: number) => new Date(Date.parse("2026-07-09T12:00:00.000Z") + value * 60_000).toISOString();

async function stateDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "document-extraction-reconciliation-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));

  return directory;
}

function withStore<T>(directory: string, workspaceId: string, use: (store: LocalWorkspaceProductStore) => T): T {
  const store = createLocalWorkspaceProductStore({ stateDirectory: directory, workspaceId });

  try {
    return use(store);
  } finally {
    store.close();
  }
}

function queue(store: LocalWorkspaceProductStore, jobId: string, at: string) {
  if (!store.getSubmissionTemplate("tpl_invoice")) {
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: null,
      fields: [{ id: "total", name: "Total", description: "Amount", data_type: "number" }],
      createdAt: at,
    });
  }

  store.createQueuedExtractionJob({
    jobId,
    templateId: "tpl_invoice",
    templateVersion: 1,
    sourceFileKey: `${jobId}/source.png`,
    sourceMimeType: "image/png",
    sourceName: "invoice.png",
    sourceFilePageCount: null,
    submittedAt: at,
  });
}

test("the first recovery after start re-queues interrupted processing work at once; later passes wait for staleness", async () => {
  const directory = await stateDirectory();
  let clock = minute(10);

  withStore(directory, "workspace_a", (store) => {
    for (const jobId of ["job_one", "job_two"]) {
      queue(store, jobId, minute(0));
      // Claimed a minute before the crash: far newer than the five-minute stale threshold.
      store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: minute(9) });
    }
  });

  const scheduled: Array<{ job_id: string; attempt?: number }> = [];

  const runner = createLocalExtractionRunner({
    execute: async () => {},
    now: () => clock,
    scheduleJob: (job) => {
      scheduled.push({ job_id: job.job_id, attempt: job.attempt });
    },
    stateDirectory: directory,
  });

  await runner.recover();
  expect(scheduled.sort((left, right) => left.job_id.localeCompare(right.job_id))).toEqual([
    { job_id: "job_one", attempt: 2 },
    { job_id: "job_two", attempt: 2 },
  ]);

  withStore(directory, "workspace_a", (store) => {
    expect(store.getExtractionJobSummary("job_one")).toMatchObject({ status: "queued", error_code: "stale_processing" });
    store.claimExtractionJobForProcessing({ jobId: "job_one", attempt: 2, claimedAt: minute(10) });
  });

  scheduled.splice(0);
  clock = minute(12);
  await runner.recover();
  // job_two is still queued; job_one is processing again and not yet stale.
  expect(scheduled).toEqual([{ job_id: "job_two", attempt: 2 }]);
  withStore(directory, "workspace_a", (store) => {
    expect(store.getExtractionJobSummary("job_one")?.status).toBe("processing");
  });

  scheduled.splice(0);
  clock = minute(16);
  await runner.recover();
  expect(scheduled).toEqual(expect.arrayContaining([{ job_id: "job_one", attempt: 3 }]));
});

test("periodic reconciliation opens only Workspaces with pending work, with an infrequent full sweep", async () => {
  const directory = await stateDirectory();
  let clock = minute(0);
  const opened: string[] = [];
  const scheduled: string[] = [];
  const pendingWorkspaceIds = new Set<string>();

  withStore(directory, "workspace_busy", (store) => queue(store, "job_busy", minute(0)));
  withStore(directory, "workspace_idle", (store) => {
    queue(store, "job_done", minute(0));
    store.claimExtractionJobForProcessing({ jobId: "job_done", attempt: 1, claimedAt: minute(0) });
    store.completeExtractionJob({
      jobId: "job_done",
      attempt: 1,
      completedAt: minute(0),
      modelName: "model",
      route: "test",
      results: [],
    });
  });

  const runner = createLocalExtractionRunner({
    execute: async () => {},
    fullReconcileIntervalMs: 10 * 60_000,
    now: () => clock,
    pendingWorkspaceIds,
    productStoreOpener: (input) => {
      opened.push(input.workspaceId);

      return openLocalWorkspaceProductStore(input);
    },
    scheduleJob: (job) => {
      scheduled.push(job.job_id);
    },
    stateDirectory: directory,
  });

  await runner.recover();
  expect(opened.sort()).toEqual(["workspace_busy", "workspace_idle"]);
  expect([...pendingWorkspaceIds]).toEqual(["workspace_busy"]);

  // Work written only to SQLite, outside any admission path, waits for the safety net.
  withStore(directory, "workspace_idle", (store) => queue(store, "job_late", minute(1)));
  opened.splice(0);
  clock = minute(1);
  await runner.recover();
  expect(opened).toEqual(["workspace_busy"]);
  expect(scheduled).not.toContain("job_late");

  opened.splice(0);
  clock = minute(11);
  await runner.recover();
  expect(opened.sort()).toEqual(["workspace_busy", "workspace_idle"]);
  expect(scheduled).toContain("job_late");
  expect([...pendingWorkspaceIds].sort()).toEqual(["workspace_busy", "workspace_idle"]);

  // Admission records its Workspace; recovery drops a Workspace once it has no pending work.
  withStore(directory, "workspace_idle", (store) => store.deleteExtractionJob({ jobId: "job_late" }));
  opened.splice(0);
  clock = minute(12);
  await runner.recover();
  expect(opened.sort()).toEqual(["workspace_busy", "workspace_idle"]);
  expect([...pendingWorkspaceIds]).toEqual(["workspace_busy"]);
  opened.splice(0);
  await runner.recover("workspace_idle");
  expect(opened).toEqual(["workspace_idle"]);
});
