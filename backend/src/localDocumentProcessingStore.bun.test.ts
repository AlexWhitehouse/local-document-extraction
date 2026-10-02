import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const at = "2026-10-02T12:00:00.000Z";
const earlier = "2026-09-01T12:00:00.000Z";
const fields = [{ id: "total", name: "Total", description: "Amount due", data_type: "number" as const }];
async function harness() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-processing-store-"));
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" });
  cleanup.push(async () => { store.close(); await rm(stateDirectory, { recursive: true, force: true }); });
  store.createTemplate({ templateId: "invoice", name: "Invoice", description: "Payment due", fields, tags: ["finance"], createdAt: at });
  store.createTemplate({ templateId: "receipt", name: "Receipt", description: "Payment received", fields, tags: ["paid"], createdAt: at });
  return { get store() { return store; }, path: join(stateDirectory, "data/workspaces/test.sqlite"), reopen() { store.close(); store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "test" }); return store; } };
}
function queued(store: LocalWorkspaceProductStore, jobId = "job_auto", templateId: string | null = null) {
  return store.createQueuedExtractionJob({ jobId, templateId, templateVersion: templateId ? 1 : null, templateTags: ["finance"], sourceFileKey: `${jobId}/source.pdf`, sourceMimeType: "application/pdf", sourceName: "Acme invoice packet.pdf", sourceFilePageCount: 2, submittedAt: at });
}
function packet(store: LocalWorkspaceProductStore, packetId = "packet", overrides: Partial<Parameters<LocalWorkspaceProductStore["createDocumentPacket"]>[0]> = {}) {
  return store.createDocumentPacket({ packetId, templateId: "invoice", templateVersion: 1, templateTags: ["finance"], selectedPages: [1, 2], processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: false }, sourceFileKey: `${packetId}/source.pdf`, sourceMimeType: "application/pdf", sourceName: "Packet.pdf", sourceFilePageCount: 2, submittedAt: at, ...overrides });
}
const round = (store: LocalWorkspaceProductStore, packetId = "packet") => store.claimPacketRound({ packetId, updatedAt: at, configurationSnapshot: { revision: 1, model: "classification" } })!;
const accept = (store: LocalWorkspaceProductStore, packetId = "packet", expectedRound = 1) => store.acceptDocumentPacketPlan({ packetId, revision: 1, expectedRound, groups: [[1], [2]], exclusions: [], updatedAt: at });
const blank = (page: number) => ({ page, reason: "Independently verified blank", verified_blank: true });

