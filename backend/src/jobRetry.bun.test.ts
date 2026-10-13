import { Database, type SQLQueryBindings } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const at = (minute: number) => `2026-10-02T12:${String(minute).padStart(2, "0")}:00.000Z`;

async function harness() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-job-retry-"));
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "workspace" });

  cleanup.push(async () => {
    store.close();
    await rm(stateDirectory, { recursive: true, force: true });
  });
  store.createTemplate({
    templateId: "invoice",
    name: "Invoice",
    description: null,
    fields: [{ id: "total", name: "Total", description: "Amount due", data_type: "number" }],
    createdAt: at(0),
  });

  return { store, stateDirectory, path: join(stateDirectory, "data", "workspaces", "workspace.sqlite") };
}

function failedJob(store: LocalWorkspaceProductStore, jobId: string, retainedObjectKey?: string) {
  const job: Parameters<LocalWorkspaceProductStore["createQueuedExtractionJob"]>[0] = {
    jobId,
    templateId: "invoice",
    templateVersion: 1,
    sourceFileKey: `${jobId}/source.pdf`,
    sourceMimeType: "application/pdf",
    sourceName: `${jobId}.pdf`,
    sourceFilePageCount: 1,
    submittedAt: at(1),
  };

  if (retainedObjectKey) job.retainedObjectKey = retainedObjectKey;
  store.createQueuedExtractionJob(job);
  store.failQueuedExtractionJob({ jobId, failedAt: at(2), errorCode: "model_error", errorMessage: "Rejected" });
}

function cleanSource(store: LocalWorkspaceProductStore, jobId: string) {
  const claim = { jobId, sourceFileKey: `${jobId}/source.pdf`, cleanedAt: at(3) };

  expect(store.claimSourceFileCleanup(claim)).toBe(true);
  store.markSourceFileCleaned(claim);
}

/** A packet with one materialized, queued child per page. */
function extractingPacket(store: LocalWorkspaceProductStore, pages: number) {
  const selectedPages = Array.from({ length: pages }, (_, index) => index + 1);

  store.createDocumentPacket({
    packetId: "packet",
    templateId: "invoice",
    templateVersion: 1,
    templateTags: [],
    selectedPages,
    processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: false },
    sourceFileKey: "packet/source.pdf",
    sourceMimeType: "application/pdf",
    sourceName: "Packet.pdf",
    sourceFilePageCount: pages,
    submittedAt: at(0),
  });
  store.claimPacketRound({ packetId: "packet", updatedAt: at(1), configurationSnapshot: {} });

  const accepted = store.acceptDocumentPacketPlan({
    packetId: "packet",
    revision: 1,
    expectedRound: 1,
    groups: selectedPages.map((page) => [page]),
    exclusions: [],
    updatedAt: at(1),
  })!;

  const children = accepted.child_slots.map((slot) => slot.job_id);

  for (const jobId of children)
    store.materializePacketChild({ packetId: "packet", jobId, sourceFileKey: `${jobId}/source.pdf`, sourceFilePageCount: 1, updatedAt: at(2) });

  store.finishPacketMaterialization({ packetId: "packet", updatedAt: at(2) });

  return children;
}

function finish(store: LocalWorkspaceProductStore, jobId: string, attempt: number, outcome: "completed" | "failed", minute: number) {
  store.claimExtractionJobForProcessing({ jobId, attempt, claimedAt: at(minute) });

  if (outcome === "failed")
    return store.failExtractionJob({ jobId, attempt, failedAt: at(minute), errorCode: "model_error", errorMessage: "Rejected" });

  return store.completeExtractionJob({ jobId, attempt, completedAt: at(minute), modelName: "model", route: "test", results: [] });
}

function packetStatus(path: string) {
  const database = new Database(path, { readonly: true });

  try {
    return database
      .query<{ status: string; error_code: string | null }, SQLQueryBindings[]>(
        "SELECT status, error_code FROM document_packets WHERE id = 'packet'",
      )
      .get();
  } finally {
    database.close();
  }
}

test("a failed job whose local original was removed is skipped unless a retained copy exists", async () => {
  const { store } = await harness();

  failedJob(store, "job_local");
  failedJob(store, "job_remote", "retained/job_remote");
  cleanSource(store, "job_local");
  cleanSource(store, "job_remote");

  expect(store.retryFailedExtractionJobs({ jobIds: ["job_local", "job_remote"], retriedAt: at(4) })).toEqual({
    retried: [{ job_id: "job_remote", template_id: "invoice", template_version: 1, attempt: 1 }],
    skipped: [{ job_id: "job_local", reason: "source_unavailable" }],
    reopened_packet_ids: [],
  });
  expect(store.getExtractionJobSummary("job_local")?.status).toBe("failed");
});

