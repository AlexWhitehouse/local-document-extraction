import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { readModelCallUsage } from "./consumer/modelUsage";
import { parseCostRange } from "../../shared/workspaceCosts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const uploaded = "2026-09-01T10:30:00.000Z", later = "2026-10-04T12:00:00.000Z";
const range = parseCostRange("2026-09-01", "2026-09-03", "day");
function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), "workspace-costs-"));
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" });
  store.closeCostUpdates();
  cleanup.push(() => { store.close(); rmSync(stateDirectory, { recursive: true, force: true }); });
  store.createTemplate({ templateId: "tpl", name: "Invoice", description: null, fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" }], createdAt: uploaded });
  return { get store() { return store; }, path: join(stateDirectory, "data/workspaces/test.sqlite"),
    reopen() { store.close(); store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" }); store.closeCostUpdates(); } };
}
function job(store: LocalWorkspaceProductStore, id = "job", at = uploaded, pages = 2) {
  store.createQueuedExtractionJob({ jobId: id, templateId: "tpl", templateVersion: 1, sourceFileKey: `${id}/source.pdf`, sourceMimeType: "application/pdf", sourceName: `${id}.pdf`, sourceFilePageCount: pages, submittedAt: at });
}
function finish(store: LocalWorkspaceProductStore, id: string) {
  store.claimExtractionJobForProcessing({ jobId: id, attempt: 1, claimedAt: later });
  store.completeExtractionJob({ jobId: id, attempt: 1, completedAt: later, modelName: "model", route: "text", results: [] });
}
function charge(store: LocalWorkspaceProductStore, id: string, amount: number | null, stage: "split" | "auto_template" | "extraction" = "extraction") {
  const call = store.modelCallObserver({ ownerId: id, stage, model: "model", configurationRevision: 1, now: () => later });
  const receipt = call.started(); call.finished(receipt, readModelCallUsage({ usage: { cost: amount } }));
  return { call, receipt };
}
function drain(store: LocalWorkspaceProductStore) {
  for (let attempts = 0; attempts < 1000; attempts++) if (!store.processCostUpdates(50, 1000)) return;
  throw new Error("Cost backfill did not finish");
}

test("upload-date totals include all calls once; averages and samples use finished fully costed documents", () => {
  const f = fixture();
  job(f.store, "priced"); charge(f.store, "priced", 0.3); finish(f.store, "priced");
  job(f.store, "partial"); charge(f.store, "partial", 0.2); charge(f.store, "partial", null); finish(f.store, "partial");
  job(f.store, "unknown"); charge(f.store, "unknown", null); finish(f.store, "unknown");
  job(f.store, "queued");
  job(f.store, "zero"); charge(f.store, "zero", 0); finish(f.store, "zero");
  drain(f.store);
  const overview = f.store.getCostOverview(range);
  expect(overview.totals).toMatchObject({ documents: 5, pages: 10, fullyCostedDocuments: 2, fullyCostedPages: 4, fullyCostedAmount: 0.3 });
  expect(overview.totals.costs.total).toMatchObject({ amount: 0.5, complete: false, reported_calls: 3, unreported_calls: 2 });
  expect(overview.samples.map(item => item.id).sort()).toEqual(["priced", "zero"]);
  expect(overview.buckets[0]!.costs.total.amount).toBe(0.5);
  expect(f.store.getCostOverview(parseCostRange("2026-10-04", "2026-10-05", "day")).totals.costs.total.amount).toBe(0);
  const receipt = charge(f.store, "priced", 0.1);
  receipt.call.finished(receipt.receipt, readModelCallUsage({ usage: { cost: 1000 } }));
  drain(f.store); f.reopen(); drain(f.store);
  expect(f.store.getCostOverview(range).totals.costs.total.amount).toBeCloseTo(0.6, 12);
});

test("deleting before backfill preserves metadata and late receipts without resurrecting product records", () => {
  const f = fixture(); job(f.store); charge(f.store, "job", 0.3); finish(f.store, "job");
  const pending = f.store.modelCallObserver({ ownerId: "job", stage: "extraction", model: "new-model", configurationRevision: 2, now: () => later });
  const id = pending.started();
  f.store.deleteExtractionJob({ jobId: "job" });
  pending.finished(id, readModelCallUsage({ usage: { cost: 0.2 } }));
  drain(f.store); f.reopen(); drain(f.store);
  expect(f.store.getExtractionJob("job")).toBeNull();
  expect(f.store.getCostUpload("job")).toMatchObject({ name: "job.pdf", deleted: true, pages: 2, children: [{ template: "Invoice", deleted: true, costs: { total: { amount: 0.5 } } }] });
  expect(f.store.getCostOverview(range).totals).toMatchObject({ documents: 1, fullyCostedDocuments: 1, fullyCostedAmount: 0.5 });
});

function packet(store: LocalWorkspaceProductStore) {
  store.createDocumentPacket({ packetId: "packet", templateId: "tpl", templateVersion: 1, templateTags: [], selectedPages: [2, 3, 5, 8], processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: true }, sourceFileKey: "packet/source.pdf", sourceMimeType: "application/pdf", sourceName: "packet.pdf", sourceFilePageCount: 10, submittedAt: uploaded });
  store.claimPacketRound({ packetId: "packet", updatedAt: later, configurationSnapshot: {} });
}
test("packet totals reconcile after child and parent deletion, retain original pages, and exclude overhead from averages", () => {
  const f = fixture(); packet(f.store); charge(f.store, "packet", 0.4, "split");
  const planned = f.store.acceptDocumentPacketPlan({ packetId: "packet", revision: 1, expectedRound: 1, groups: [[2, 3], [5]], exclusions: [{ page: 8, reason: "Blank", verified_blank: true }], updatedAt: later })!;
  for (const slot of planned.child_slots) {
    f.store.materializePacketChild({ packetId: "packet", jobId: slot.job_id, sourceFileKey: `${slot.job_id}/source.pdf`, sourceFilePageCount: slot.pages.length, updatedAt: later });
    charge(f.store, slot.job_id, 0.2); finish(f.store, slot.job_id);
  }
  drain(f.store);
  const before = f.store.getCostOverview(range);
  expect(before.totals.costs.total.amount).toBeCloseTo(0.8, 12);
  expect(before.totals.fullyCostedAmount).toBeCloseTo(0.7, 12);
  expect(before.totals).toMatchObject({ documents: 2, pages: 3, fullyCostedPages: 3 });
  const details = f.store.getCostUpload("packet")!;
  expect(details.costs.excluded_pages_cost?.amount).toBeCloseTo(0.1, 12);
  expect(details.children.flatMap(child => child.pageNumbers).sort()).toEqual([2, 3, 5]);
  expect(details.children.every(child => child.created_at === uploaded)).toBe(true);
  f.store.deleteExtractionJob({ jobId: planned.child_slots[0]!.job_id }); drain(f.store);
  expect(f.store.getCostOverview(range).totals.costs.total.amount).toBeCloseTo(0.8, 12);
  f.store.deleteDocumentPacket({ packetId: "packet" }); drain(f.store); f.reopen(); drain(f.store);
  const deleted = f.store.getCostUpload("packet")!;
  expect(deleted.deleted).toBe(true);
  expect(deleted.children.every(child => child.deleted)).toBe(true);
  expect(deleted.documentCount).toBe(2);
  expect(deleted.children.reduce((sum, child) => sum + child.costs.total.amount!, deleted.costs.excluded_pages_cost!.amount!)).toBeCloseTo(deleted.costs.total.amount!, 12);
});

test("all-blank packets contribute spend but never documents or a zero unit cost", () => {
  const f = fixture(); packet(f.store); charge(f.store, "packet", 0.4, "split");
  const exclusions = [2, 3, 5, 8].map(page => ({ page, reason: "Blank", verified_blank: true }));
  f.store.recordPacketAssessment({ packetId: "packet", round: 1, reason: "Blank", evidence: [], groups: [], exclusions, updatedAt: later });
  f.store.acceptDocumentPacketPlan({ packetId: "packet", revision: 1, expectedRound: 1, groups: [], exclusions, updatedAt: later });
  drain(f.store);
  expect(f.store.getCostOverview(range).totals).toMatchObject({ documents: 0, fullyCostedDocuments: 0, costs: { total: { amount: 0.4 } } });
  expect(f.store.getCostUpload("packet")).toMatchObject({ children: [], excludedPageNumbers: [2, 3, 5, 8] });
});

test("bulk packet deletion retains history with linear accounting writes", () => {
  const f = fixture();
  const pages = Array.from({ length: 80 }, (_, index) => index + 1);
  f.store.createDocumentPacket({ packetId: "packet", templateId: "tpl", templateVersion: 1, templateTags: [], selectedPages: pages,
    processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: false }, sourceFileKey: "packet/source.pdf", sourceMimeType: "application/pdf", sourceName: "packet.pdf", sourceFilePageCount: pages.length, submittedAt: uploaded });
  f.store.claimPacketRound({ packetId: "packet", updatedAt: later, configurationSnapshot: {} });
  charge(f.store, "packet", 0.8, "split");
  const planned = f.store.acceptDocumentPacketPlan({ packetId: "packet", revision: 1, expectedRound: 1, groups: pages.map(page => [page]), exclusions: [], updatedAt: later })!;
  for (const slot of planned.child_slots) f.store.materializePacketChild({ packetId: "packet", jobId: slot.job_id, sourceFileKey: `${slot.job_id}/source.pdf`, sourceFilePageCount: 1, updatedAt: later });
  drain(f.store);
  const db = new Database(f.path);
  db.exec("CREATE TABLE observed_cost_writes(n INTEGER); INSERT INTO observed_cost_writes VALUES(0); CREATE TRIGGER observe_cost_write AFTER UPDATE ON cost_documents BEGIN UPDATE observed_cost_writes SET n=n+1; END");
  f.store.deleteDocumentPacket({ packetId: "packet" }); drain(f.store);
  expect((db.query("SELECT n FROM observed_cost_writes").get() as { n: number }).n).toBeLessThanOrEqual(pages.length * 4);
  db.close();
  expect(f.store.getCostUpload("packet")?.children).toHaveLength(pages.length);
  expect(f.store.getCostUpload("packet")?.children.every(child => child.deleted)).toBe(true);
  expect(f.store.getCostOverview(range).totals.costs.total.amount).toBeCloseTo(0.8, 12);
});

test("bounded pagination searches sparse matches without truncation and sorts the full range", () => {
  const f = fixture();
  for (let i = 0; i < 241; i++) {
    const id = `job_${String(i).padStart(4, "0")}`;
    job(f.store, id, `2026-09-${i % 2 ? "01" : "02"}T10:00:00.000Z`, 1 + i % 3);
    charge(f.store, id, i % 7); finish(f.store, id);
  }
  drain(f.store);
  for (const sort of ["recent", "total", "perPage"] as const) {
    const ids: string[] = []; const amounts: number[] = []; let cursor: string | null = null;
    do {
      const page = f.store.listCostUploads({ ...range, sort, kind: "all", search: "", cursor });
      expect(page.items.length).toBeLessThanOrEqual(50);
      ids.push(...page.items.map(item => item.id));
      amounts.push(...page.items.map(item => sort === "perPage" ? item.costs.total.amount! / item.pages : item.costs.total.amount!));
      cursor = page.cursor;
    } while (cursor);
    expect(ids.length).toBe(241); expect(new Set(ids).size).toBe(241);
    if (sort !== "recent") expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  }
  let cursor: string | null = null, requests = 0;
  const found: string[] = [];
  do {
    const page = f.store.listCostUploads({ ...range, sort: "recent", kind: "all", search: "job_0001.pdf", cursor });
    found.push(...page.items.map(item => item.id)); cursor = page.cursor; requests += 1;
  } while (cursor);
  expect(found).toEqual(["job_0001"]); expect(requests).toBe(1);
  // Short literal terms use bounded scans and still reach older matches.
  let shortCursor: string | null = null; const shortFound: string[] = [];
  do {
    const page = f.store.listCostUploads({ ...range, sort: "recent", kind: "all", search: "01", cursor: shortCursor });
    shortFound.push(...page.items.map(item => item.id)); shortCursor = page.cursor;
  } while (shortCursor);
  expect(new Set(shortFound).size).toBe(shortFound.length);
  expect(shortFound).toContain("job_0001");
  const page = f.store.listCostUploads({ ...range, sort: "total", kind: "all", search: "" });
  expect(() => f.store.listCostUploads({ ...range, sort: "recent", kind: "all", search: "", cursor: page.cursor })).toThrow("Invalid cost cursor");
});

test("sampling is bounded, stable, complete-only and weighted by the exact bucket populations", () => {
  const f = fixture();
  // Seeding through the production APIs performs thousands of durable writes;
  // slower CI disks need more than the default five seconds for this fixture.
  for (let i = 0; i < 600; i++) { job(f.store, `job_${i}`); charge(f.store, `job_${i}`, i / 10000); finish(f.store, `job_${i}`); }
  drain(f.store);
  const summary = f.store.getCostOverview(range);
  expect(summary.sampled).toBe(true);
  expect(summary.samples.length).toBe(512);
  expect(summary.samples.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(600, 8);
  expect(f.store.getCostOverview(range).samples.map(item => item.id)).toEqual(summary.samples.map(item => item.id));
}, 15000);

test("summary transactions roll back together and resume after a failed update", () => {
  const f = fixture(); job(f.store); charge(f.store, "job", 0.3); drain(f.store);
  const db = new Database(f.path);
  db.exec("CREATE TRIGGER reject_cost_update BEFORE UPDATE ON cost_uploads BEGIN SELECT RAISE(ABORT,'retry later'); END");
  charge(f.store, "job", 0.2);
  expect(() => f.store.processCostUpdates(50, 1000)).toThrow("retry later");
  expect(f.store.getCostOverview(range).totals.costs.total.amount).toBe(0.3);
  db.exec("DROP TRIGGER reject_cost_update"); db.close();
  f.reopen(); drain(f.store);
  expect(f.store.getCostOverview(range).totals.costs.total.amount).toBe(0.5);
});

test("range validation enforces complete UTC buckets and twelve-month bounded queries", () => {
  expect(parseCostRange("2025-01-01", "2026-01-01", "day").unit).toBe("day");
  for (const [from, to, unit] of [["2025-01-01", "2027-01-01", "day"], ["2026-01-01T01:02Z", "2026-01-02T01:02Z", "hour"], ["bad", "bad", "day"], ["2026-01-01", "2026-01-01", "day"]]) expect(() => parseCostRange(from!, to!, unit!)).toThrow();
});

test("historical backfill is incremental and restartable and does not double count current writes", () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) { job(f.store, `old_${i}`); charge(f.store, `old_${i}`, 0.1); finish(f.store, `old_${i}`); }
  drain(f.store); f.store.close();
  const db = new Database(f.path);
  const triggers = db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'cost_%'").all() as { name: string }[];
  for (const { name } of triggers) db.exec(`DROP TRIGGER ${name}`);
  for (const table of ["cost_upload_search", "cost_uploads", "cost_documents", "cost_buckets", "cost_dirty", "cost_backfill"]) db.exec(`DROP TABLE ${table}`);
  db.exec("DELETE FROM product_schema_version WHERE version=13"); db.close();
  f.reopen();
  expect(f.store.getCostOverview(range)).toMatchObject({ historyBuilding: true, totals: { documents: 0 } });
  f.store.processCostUpdates(1, 1000); f.store.processCostUpdates(1, 1000);
  expect(f.store.getCostOverview(range).totals.documents).toBe(1);
  job(f.store, "new"); charge(f.store, "new", 0.5); finish(f.store, "new");
  f.reopen(); drain(f.store);
  expect(f.store.getCostOverview(range)).toMatchObject({ historyBuilding: false, totals: { documents: 13, fullyCostedDocuments: 13 } });
  expect(f.store.getCostOverview(range).totals.costs.total.amount).toBeCloseTo(1.7, 12);
});
