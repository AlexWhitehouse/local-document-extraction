import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { allocateCost, costAmount, sumCosts, type ProcessingCosts } from "../../shared/processingCosts";
import { COST_STAGES, type CostDocument, type CostMetrics, type CostUpload } from "../../shared/workspaceCosts";

export function emptyCosts(): ProcessingCosts {
  return { currency: "USD", total: costAmount(), split: costAmount(), auto_template: costAmount(), extraction: costAmount() };
}
export function emptyMetrics(): CostMetrics {
  return { costs: emptyCosts(), documents: 0, pages: 0, fullyCostedDocuments: 0, fullyCostedPages: 0, fullyCostedAmount: 0 };
}
export function addMetrics(a: CostMetrics, b: CostMetrics, sign = 1): CostMetrics {
  const result = emptyMetrics();
  for (const stage of [...COST_STAGES, "total"] as const) {
    const x = a.costs[stage], y = b.costs[stage];
    result.costs[stage] = costAmount(Math.max(0, (x.amount ?? 0) + sign * (y.amount ?? 0)), x.reported_calls + sign * y.reported_calls, x.unreported_calls + sign * y.unreported_calls);
  }
  for (const key of ["documents", "pages", "fullyCostedDocuments", "fullyCostedPages", "fullyCostedAmount"] as const) result[key] = Math.max(0, a[key] + sign * b[key]);
  return result;
}
export const fullyCosted = (document: CostDocument) => ["completed", "failed"].includes(document.status) && document.costs.total.complete && document.pages > 0;
const decode = <T>(row: { data: string } | null): T | null => row ? JSON.parse(row.data) as T : null;
export const readCostUpload = (db: Database, id: string) => decode<CostUpload>(db.query("SELECT data FROM cost_uploads WHERE id=?").get(id) as { data: string } | null);
export const readCostDocuments = (db: Database, id: string) => (db.query("SELECT data FROM cost_documents WHERE upload_id=? ORDER BY id").all(id) as { data: string }[]).map(row => JSON.parse(row.data) as CostDocument);

type Job = { id: string; source_name: string | null; source_mime_type: string; created_at: string; status: string; template_id: string | null; template_name: string | null; page_count: number | null; source_pages: string | null; parent_packet_id: string | null; current_attempt: number };
type Packet = { id: string; source_name: string | null; created_at: string; status: string; selected_pages: string; exclusions_json: string; template_id: string | null };
const JOB = `SELECT j.id,j.source_name,j.source_mime_type,j.created_at,j.status,j.template_id,j.current_attempt,
  t.name AS template_name,s.page_count,r.source_pages,r.parent_packet_id FROM jobs j
  LEFT JOIN templates t ON t.id=j.template_id LEFT JOIN source_files s ON s.job_id=j.id
  LEFT JOIN document_routing r ON r.job_id=j.id`;

