import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { readModelCallUsage } from "./consumer/modelUsage";
import type { ProcessingCostStage } from "../../shared/processingCosts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const at = "2026-10-04T12:00:00.000Z";
async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "model-costs-"));
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" });
  cleanups.push(async () => { store.close(); await rm(stateDirectory, { recursive: true, force: true }); });
  store.createTemplate({ templateId: "invoice", name: "Invoice", description: null, fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" }], createdAt: at });
  return { get store() { return store; }, path: join(stateDirectory, "data/workspaces/test.sqlite"), reopen() { store.close(); store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" }); } };
}
function addJob(store: LocalWorkspaceProductStore, jobId = "job") {
  store.createQueuedExtractionJob({ jobId, templateId: "invoice", templateVersion: 1, sourceFileKey: `${jobId}/source.pdf`, sourceMimeType: "application/pdf", sourceName: "invoice.pdf", sourceFilePageCount: 3, submittedAt: at });
}
function observer(store: LocalWorkspaceProductStore, ownerId: string, stage: ProcessingCostStage) {
  return store.modelCallObserver({ ownerId, stage, model: "any/model", configurationRevision: 1, now: () => at });
}
function charge(store: LocalWorkspaceProductStore, ownerId: string, stage: ProcessingCostStage, amount: number | null) {
  const call = observer(store, ownerId, stage), id = call.started();
  call.finished(id, readModelCallUsage({ usage: { cost: amount } }));
  return { call, id };
}
function addPacket(store: LocalWorkspaceProductStore, pages = [2, 3, 4, 7, 8]) {
  store.createDocumentPacket({ packetId: "packet", templateId: "invoice", templateVersion: 1, selectedPages: pages, templateTags: [], processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: true }, sourceFileKey: "packet/source.pdf", sourceMimeType: "application/pdf", sourceName: "packet.pdf", sourceFilePageCount: 10, submittedAt: at });
  store.claimPacketRound({ packetId: "packet", updatedAt: at, configurationSnapshot: {} });
}

test("accounts for retries once, preserves zero, and survives interrupted calls and restart", async () => {
  const f = await fixture(); addJob(f.store);
  const receipt = charge(f.store, "job", "extraction", 0.0022842);
  receipt.call.finished(receipt.id, readModelCallUsage({ usage: { cost: 42 } }));
  charge(f.store, "job", "extraction", 0);
  observer(f.store, "job", "extraction").started(); // process dies before the response
  f.reopen();
  charge(f.store, "job", "extraction", 0.001);
  expect(f.store.getExtractionJob("job")?.costs?.total).toMatchObject({ complete: false, reported_calls: 3, unreported_calls: 1 });
  expect(f.store.getDocumentCosts("job").total.amount).toBeCloseTo(0.0032842, 12);
  expect(f.store.getDocumentCosts("job").auto_template).toMatchObject({ amount: 0, complete: true });
});

test("allocates split by selected pages, retains excluded overhead, and rolls up child stages without duplication", async () => {
  const f = await fixture(); addPacket(f.store);
  charge(f.store, "packet", "split", 0.01);
  charge(f.store, "packet", "split", 0.01); // reassessment
  const packet = f.store.acceptDocumentPacketPlan({ packetId: "packet", revision: 1, expectedRound: 1, groups: [[2, 3, 4], [7]], exclusions: [{ page: 8, reason: "Blank", verified_blank: true }], updatedAt: at })!;
  const [first, second] = packet.child_slots;
  for (const child of packet.child_slots) f.store.materializePacketChild({ packetId: "packet", jobId: child.job_id, sourceFileKey: `${child.job_id}/source.pdf`, sourceFilePageCount: child.pages.length, updatedAt: at });
  charge(f.store, first!.job_id, "auto_template", 0.002);
  charge(f.store, first!.job_id, "extraction", 0.003);
  charge(f.store, second!.job_id, "extraction", 0.004);
  const firstCosts = f.store.getDocumentCosts(first!.job_id), secondCosts = f.store.getDocumentCosts(second!.job_id);
  const costs = f.store.getDocumentPacket("packet")!.costs!;
  expect(firstCosts.split.amount).toBeCloseTo(0.012, 12);
  expect(firstCosts.split_allocation).toEqual({ document_pages: 3, packet_pages: 5 });
  expect(secondCosts.split.amount).toBeCloseTo(0.004, 12);
  expect(costs.excluded_pages_cost?.amount).toBeCloseTo(0.004, 12);
  expect(costs.total.amount).toBeCloseTo(0.029, 12);
  expect(costs.total.amount).toBeCloseTo(firstCosts.total.amount! + secondCosts.total.amount! + costs.excluded_pages_cost!.amount!, 12);
  f.store.deleteExtractionJob({ jobId: first!.job_id });
  expect(f.store.getPacketCosts("packet").total.amount).toBeCloseTo(0.029, 12);
  expect(f.store.getDocumentCosts(second!.job_id).split.amount).toBeCloseTo(0.004, 12);
  f.store.deleteDocumentPacket({ packetId: "packet" });
  expect(f.store.getPacketCosts("packet").total.amount).toBeCloseTo(0.029, 12);
});

test("all-blank packets keep the entire split cost and unknown stages make totals partial", async () => {
  const f = await fixture(); addPacket(f.store, [2, 4]);
  charge(f.store, "packet", "split", 0.007);
  const exclusions = [2, 4].map(page => ({ page, reason: "Verified blank", verified_blank: true }));
  f.store.recordPacketAssessment({ packetId: "packet", round: 1, reason: "Blank", evidence: [], groups: [], exclusions, updatedAt: at });
  f.store.acceptDocumentPacketPlan({ packetId: "packet", revision: 1, expectedRound: 1, groups: [], exclusions, updatedAt: at });
  expect(f.store.getPacketCosts("packet").excluded_pages_cost?.amount).toBe(0.007);
  addJob(f.store);
  charge(f.store, "job", "auto_template", null);
  expect(f.store.getDocumentCosts("job").total).toMatchObject({ amount: null, complete: false });
  charge(f.store, "job", "extraction", 0.003);
  expect(f.store.getDocumentCosts("job").total).toMatchObject({ amount: 0.003, complete: false });
  f.store.deleteExtractionJob({ jobId: "job" });
  expect(() => observer(f.store, "job", "extraction").started()).toThrow();
  expect(f.store.getDocumentCosts("job").total.amount).toBe(0.003);
});

test("migration marks historical calls unknown without backfilling invented zero costs", async () => {
  const f = await fixture(); addJob(f.store);
  f.store.claimExtractionJobForProcessing({ jobId: "job", attempt: 1, claimedAt: at });
  addPacket(f.store);
  f.store.close();
  const db = new Database(f.path);
  db.exec("DROP TABLE model_call_costs; DELETE FROM product_schema_version WHERE version=12");
  db.close();
  f.reopen();
  expect(f.store.getDocumentCosts("job").extraction).toMatchObject({ amount: null, complete: false });
  expect(f.store.getPacketCosts("packet").split).toMatchObject({ amount: null, complete: false });
  f.reopen();
  expect(f.store.getDocumentCosts("job").extraction.unreported_calls).toBe(1);
});