test("migration from the v10 jobs schema preserves rowids, search, counts, results and source ownership", async () => {
  const h = await harness();
  queued(h.store, "legacy", "invoice");
  h.store.close();
  const db = new Database(h.path);
  const rowid = db.query("SELECT rowid FROM jobs WHERE id='legacy'").get();
  // Recreate the previous nonnullable jobs schema and remove only migration 11.
  // All existing template/source/search/count data remain genuine populated data.
  db.transaction(() => {
    const schema = (db.query("SELECT sql FROM sqlite_master WHERE name='jobs'").get() as { sql: string }).sql;
    const auxiliaries = db.query("SELECT sql FROM sqlite_master WHERE tbl_name='jobs' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as { sql: string }[];
    const columns = (db.query("PRAGMA table_info(jobs)").all() as { name: string }[]).map(({ name }) => `"${name}"`).join(",");
    db.exec(schema.replace(/CREATE TABLE\s+"?jobs"?/i, "CREATE TABLE jobs_v10").replace(/template_id TEXT,/i, "template_id TEXT NOT NULL,").replace(/template_version INTEGER,/i, "template_version INTEGER NOT NULL,").replace(/,\s*'awaiting_template'/, ""));
    db.exec(`INSERT INTO jobs_v10(rowid,${columns}) SELECT rowid,${columns} FROM jobs`);
    db.exec("DROP TABLE jobs; ALTER TABLE jobs_v10 RENAME TO jobs");
    for (const auxiliary of auxiliaries) db.exec(auxiliary.sql);
    db.exec("DROP TABLE document_packet_children; DROP TABLE document_packets; DROP TABLE document_routing");
    for (const name of ["classification_model_name", "classification_supports_pdf_input", "classification_supports_structured_output"]) db.exec(`ALTER TABLE workspace_model_configuration DROP COLUMN ${name}`);
    db.exec("DELETE FROM product_schema_version WHERE version=11; DELETE FROM job_status_totals WHERE status='awaiting_template'");
    db.query("INSERT INTO job_results(job_id,field_id,status,answer_json,normalized_value,created_at,updated_at) VALUES('legacy','total','ok','123','123',?,?)").run(at, at);
  })();
  db.close();
  const store = h.reopen();
  expect(store.countExtractionJobs()).toBe(1);
  expect(store.getExtractionJobCounts()).toMatchObject({ total: 1, status_counts: { queued: 1, awaiting_template: 0 } });
  expect(store.listExtractionJobs({ search: "Acme" }).map((job) => job.job_id)).toEqual(["legacy"]);
  expect(store.getExtractionJobResults("legacy")[0]?.answer).toBe(123);
  expect(store.getProcessingSource("legacy")?.source_file_key).toBe("legacy/source.pdf");
  const after = new Database(h.path);
  expect(after.query("SELECT rowid FROM jobs WHERE id='legacy'").get()).toEqual(rowid);
  after.close();
  queued(store);
  store.holdDocumentRouting({ jobId: "job_auto", reason: "No match", updatedAt: at });
  expect(store.getExtractionJobCounts()).toMatchObject({ total: 2, status_counts: { queued: 1, awaiting_template: 1 } });
  store.deleteExtractionJob({ jobId: "legacy" });
  expect(store.countExtractionJobs()).toBe(1);
  expect(h.reopen().listExtractionJobs({ search: "Acme" })).toHaveLength(1);
});

test("routing binds only the assessed metadata, tags and exact field version, and keeps its budget across restart", async () => {
  const h = await harness();
  queued(h.store);
  const claim = () => h.store.claimRoutingRound({ jobId: "job_auto", updatedAt: at, configurationSnapshot: { revision: 1 } })!;
  expect(claim().candidates[0]).toMatchObject({ id: "invoice", template_version: 1 });
  h.store.updateTemplate({ templateId: "invoice", fields: [{ ...fields[0]!, description: "New total guidance" }], updatedAt: at });
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "invoice", expectedRound: 1, updatedAt: at })).toBe(false);
  h.reopen();
  expect(claim().routing_rounds).toBe(2);
  h.store.updateTemplate({ templateId: "invoice", description: "Changed applicability", updatedAt: at });
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "invoice", expectedRound: 2, updatedAt: at })).toBe(false);
  expect(claim().routing_rounds).toBe(3);
  expect(claim()).toBeNull();
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "invoice", expectedRound: 2, updatedAt: at })).toBe(false);
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "invoice", expectedRound: 3, updatedAt: at })).toBe(true);
  h.store.updateTemplate({ templateId: "invoice", fields: [{ ...fields[0]!, description: "A third version" }], updatedAt: at });
  expect(h.store.getExtractionJobSummary("job_auto")?.template_version).toBe(2);
  expect(h.reopen().getDocumentRouting("job_auto")).toMatchObject({ routing_rounds: 3, routing_status: "resolved" });
});

test("tag removal prevents an automatic bind, while manual resolution is single-winner and may choose another authorized template", async () => {
  const h = await harness();
  queued(h.store);
  h.store.claimRoutingRound({ jobId: "job_auto", updatedAt: at, configurationSnapshot: {} });
  h.store.updateTemplate({ templateId: "invoice", tags: [], updatedAt: at });
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "invoice", expectedRound: 1, updatedAt: at })).toBe(false);
  h.store.holdDocumentRouting({ jobId: "job_auto", reason: "Candidate changed", updatedAt: at });
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "receipt", manual: true, updatedAt: at })).toBe(true);
  expect(h.store.bindDocumentTemplate({ jobId: "job_auto", templateId: "invoice", manual: true, updatedAt: at })).toBe(false);
  expect(h.store.getExtractionJobSummary("job_auto")?.template_id).toBe("receipt");
});

