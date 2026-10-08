import { type SQLQueryBindings, Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { finishedPacketStatus } from "./documentPacketCompletion";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const at = (minute: number) => `2026-10-02T12:${String(minute).padStart(2, "0")}:00.000Z`;

async function harness() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-packet-completion-"));
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" });
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

  return {
    get store() {
      return store;
    },
    path: join(stateDirectory, "data/workspaces/test.sqlite"),
    reopen() {
      store.close();
      store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" });

      return store;
    },
  };
}

/** A packet with one materialized child per page; children are left queued. */
function extractingPacket(store: LocalWorkspaceProductStore, pages = 3, finish = true) {
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

  for (const jobId of children) {
    store.materializePacketChild({
      packetId: "packet",
      jobId,
      sourceFileKey: `${jobId}/source.pdf`,
      sourceFilePageCount: 1,
      updatedAt: at(2),
    });
  }

  if (finish) expect(store.finishPacketMaterialization({ packetId: "packet", updatedAt: at(2) })).toBe(true);

  return children;
}

function complete(store: LocalWorkspaceProductStore, jobId: string, minute: number) {
  store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: at(minute) });

  return store.completeExtractionJob({
    jobId,
    attempt: 1,
    completedAt: at(minute),
    modelName: "model",
    route: "test",
    results: [],
  });
}

function fail(store: LocalWorkspaceProductStore, jobId: string, minute: number) {
  store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: at(minute) });

  return store.failExtractionJob({
    jobId,
    attempt: 1,
    failedAt: at(minute),
    errorCode: "model_error",
    errorMessage: "Rejected",
  });
}

const packetRow = (path: string) => {
  const db = new Database(path);

  try {
    return db
      .query<{ status: string; updated_at: string }, SQLQueryBindings[]>(
        "SELECT status,updated_at FROM document_packets WHERE id='packet'",
      )
      .get();
  } finally {
    db.close();
  }
};

test("the shared completion rule ignores deleted children and fails only on a remaining failure", () => {
  expect(finishedPacketStatus([])).toBe("completed");
  expect(finishedPacketStatus([{ status: "completed", deleted: false }, { status: "queued", deleted: false }])).toBe(
    null,
  );
  expect(finishedPacketStatus([{ status: "completed", deleted: false }, { status: "queued", deleted: true }])).toBe(
    "completed",
  );
  expect(finishedPacketStatus([{ status: "failed", deleted: true }, { status: "completed", deleted: false }])).toBe(
    "completed",
  );
  expect(finishedPacketStatus([{ status: "failed", deleted: false }, { status: "completed", deleted: false }])).toBe(
    "failed",
  );
});

test("finishing the last child persists packet completion and its time in the same write", async () => {
  const h = await harness();
  const [one, two, three] = extractingPacket(h.store);
  complete(h.store, one!, 3);
  fail(h.store, two!, 4);
  expect(packetRow(h.path)).toEqual({ status: "processing_children", updated_at: at(2) });
  complete(h.store, three!, 5);
  expect(packetRow(h.path)).toEqual({ status: "failed", updated_at: at(5) });
  expect(h.reopen().getDocumentPacket("packet")).toMatchObject({ status: "failed", stage: "finished" });
});

test("deleting the last unfinished child completes the packet, and a deleted failure does not fail it", async () => {
  const h = await harness();
  const [one, two, three] = extractingPacket(h.store);
  fail(h.store, one!, 3);
  complete(h.store, two!, 4);
  h.store.deleteExtractionJob({ jobId: one! });
  expect(packetRow(h.path)?.status).toBe("processing_children");
  h.store.deleteExtractionJob({ jobId: three! });
  expect(packetRow(h.path)?.status).toBe("completed");
});

test("children that finish before materialization ends complete the packet when it ends", async () => {
  const h = await harness();
  const children = extractingPacket(h.store, 2, false);

  for (const [index, jobId] of children.entries()) complete(h.store, jobId, 3 + index);
  expect(packetRow(h.path)?.status).toBe("materializing");
  h.store.finishPacketMaterialization({ packetId: "packet", updatedAt: at(9) });
  expect(packetRow(h.path)).toEqual({ status: "completed", updated_at: at(9) });
});

test("exhausting a child's retries during recovery settles its packet", async () => {
  const h = await harness();
  const [one, two] = extractingPacket(h.store, 2);
  complete(h.store, one!, 3);
  h.store.claimExtractionJobForProcessing({ jobId: two!, attempt: 1, claimedAt: at(3) });
  h.store.recoverExtractionJobs({ maxAttempts: 1, recoveredAt: at(8), staleProcessingBefore: at(7) });
  expect(packetRow(h.path)).toEqual({ status: "failed", updated_at: at(8) });
});

test("packet reads are pure and a migration reconciles packets finished before completion was persisted", async () => {
  const h = await harness();
  const [one, two] = extractingPacket(h.store, 2);
  complete(h.store, one!, 3);
  complete(h.store, two!, 4);
  h.store.close();

  // Recreate a packet left extracting by the earlier read-derived completion.
  const db = new Database(h.path);
  db.exec("UPDATE document_packets SET status='processing_children', updated_at='2026-10-02T12:02:00.000Z'");
  db.exec("DELETE FROM product_schema_version WHERE version=16");
  db.close();

  const reopened = h.reopen();
  expect(reopened.getDocumentPacket("packet")?.status).toBe("completed");
  expect(packetRow(h.path)?.status).toBe("completed");

  // A read of a packet that is still extracting does not write.
  const reader = new Database(h.path);
  reader.exec("UPDATE document_packets SET status='processing_children'");
  const before = reader.query("SELECT * FROM document_packets").all();
  expect(reopened.getDocumentPackets(["packet"]).get("packet")?.status).toBe("processing_children");
  expect(reopened.listDocumentPackets()[0]?.status).toBe("processing_children");
  expect(reader.query("SELECT * FROM document_packets").all()).toEqual(before);
  reader.close();
});

test("batched hydration returns the same packets and summaries as single reads", async () => {
  const h = await harness();
  const children = extractingPacket(h.store, 3);
  complete(h.store, children[0]!, 3);
  fail(h.store, children[1]!, 4);

  const packets = h.store.getDocumentPackets(["packet", "missing"]);
  expect([...packets.keys()]).toEqual(["packet"]);
  expect(packets.get("packet")).toEqual(h.store.getDocumentPacket("packet")!);

  const summaries = h.store.getExtractionJobSummaries([...children, "missing"]);
  expect(summaries.size).toBe(3);

  for (const jobId of children) expect(summaries.get(jobId)).toEqual(h.store.getExtractionJobSummary(jobId)!);
});
