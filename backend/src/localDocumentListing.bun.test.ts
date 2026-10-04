import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error The frontend adapter is JavaScript.
import { createDocumentRequestAdapter } from "../../frontend/src/features/documents/documentRequestAdapter.js";
import { createLocalApplication } from "./localApplication";
import type { LocalAuth } from "./localAuth";

import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const at = (second: number) => `2026-10-02T12:00:${String(second).padStart(2, "0")}.000Z`;

async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-listing-"));
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  const lease = registry.acquire({ workspaceId: "workspace" })!;
  const store = lease.store;
  cleanups.push(async () => {
    lease.release();
    await registry.closeAll();
    await rm(stateDirectory, { recursive: true, force: true });
  });
  store.createTemplate({
    templateId: "invoice",
    name: "Invoice",
    description: null,
    fields: [{ id: "total", name: "Total", description: "Amount", data_type: "number" }],
    createdAt: at(0),
  });

  for (let index = 0; index < 50; index++) {
    const jobId = `job_${String(index).padStart(2, "0")}`;
    store.createQueuedExtractionJob({
      jobId,
      templateId: "invoice",
      templateVersion: 1,
      sourceFileKey: `${jobId}/source.pdf`,
      sourceMimeType: "application/pdf",
      sourceName: `${jobId}.pdf`,
      sourceFilePageCount: 1,
      submittedAt: at(index),
    });
    store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: at(55) });
    store.completeExtractionJob({
      jobId,
      attempt: 1,
      completedAt: at(56),
      modelName: "ordinary",
      route: "test",
      results: [],
    });
  }

  for (const [index, count] of [0, 1, 50, 2, 0].entries()) {
    const packetId = `packet_${index}`;
    const pages = Array.from({ length: count || 2 }, (_, n) => n + 1);
    store.createDocumentPacket({
      packetId,
      templateId: "invoice",
      templateVersion: 1,
      templateTags: [],
      selectedPages: pages,
      processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: false },
      sourceFileKey: `${packetId}/source.pdf`,
      sourceMimeType: "application/pdf",
      sourceName: `bundle_${index}.pdf`,
      sourceFilePageCount: pages.length,
      submittedAt: at(50 + index),
    });

    if (!count) continue;
    store.claimPacketRound({ packetId, updatedAt: at(55), configurationSnapshot: { internal: "private snapshot" } });

    const packet = store.acceptDocumentPacketPlan({
      packetId,
      revision: 1,
      expectedRound: 1,
      groups: pages.map((page) => [page]),
      exclusions: [],
      updatedAt: at(55),
    })!;

    for (const child of packet.child_slots) {
      const jobId = child.job_id;
      store.materializePacketChild({
        packetId,
        jobId,
        sourceFileKey: `${jobId}/source.pdf`,
        sourceFilePageCount: 1,
        updatedAt: at(55),
      });
      store.claimExtractionJobForProcessing({ jobId, attempt: 1, claimedAt: at(55) });
      store.completeExtractionJob({
        jobId,
        attempt: 1,
        completedAt: at(56),
        modelName: "split-model",
        route: "test",
        results: [],
      });
    }

    store.finishPacketMaterialization({ packetId, updatedAt: at(56) });
  }

  const auth: LocalAuth = { getSession: async () => null, handler: async () => new Response(null) };

  const workspaceControl = workspaceControlFixture({
    authorizeApiKey: () => workspaceFixture({ id: "workspace", name: "Workspace", role: "owner" }),
    hasPendingStarterTemplateBootstrap: () => false,
  });

  const application = createLocalApplication({
    auth,
    workspaceControl,
    stateDirectory,
    productStoreRegistry: registry,
  });

  const adapter = createDocumentRequestAdapter({
    request: async (path: string) => {
      const response = await application(
        new Request(`http://localhost/v1${path}`, { headers: { authorization: "Bearer test" } }),
      );

      const data = await response.json();

      if (!response.ok) throw Object.assign(new Error("Request failed"), { status: response.status, ...data.error });

      return data;
    },
  });

  return { adapter, store };
}