export function createCostProjection(db: Database) {
  function refresh(id: string): void {
    const old = db.query("SELECT data,metrics FROM cost_uploads WHERE id=?").get(id) as { data: string; metrics: string } | null;
    const previous = old ? JSON.parse(old.data) as CostUpload : null;
    const packet = db.query("SELECT id,source_name,created_at,status,selected_pages,exclusions_json,template_id FROM document_packets WHERE id=?").get(id) as Packet | null;
    const job = packet ? null : db.query(`${JOB} WHERE j.id=?`).get(id) as Job | null;
    // A job insert can precede its routing insert in the same transaction.
    if (job?.parent_packet_id) { db.query("INSERT OR IGNORE INTO cost_dirty VALUES(?)").run(job.parent_packet_id); return; }
    if (!packet && !job && !previous) return;
    const kind = packet || previous?.kind === "packet" ? "packet" : "document";
    const storedDocuments = readCostDocuments(db, id);
    const prior = new Map(storedDocuments.map(document => [document.id, document]));
    const receiptRows = db.query(`SELECT owner_id,stage,COALESCE(SUM(amount),0) AS amount,COUNT(amount) AS reported,COUNT(*)-COUNT(amount) AS unreported
      FROM model_call_costs WHERE ${kind === "packet" ? "packet_id" : "owner_id"}=? GROUP BY owner_id,stage`).all(id) as { owner_id: string; stage: typeof COST_STAGES[number]; amount: number; reported: number; unreported: number }[];
    const owners = new Map<string, ProcessingCosts>();
    for (const receipt of receiptRows) {
      const costs = owners.get(receipt.owner_id) ?? emptyCosts();
      costs[receipt.stage] = costAmount(receipt.amount, receipt.reported, receipt.unreported);
      owners.set(receipt.owner_id, costs);
    }
    const created_at = new Date(packet?.created_at ?? job?.created_at ?? previous!.created_at).toISOString();
    const pageNumbers: number[] = packet ? JSON.parse(packet.selected_pages) : job
      ? job.source_pages ? JSON.parse(job.source_pages) : Array.from({ length: job.page_count ?? (job.source_mime_type.startsWith("image/") ? 1 : 0) }, (_, i) => i + 1)
      : previous!.pageNumbers;
    const excludedPageNumbers: number[] = packet ? (JSON.parse(packet.exclusions_json) as { page: number }[]).map(item => item.page) : previous?.excludedPageNumbers ?? [];
    const upload: CostUpload = {
      id, kind, name: (packet?.source_name ?? job?.source_name ?? previous?.name ?? id).slice(0, 1000), created_at,
      status: packet?.status ?? job?.status ?? previous!.status, pages: pageNumbers.length, pageNumbers,
      excludedPages: excludedPageNumbers.length, excludedPageNumbers, deleted: previous?.deleted ?? false,
      documentCount: 0, costs: emptyCosts(),
    };
    const jobs = packet ? db.query(`${JOB} WHERE j.id IN (SELECT job_id FROM document_packet_children WHERE packet_id=?)`).all(id) as Job[] : job ? [job] : [];
    const current = new Map(jobs.map(item => [item.id, item]));
    const slots = packet ? db.query("SELECT job_id,pages,state FROM document_packet_children WHERE packet_id=? ORDER BY position").all(id) as { job_id: string; pages: string; state: string }[]
      : kind === "packet" ? storedDocuments.map(document => ({ job_id: document.id, pages: JSON.stringify(document.pageNumbers), state: "deleted" }))
      : [{ job_id: id, pages: JSON.stringify(pageNumbers), state: upload.deleted ? "deleted" : "materialized" }];
    const documents: CostDocument[] = slots.map(slot => {
      const live = current.get(slot.job_id), before = prior.get(slot.job_id);
      const pages: number[] = JSON.parse(slot.pages);
      const costs = owners.get(slot.job_id) ?? emptyCosts();
      if (kind === "packet") {
        costs.split = allocateCost((owners.get(id) ?? emptyCosts()).split, pages.length, upload.pages || 1);
        costs.split_allocation = { document_pages: pages.length, packet_pages: upload.pages };
      }
      costs.total = sumCosts(COST_STAGES.map(stage => costs[stage]));
      return { id: slot.job_id, kind: "document", name: (live?.source_name ?? before?.name ?? upload.name).slice(0, 1000),
        templateId: live?.template_id ?? before?.templateId ?? packet?.template_id ?? null,
        template: (before && before.templateId === live?.template_id ? before.template : live?.template_name ?? before?.template ?? "Unassigned").slice(0, 1000),
        pages: pages.length, pageNumbers: pages, created_at, status: live?.status ?? before?.status ?? "pending",
        deleted: upload.deleted || slot.state === "deleted" || before?.deleted || false,
        retried: (live?.current_attempt ?? 0) > 1 || before?.retried || costs.extraction.reported_calls + costs.extraction.unreported_calls > 1,
        costs };
    });
    if (kind === "packet") {
      for (const stage of COST_STAGES) upload.costs[stage] = sumCosts([...owners.values()].map(costs => costs[stage]));
      // Allocated shares above must not be counted a second time in the packet.
      upload.costs.split = (owners.get(id) ?? emptyCosts()).split;
      upload.costs.excluded_pages_cost = allocateCost(upload.costs.split, excludedPageNumbers.length, upload.pages || 1);
    } else upload.costs = documents[0]!.costs;
    upload.costs.total = sumCosts(COST_STAGES.map(stage => upload.costs[stage]));
    upload.documentCount = documents.length;
    if (upload.status === "processing_children" && documents.every(document => document.deleted || ["completed", "failed"].includes(document.status))) {
      upload.status = documents.some(document => !document.deleted && document.status === "failed") ? "failed" : "completed";
    }
    const metrics = emptyMetrics();
    metrics.costs = upload.costs;
    for (const document of documents) {
      metrics.documents += 1; metrics.pages += document.pages;
      if (fullyCosted(document)) { metrics.fullyCostedDocuments += 1; metrics.fullyCostedPages += document.pages; metrics.fullyCostedAmount += document.costs.total.amount ?? 0; }
      db.query(`INSERT INTO cost_documents(id,upload_id,day,created_at,eligible,sample_key,data) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET day=excluded.day,created_at=excluded.created_at,eligible=excluded.eligible,data=excluded.data`)
        .run(document.id, id, created_at.slice(0, 10), created_at, Number(fullyCosted(document)), createHash("sha256").update(document.id).digest("hex").slice(0, 16), JSON.stringify(document));
    }
    for (const bucket of [created_at.slice(0, 10), created_at.slice(0, 13)]) {
      const stored = decode<CostMetrics>(db.query("SELECT data FROM cost_buckets WHERE bucket=?").get(bucket) as { data: string } | null) ?? emptyMetrics();
      const next = addMetrics(old ? addMetrics(stored, JSON.parse(old.metrics), -1) : stored, metrics);
      db.query("INSERT INTO cost_buckets VALUES(?,?) ON CONFLICT(bucket) DO UPDATE SET data=excluded.data").run(bucket, JSON.stringify(next));
    }
    db.query(`INSERT INTO cost_uploads VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      is_multi=excluded.is_multi,total_sort=excluded.total_sort,page_sort=excluded.page_sort,data=excluded.data,metrics=excluded.metrics,search_text=excluded.search_text`)
      .run(id, created_at.slice(0, 10), created_at, Number(documents.length > 1), upload.costs.total.amount ?? -1,
        upload.costs.total.amount === null || !upload.pages ? -1 : upload.costs.total.amount / upload.pages,
        JSON.stringify(upload), JSON.stringify(metrics), [upload.name, ...documents.map(document => `${document.name} ${document.template}`)].join(" ").toLowerCase());
  }

  const refreshTransaction = db.transaction(refresh);
  return {
    refreshCostUpload: (id: string) => refreshTransaction(id),
    /** Capture before product metadata disappears. Receipts and these snapshots have no deletion cascade. */
    retainDeletedCostDocument(jobId: string): void {
      const captured = db.query("SELECT json_extract(data,'$.deleted') AS deleted FROM cost_documents WHERE id=?").get(jobId) as { deleted: number } | null;
      // An enclosing packet deletion has already captured and marked every child in this transaction.
      if (captured?.deleted) return;
      const route = db.query("SELECT parent_packet_id FROM document_routing WHERE job_id=?").get(jobId) as { parent_packet_id: string | null } | null;
      const uploadId = route?.parent_packet_id ?? jobId;
      refresh(uploadId);
      const document = decode<CostDocument>(db.query("SELECT data FROM cost_documents WHERE id=?").get(jobId) as { data: string } | null);
      if (document) { document.deleted = true; db.query("UPDATE cost_documents SET data=? WHERE id=?").run(JSON.stringify(document), jobId); }
      if (uploadId === jobId) {
        const upload = readCostUpload(db, uploadId);
        if (upload) { upload.deleted = true; db.query("UPDATE cost_uploads SET data=? WHERE id=?").run(JSON.stringify(upload), uploadId); }
      }
      db.query("INSERT OR IGNORE INTO cost_dirty VALUES(?)").run(uploadId);
    },
    retainDeletedCostPacket(packetId: string): void {
      refresh(packetId);
      const upload = readCostUpload(db, packetId);
      if (upload) { upload.deleted = true; db.query("UPDATE cost_uploads SET data=? WHERE id=?").run(JSON.stringify(upload), packetId); }
      for (const document of readCostDocuments(db, packetId)) {
        document.deleted = true;
        db.query("UPDATE cost_documents SET data=? WHERE id=?").run(JSON.stringify(document), document.id);
      }
      db.query("INSERT OR IGNORE INTO cost_dirty VALUES(?)").run(packetId);
    },
    /** Each transaction has bounded work. The durable cursor and dirty IDs survive interruption. */
    processCostUpdates: (maximum = 50, budgetMs = 8): boolean => db.transaction(() => {
      const deadline = performance.now() + budgetMs;
      let processed = 0;
      const dirty = db.query("SELECT id FROM cost_dirty LIMIT ?").all(maximum) as { id: string }[];
      for (const { id } of dirty) {
        refresh(id); db.query("DELETE FROM cost_dirty WHERE id=?").run(id);
        processed += 1;
        if (performance.now() >= deadline) break;
      }
      const state = db.query("SELECT phase,cursor FROM cost_backfill WHERE singleton=1").get() as { phase: string; cursor: number };
      if (state.phase !== "done" && processed < maximum && performance.now() < deadline) {
        const table = state.phase === "packets" ? "document_packets" : "jobs";
        const rows = db.query(`SELECT rowid,id FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT ?`).all(state.cursor, maximum - processed) as { rowid: number; id: string }[];
        for (const row of rows) {
          refresh(row.id); state.cursor = row.rowid;
          if (performance.now() >= deadline) break;
        }
        if (!rows.length) { state.phase = state.phase === "packets" ? "jobs" : "done"; state.cursor = 0; }
        db.query("UPDATE cost_backfill SET phase=?,cursor=? WHERE singleton=1").run(state.phase, state.cursor);
      }
      return state.phase !== "done" || Boolean(db.query("SELECT 1 FROM cost_dirty LIMIT 1").get());
    }).immediate(),
  };
}
