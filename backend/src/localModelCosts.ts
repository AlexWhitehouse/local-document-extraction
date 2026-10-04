import type { Database } from "bun:sqlite";
import { allocateCost, costAmount, sumCosts, type CostAmount, type ProcessingCosts, type ProcessingCostStage } from "../../shared/processingCosts";
import type { ModelCallObserver, ModelCallUsage } from "./consumer/modelUsage";
import { newId } from "./lib/ids";

/** Minimal accounting records, without request/response content or credentials. */
export function initializeModelCostSchema(database: Database): void {
  database.transaction(() => {
    if (database.query("SELECT 1 FROM product_schema_version WHERE version=12").get()) return;
    database.exec(`
      CREATE TABLE model_call_costs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, packet_id TEXT,
        stage TEXT NOT NULL CHECK (stage IN ('split','auto_template','extraction')),
        model TEXT, configuration_revision INTEGER, request_id TEXT,
        amount REAL CHECK (amount IS NULL OR amount >= 0), currency TEXT, cost_source TEXT,
        input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER,
        started_at TEXT NOT NULL, finished_at TEXT
      );
      CREATE INDEX idx_model_call_costs_owner ON model_call_costs(owner_id,stage);
      CREATE INDEX idx_model_call_costs_packet ON model_call_costs(packet_id,stage);
      INSERT INTO model_call_costs(id,owner_id,packet_id,stage,started_at,finished_at)
        SELECT 'legacy-extraction-' || j.id,j.id,r.parent_packet_id,'extraction',j.created_at,j.updated_at
        FROM jobs j LEFT JOIN document_routing r ON r.job_id=j.id
        WHERE j.current_attempt > 0 OR j.status IN ('completed','failed');
      INSERT INTO model_call_costs(id,owner_id,packet_id,stage,started_at,finished_at)
        SELECT 'legacy-routing-' || j.id,j.id,r.parent_packet_id,'auto_template',j.created_at,j.updated_at
        FROM jobs j JOIN document_routing r ON r.job_id=j.id WHERE r.routing_rounds > 0;
      INSERT INTO model_call_costs(id,owner_id,packet_id,stage,started_at,finished_at)
        SELECT 'legacy-split-' || id,id,id,'split',created_at,updated_at FROM document_packets WHERE assessment_rounds > 0;
    `);
    database.query("INSERT INTO product_schema_version(version,applied_at) VALUES (12,?)").run(new Date().toISOString());
  }).immediate();
}

type Aggregate = { stage: ProcessingCostStage; amount: number; reported: number; unreported: number };

export function createModelCostStore(database: Database) {
  function stages(column: "owner_id" | "packet_id", id: string) {
    const costs = { split: costAmount(), auto_template: costAmount(), extraction: costAmount() };
    const rows = database.query(`SELECT stage,COALESCE(SUM(amount),0) AS amount,
      COUNT(amount) AS reported,COUNT(*)-COUNT(amount) AS unreported
      FROM model_call_costs WHERE ${column}=? GROUP BY stage`).all(id) as Aggregate[];
    for (const row of rows) costs[row.stage] = costAmount(row.amount, row.reported, row.unreported);
    return costs;
  }
  function summary(costs: Record<ProcessingCostStage, CostAmount>): ProcessingCosts {
    return { currency: "USD", ...costs, total: sumCosts(Object.values(costs)) };
  }
  return {
    modelCallObserver(input: { ownerId: string; stage: ProcessingCostStage; model: string; configurationRevision: number; now(): string }): ModelCallObserver {
      return {
        started: () => {
          const packet = input.stage === "split"
            ? database.query("SELECT id AS packet_id FROM document_packets WHERE id=?").get(input.ownerId) as { packet_id: string } | null
            : database.query("SELECT r.parent_packet_id AS packet_id FROM jobs j LEFT JOIN document_routing r ON r.job_id=j.id WHERE j.id=?").get(input.ownerId) as { packet_id: string | null } | null;
          if (!packet) throw new Error("Cost owner is no longer available");
          const id = newId("call");
          database.query(`INSERT INTO model_call_costs(id,owner_id,packet_id,stage,model,configuration_revision,started_at) VALUES (?,?,?,?,?,?,?)`)
            .run(id, input.ownerId, packet.packet_id, input.stage, input.model, input.configurationRevision, input.now());
          return id;
        },
        finished: (id: string, usage: ModelCallUsage) => {
          // A receipt is written once. Replaying it cannot add spend or overwrite it.
          database.query(`UPDATE model_call_costs SET amount=?,currency=?,cost_source=?,request_id=?,input_tokens=?,output_tokens=?,cached_input_tokens=?,finished_at=?
            WHERE id=? AND owner_id=? AND finished_at IS NULL`)
            .run(usage.cost, usage.currency, usage.cost_source, usage.request_id, usage.input_tokens, usage.output_tokens, usage.cached_input_tokens, input.now(), id, input.ownerId);
        },
      };
    },
    getDocumentCosts(jobId: string): ProcessingCosts {
      const costs = stages("owner_id", jobId);
      const lineage = database.query(`SELECT r.source_pages,p.selected_pages FROM document_routing r
        JOIN document_packets p ON p.id=r.parent_packet_id WHERE r.job_id=?`).get(jobId) as { source_pages: string; selected_pages: string } | null;
      if (!lineage) return summary(costs);
      const packet = database.query("SELECT parent_packet_id AS id FROM document_routing WHERE job_id=?").get(jobId) as { id: string };
      const documentPages = (JSON.parse(lineage.source_pages) as number[]).length;
      const packetPages = (JSON.parse(lineage.selected_pages) as number[]).length;
      costs.split = allocateCost(stages("owner_id", packet.id).split, documentPages, packetPages);
      return { ...summary(costs), split_allocation: { document_pages: documentPages, packet_pages: packetPages } };
    },
    getPacketCosts(packetId: string): ProcessingCosts {
      const costs = stages("packet_id", packetId);
      const packet = database.query("SELECT selected_pages,exclusions_json FROM document_packets WHERE id=?").get(packetId) as { selected_pages: string; exclusions_json: string } | null;
      return { ...summary(costs), ...(packet ? { excluded_pages_cost: allocateCost(costs.split, JSON.parse(packet.exclusions_json).length, JSON.parse(packet.selected_pages).length) } : {}) };
    },
  };
}