test("50 visible entries include whole packets, with document totals independent of pagination", async () => {
  const { adapter } = await fixture();
  const first = await adapter.listDocumentEntries();
  expect(first.jobs).toHaveLength(45);
  expect(first.packets).toHaveLength(5);
  expect(first.packets.find((packet: { packet_id: string }) => packet.packet_id === "packet_2").children).toHaveLength(
    50,
  );
  expect(first.total).toBe(103);
  expect(first.status_counts.completed).toBe(103);
  expect(first.has_more).toBe(true);
  expect(JSON.stringify(first)).not.toContain("private snapshot");

  for (const packet of first.packets) {
    expect(packet).not.toHaveProperty("child_slots");
    expect(packet).not.toHaveProperty("source_file_key");
  }

  const second = await adapter.listDocumentEntries({ cursor: first.next_cursor });
  expect(second.jobs.map((job: { job_id: string }) => job.job_id)).toEqual([
    "job_04",
    "job_03",
    "job_02",
    "job_01",
    "job_00",
  ]);
  expect(second.packets).toEqual([]);
  expect(second.has_more).toBe(false);
  expect(second.total).toBe(103);
  // The existing job API continues to paginate individual Documents.
  const jobs = await adapter.listDocuments();
  expect(jobs.jobs).toHaveLength(50);
  expect(jobs.jobs.every((job: { parent_packet_id: string }) => job.parent_packet_id)).toBe(true);
  await expect(adapter.listDocuments({ cursor: first.next_cursor })).rejects.toMatchObject({
    status: 400,
    code: "invalid_cursor",
  });
  await expect(adapter.listDocumentEntries({ cursor: jobs.next_cursor })).rejects.toMatchObject({
    status: 400,
    code: "invalid_cursor",
  });
});

test("packet and child queries match a single entry before pagination, including literal search characters", async () => {
  const { adapter, store } = await fixture();
  const child = store.getDocumentPacket("packet_2")!.children[0]!;
  const byChild = await adapter.listDocumentEntries({ search: child.job_id });
  expect(byChild.jobs).toEqual([]);
  expect(byChild.packets.map((packet: { packet_id: string }) => packet.packet_id)).toEqual(["packet_2"]);
  const byModel = await adapter.listDocumentEntries({ filters: { model: "split-model" } });
  expect(byModel.jobs).toEqual([]);
  expect(byModel.packets).toHaveLength(3);
  expect(byModel.has_more).toBe(false);
  const byName = await adapter.listDocumentEntries({ search: "bundle_4" });
  expect(byName.packets.map((packet: { packet_id: string }) => packet.packet_id)).toEqual(["packet_4"]);
  const unmatched = await adapter.listDocumentEntries({ search: "%" });
  expect(unmatched.jobs).toEqual([]);
  expect(unmatched.packets).toEqual([]);
  const byDate = await adapter.listDocumentEntries({ filters: { dateTo: "2026-10-01" } });
  expect(byDate.jobs).toEqual([]);
  expect(byDate.packets).toEqual([]);
  expect(byDate.total).toBe(103);
});

test("combined cursors traverse equal timestamps and survive deletion of the boundary entry", async () => {
  const { store } = await fixture();
  store.createDocumentPacket({
    packetId: "same_date",
    templateId: "invoice",
    templateVersion: 1,
    templateTags: [],
    selectedPages: [1],
    processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: false },
    sourceFileKey: "same_date/source.pdf",
    sourceMimeType: "application/pdf",
    sourceName: "same date.pdf",
    sourceFilePageCount: 1,
    submittedAt: at(49),
  });
  const seen: string[] = [];
  let cursor;

  for (;;) {
    const page = store.listDocumentEntries({ cursor, limit: 2 });

    if (!page.length) break;
    seen.push(...page.map((entry) => entry.entry_id));
    const last = page.at(-1)!;
    cursor = { createdAt: last.created_at, jobId: last.entry_id };

    if (last.kind === "document") store.deleteExtractionJob({ jobId: last.id });
  }

  expect(seen).toHaveLength(56);
  expect(new Set(seen).size).toBe(56);
  expect(seen.slice(5, 7)).toEqual(["packet:same_date", "document:job_49"]);
});