test("the retention sweep and a retry never both win for the same original", async () => {
  const { store } = await harness();

  failedJob(store, "job_retried_first");
  failedJob(store, "job_swept_first");

  // A retry that commits first keeps the original: the sweep's claim is refused.
  store.retryFailedExtractionJobs({ jobIds: ["job_retried_first"], retriedAt: at(4) });
  expect(
    store.claimSourceFileCleanup({ jobId: "job_retried_first", sourceFileKey: "job_retried_first/source.pdf", cleanedAt: at(5) }),
  ).toBe(false);

  // A claim that commits first makes the retry skip the job; a failed deletion releases it.
  const claim = { jobId: "job_swept_first", sourceFileKey: "job_swept_first/source.pdf", cleanedAt: at(5) };

  expect(store.claimSourceFileCleanup(claim)).toBe(true);
  expect(store.retryFailedExtractionJobs({ jobIds: ["job_swept_first"], retriedAt: at(6) }).skipped).toEqual([
    { job_id: "job_swept_first", reason: "source_unavailable" },
  ]);
  store.releaseSourceFileCleanup(claim);
  expect(store.retryFailedExtractionJobs({ jobIds: ["job_swept_first"], retriedAt: at(7) }).retried).toHaveLength(1);
});

test("the sweep skips an original whose job was retried after the batch was listed", async () => {
  const { store, stateDirectory } = await harness();

  failedJob(store, "job_late_retry");
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  const deleted: string[] = [];
  const listed: string[] = [];

  const retention = createLocalSourceFileRetention({
    failedSourceRetentionMs: 0,
    now: () => Date.parse("2026-10-03T00:00:00.000Z"),
    productStoreRegistry: {
      ...registry,
      acquire: (input) => {
        const lease = registry.acquire(input);

        if (!lease) return lease;

        return {
          ...lease,
          store: {
            ...lease.store,
            listRetainedTerminalSourceFiles: (query) => {
              const due = lease.store.listRetainedTerminalSourceFiles(query);

              listed.push(...due.map((source) => source.job_id));
              // The user retries between the listing and the deletion.
              store.retryFailedExtractionJobs({ jobIds: ["job_late_retry"], retriedAt: at(8) });

              return due;
            },
          },
        };
      },
    },
    sourceFileStore: {
      delete: async (key) => {
        deleted.push(key);
      },
    },
    stateDirectory,
  });

  try {
    await retention.run();
  } finally {
    registry.closeAll();
  }

  expect(listed).toEqual(["job_late_retry"]);
  expect(deleted).toEqual([]);
  expect(store.getExtractionJobSummary("job_late_retry")?.status).toBe("queued");
});

test("retrying a child reopens a packet that failed because of its children, so completion settles it", async () => {
  const { store, path } = await harness();
  const [first, second] = extractingPacket(store, 2);

  finish(store, first!, 1, "completed", 3);
  finish(store, second!, 1, "failed", 4);
  expect(packetStatus(path)).toEqual({ status: "failed", error_code: null });

  expect(store.retryFailedExtractionJobs({ jobIds: [second!], retriedAt: at(5) })).toMatchObject({
    retried: [{ job_id: second }],
    reopened_packet_ids: ["packet"],
  });
  expect(packetStatus(path)).toEqual({ status: "processing_children", error_code: null });

  finish(store, second!, 1, "completed", 6);
  expect(packetStatus(path)).toEqual({ status: "completed", error_code: null });
});

test("a child of a packet that failed for its own reasons is skipped", async () => {
  const { store, path } = await harness();
  const [first, second] = extractingPacket(store, 2);

  finish(store, first!, 1, "failed", 3);
  // The packet fails as a whole before its other child finishes.
  store.failDocumentPacket({ packetId: "packet", reason: "Split failed", updatedAt: at(4) });
  finish(store, second!, 1, "completed", 5);
  expect(packetStatus(path)).toEqual({ status: "failed", error_code: "packet_processing_failed" });

  expect(store.retryFailedExtractionJobs({ jobIds: [first!], retriedAt: at(6) })).toEqual({
    retried: [],
    skipped: [{ job_id: first, reason: "packet_unavailable" }],
    reopened_packet_ids: [],
  });
  expect(store.getExtractionJobSummary(first!)?.status).toBe("failed");
});
