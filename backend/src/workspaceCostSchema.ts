import type { Database } from "bun:sqlite";

/** Install empty read models; historical backfill is resumable, never a startup table scan. */
export function initializeWorkspaceCostSchema(db: Database): void {
  db.transaction(() => {
    if (db.query("SELECT 1 FROM product_schema_version WHERE version=13").get()) return;
    db.exec(`
      CREATE TABLE cost_uploads (
        id TEXT PRIMARY KEY, day TEXT NOT NULL, created_at TEXT NOT NULL, is_multi INTEGER NOT NULL,
        total_sort REAL NOT NULL, page_sort REAL NOT NULL, data TEXT NOT NULL, metrics TEXT NOT NULL, search_text TEXT NOT NULL
      );
      CREATE INDEX cost_uploads_recent ON cost_uploads(created_at DESC,id DESC);
      CREATE INDEX cost_uploads_kind_recent ON cost_uploads(is_multi,created_at DESC,id DESC);
      CREATE INDEX cost_uploads_total ON cost_uploads(day,total_sort DESC,id DESC);
      CREATE INDEX cost_uploads_page ON cost_uploads(day,page_sort DESC,id DESC);
      CREATE INDEX cost_uploads_kind_total ON cost_uploads(day,is_multi,total_sort DESC,id DESC);
      CREATE INDEX cost_uploads_kind_page ON cost_uploads(day,is_multi,page_sort DESC,id DESC);
      CREATE INDEX cost_uploads_hour_total ON cost_uploads(substr(created_at,1,13),total_sort DESC,id DESC);
      CREATE INDEX cost_uploads_hour_page ON cost_uploads(substr(created_at,1,13),page_sort DESC,id DESC);
      CREATE INDEX cost_uploads_hour_kind_total ON cost_uploads(substr(created_at,1,13),is_multi,total_sort DESC,id DESC);
      CREATE INDEX cost_uploads_hour_kind_page ON cost_uploads(substr(created_at,1,13),is_multi,page_sort DESC,id DESC);
      CREATE VIRTUAL TABLE cost_upload_search USING fts5(search_text,content='cost_uploads',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER cost_search_insert AFTER INSERT ON cost_uploads BEGIN
        INSERT INTO cost_upload_search(rowid,search_text) VALUES(new.rowid,new.search_text);
      END;
      CREATE TRIGGER cost_search_update AFTER UPDATE OF search_text ON cost_uploads WHEN old.search_text<>new.search_text BEGIN
        INSERT INTO cost_upload_search(cost_upload_search,rowid,search_text) VALUES('delete',old.rowid,old.search_text);
        INSERT INTO cost_upload_search(rowid,search_text) VALUES(new.rowid,new.search_text);
      END;
      CREATE TABLE cost_documents (
        id TEXT PRIMARY KEY, upload_id TEXT NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL,
        eligible INTEGER NOT NULL, sample_key TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX cost_documents_upload ON cost_documents(upload_id,id);
      CREATE INDEX cost_documents_sample ON cost_documents(day,eligible,sample_key,id);
      CREATE INDEX cost_documents_hour_sample ON cost_documents(substr(created_at,1,13),eligible,sample_key,id);
      CREATE TABLE cost_buckets (bucket TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE cost_dirty (id TEXT PRIMARY KEY);
      CREATE TABLE cost_backfill (singleton INTEGER PRIMARY KEY CHECK(singleton=1), phase TEXT NOT NULL, cursor INTEGER NOT NULL);
      INSERT INTO cost_backfill VALUES(1,'packets',0);
    `);
    const enqueue = (id: string) => `INSERT OR IGNORE INTO cost_dirty(id) VALUES(${id});`;
    const jobOwner = (ref: string) => `COALESCE((SELECT parent_packet_id FROM document_routing WHERE job_id=${ref}.id),${ref}.id)`;
    db.exec(`
      CREATE TRIGGER cost_job_insert AFTER INSERT ON jobs BEGIN ${enqueue(jobOwner("new"))} END;
      CREATE TRIGGER cost_job_update AFTER UPDATE OF status,template_id,current_attempt ON jobs BEGIN ${enqueue(jobOwner("new"))} END;
      CREATE TRIGGER cost_routing_insert AFTER INSERT ON document_routing BEGIN ${enqueue("COALESCE(new.parent_packet_id,new.job_id)")} END;
      CREATE TRIGGER cost_routing_update AFTER UPDATE OF source_pages ON document_routing BEGIN ${enqueue("COALESCE(new.parent_packet_id,new.job_id)")} END;
      CREATE TRIGGER cost_packet_insert AFTER INSERT ON document_packets BEGIN ${enqueue("new.id")} END;
      CREATE TRIGGER cost_packet_update AFTER UPDATE ON document_packets BEGIN ${enqueue("new.id")} END;
      CREATE TRIGGER cost_child_insert AFTER INSERT ON document_packet_children BEGIN ${enqueue("new.packet_id")} END;
      CREATE TRIGGER cost_child_update AFTER UPDATE OF state ON document_packet_children BEGIN ${enqueue("new.packet_id")} END;
      CREATE TRIGGER cost_receipt_insert AFTER INSERT ON model_call_costs BEGIN ${enqueue("COALESCE(new.packet_id,new.owner_id)")} END;
      CREATE TRIGGER cost_receipt_update AFTER UPDATE ON model_call_costs BEGIN ${enqueue("COALESCE(new.packet_id,new.owner_id)")} END;
    `);
    db.query("INSERT INTO product_schema_version(version,applied_at) VALUES(13,?)").run(new Date().toISOString());
  }).immediate();
}