test("packet commit rejects late rounds and concurrent manual revisions without changing stable child identities", async () => {
  const h = await harness();
  packet(h.store);
  round(h.store);
  round(h.store);
  expect(accept(h.store, "packet", 1)).toBeNull();
  expect(h.store.recordPacketAssessment({ packetId: "packet", round: 1, reason: "Late result", evidence: [], updatedAt: at })).toBe(false);
  h.store.holdDocumentPacket({ packetId: "packet", reason: "Boundary remains uncertain", updatedAt: at });
  const input = { packetId: "packet", revision: 1, manual: true, groups: [[1], [2]], exclusions: [], updatedAt: at };
  expect(h.store.acceptDocumentPacketPlan({ ...input, revision: 0 })).toBeNull();
  const accepted = h.store.acceptDocumentPacketPlan(input)!;
  expect(accepted.child_slots).toHaveLength(2);
  expect(h.store.acceptDocumentPacketPlan(input)).toBeNull();
  expect(h.reopen().getDocumentPacket("packet")?.child_slots).toEqual(accepted.child_slots);
});

test("stable fan-out pins the packet's explicit version and cannot resurrect a deleted child or packet", async () => {
  const h = await harness();
  packet(h.store);
  round(h.store);
  const accepted = accept(h.store)!;
  const [one, two] = accepted.child_slots;
  h.store.updateTemplate({ templateId: "invoice", fields: [{ ...fields[0]!, description: "Changed later" }], updatedAt: at });
  h.store.deleteTemplate({ templateId: "invoice", deletedAt: at });
  const materialize = (jobId: string) => h.store.materializePacketChild({ packetId: "packet", jobId, sourceFileKey: `${jobId}/source.pdf`, sourceFilePageCount: 1, updatedAt: at });
  expect(materialize(one!.job_id)?.template_version).toBe(1);
  expect(materialize(one!.job_id)).toBeNull();
  h.store.deleteExtractionJob({ jobId: one!.job_id });
  h.reopen();
  expect(materialize(one!.job_id)).toBeNull();
  expect(h.store.getDocumentPacket("packet")?.child_slots[0]?.state).toBe("deleted");
  expect(materialize(two!.job_id)?.template_version).toBe(1);
  expect(h.store.finishPacketMaterialization({ packetId: "packet", updatedAt: at })).toBe(true);
  expect(h.store.getExtractionJobSummary(two!.job_id)?.source_pages).toEqual([2]);
  h.store.deleteDocumentPacket({ packetId: "packet" });
  expect(materialize(two!.job_id)).toBeNull();
  expect(h.store.getExtractionJobSummary(two!.job_id)).toBeNull();
  expect(h.store.recoverDocumentPackets({ limit: 100, staleProcessingBefore: at })).toEqual([]);
});

test("zero-child completion requires exact coverage, enabled blank removal, and trusted verification provenance", async () => {
  const h = await harness();
  packet(h.store, "packet", { processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: true } });
  round(h.store);
  const input = { packetId: "packet", revision: 1, expectedRound: 1, groups: [], exclusions: [blank(1), blank(2)], updatedAt: at };
  expect(() => h.store.acceptDocumentPacketPlan({ ...input, exclusions: [] })).toThrow();
  expect(() => h.store.acceptDocumentPacketPlan({ ...input, exclusions: [blank(1)] })).toThrow();
  expect(() => h.store.acceptDocumentPacketPlan(input)).toThrow("independently verified");
  expect(h.store.getDocumentPacket("packet")?.plan_accepted).toBe(false);
  h.store.recordPacketAssessment({ packetId: "packet", round: 1, groups: [], exclusions: input.exclusions, reason: "All pages independently verified blank", evidence: ["No text or marks"], updatedAt: at });
  const accepted = h.store.acceptDocumentPacketPlan(input)!;
  expect(accepted).toMatchObject({ status: "completed", outcome: "no_documents", child_slots: [], children: [] });
  expect(h.reopen().getDocumentPacket("packet")).toMatchObject({ status: "completed", outcome: "no_documents" });
  expect(h.store.recoverDocumentPackets({ limit: 100, staleProcessingBefore: at })).toEqual([]);
  expect(h.store.listRetainedTerminalSourceFiles({ failedBefore: earlier })).toMatchObject([{ job_id: "packet" }]);
  packet(h.store, "disabled"); round(h.store, "disabled");
  expect(() => h.store.acceptDocumentPacketPlan({ ...input, packetId: "disabled" })).toThrow();
});

test("manual allblank review requires independently verified pages, not request booleans", async () => {
  const h = await harness();
  packet(h.store, "packet", { processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: true } });
  h.store.holdDocumentPacket({ packetId: "packet", reason: "Needs review", updatedAt: at });
  const input = { packetId: "packet", revision: 1, manual: true, groups: [], exclusions: [blank(1), blank(2)], updatedAt: at };
  expect(() => h.store.acceptDocumentPacketPlan(input)).toThrow("independently verified");
  expect(() => h.store.acceptDocumentPacketPlan({ ...input, verifiedBlankPages: [1] })).toThrow("independently verified");
  expect(h.store.acceptDocumentPacketPlan({ ...input, verifiedBlankPages: [1, 2] })?.outcome).toBe("no_documents");
});

test("held originals survive cleanup, failed packets get ordinary failure retention, remote originals keep ownership", async () => {
  const h = await harness();
  packet(h.store, "held", { submittedAt: earlier });
  h.store.holdDocumentPacket({ packetId: "held", reason: "Review", updatedAt: earlier });
  packet(h.store, "failed");
  h.store.failDocumentPacket({ packetId: "failed", reason: "Failed processing", updatedAt: at });
  packet(h.store, "remote", { sourceRetained: true, retainedObjectKey: "remote-original" });
  h.store.failDocumentPacket({ packetId: "remote", reason: "Failed processing", updatedAt: at });
  expect(h.store.listRetainedTerminalSourceFiles({ failedBefore: earlier }).map((source) => source.job_id)).toEqual(["remote"]);
  expect(h.store.listRetainedTerminalSourceFiles({ failedBefore: at }).map((source) => source.job_id).sort()).toEqual(["failed", "remote"]);
  expect(h.store.getRetainedSourceFile("remote")?.retained_object_key).toBe("remote-original");
});

test("deleting a cleaned packet still records a durable original cleanup pointer", async () => {
  const h = await harness();
  packet(h.store);
  h.store.markSourceFileCleaned({ jobId: "packet", sourceFileKey: "packet/source.pdf", cleanedAt: at });
  expect(h.store.getProcessingSource("packet")).toBeNull();
  expect(h.store.deleteDocumentPacket({ packetId: "packet" })?.sources).toContainEqual({ job_id: "packet", source_file_key: "packet/source.pdf", retained_object_key: null });
  expect(h.reopen().listRetainedTerminalSourceFiles({ failedBefore: at })).toContainEqual({ job_id: "packet", source_file_key: "packet/source.pdf", retained_object_key: null });
});

test("terminal packet failure cleans crash-left reserved artifacts without deleting committed children", async () => {
  const h = await harness();
  packet(h.store);
  round(h.store);
  const accepted = accept(h.store)!;
  const [committed, abandoned] = accepted.child_slots;
  h.store.materializePacketChild({ packetId: "packet", jobId: committed!.job_id, sourceFileKey: "committed/source.pdf", sourceFilePageCount: 1, updatedAt: at });
  h.store.reservePacketChildSource({ packetId: "packet", jobId: abandoned!.job_id, sourceFileKey: "abandoned/source.pdf", retainedObjectKey: "abandoned-remote" });
  h.reopen();
  expect(h.store.failDocumentPacket({ packetId: "packet", reason: "Could not resume materialization", updatedAt: at })).toBe(true);
  expect(h.store.listRetainedTerminalSourceFiles({ failedBefore: earlier })).toEqual([{ job_id: abandoned!.job_id, source_file_key: "abandoned/source.pdf", retained_object_key: "abandoned-remote" }]);
  expect(h.store.getExtractionJobSummary(committed!.job_id)).toMatchObject({ status: "queued" });
  expect(h.store.getDocumentPacket("packet")?.child_slots[1]?.state).toBe("deleted");
  expect(h.store.materializePacketChild({ packetId: "packet", jobId: abandoned!.job_id, sourceFileKey: "late/source.pdf", sourceFilePageCount: 1, updatedAt: at })).toBeNull();
});
