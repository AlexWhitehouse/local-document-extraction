import { isJsonArray, parseJson } from "../../shared/json";
import type { SQLQueryBindings, Database } from "bun:sqlite";
import {
  allocateCost,
  costAmount,
  sumCosts,
  type CostAmount,
  type ProcessingCosts,
  type ProcessingCostStage,
} from "../../shared/processingCosts";
import type { ModelCallObserver, ModelCallUsage } from "./consumer/modelUsage";
import { newId } from "./lib/ids";

/** Minimal accounting records, without request/response content or credentials. */
export function initializeModelCostSchema(database: Database): void {
  database
    .transaction(() => {
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
      database
        .query("INSERT INTO product_schema_version(version,applied_at) VALUES (12,?)")
        .run(new Date().toISOString());
    })
    .immediate();
}

type Aggregate = { stage: ProcessingCostStage; amount: number; reported: number; unreported: number };

export function createModelCostStore(database: Database) {
  function summary(costs: Record<ProcessingCostStage, CostAmount>): ProcessingCosts {
    return { currency: "USD", ...costs, total: sumCosts(Object.values(costs)) };
  }

  return {
    modelCallObserver(input: {
      ownerId: string;
      stage: ProcessingCostStage;
      model: string;
      configurationRevision: number;
      now(): string;
    }): ModelCallObserver {
      return {
        started: () => {
          const packet =
            input.stage === "split"
              ? database
                  .query<{ packet_id: string }, SQLQueryBindings[]>(
                    "SELECT id AS packet_id FROM document_packets WHERE id=?",
                  )
                  .get(input.ownerId)
              : database
                  .query<{ packet_id: string | null }, SQLQueryBindings[]>(
                    "SELECT r.parent_packet_id AS packet_id FROM jobs j LEFT JOIN document_routing r ON r.job_id=j.id WHERE j.id=?",
                  )
                  .get(input.ownerId);

          if (!packet) throw new Error("Cost owner is no longer available");
          const id = newId("call");
          database
            .query(
              `INSERT INTO model_call_costs(id,owner_id,packet_id,stage,model,configuration_revision,started_at) VALUES (?,?,?,?,?,?,?)`,
            )
            .run(
              id,
              input.ownerId,
              packet.packet_id,
              input.stage,
              input.model,
              input.configurationRevision,
              input.now(),
            );

          return id;
        },
        finished: (id: string, usage: ModelCallUsage) => {
          // A receipt is written once. Replaying it cannot add spend or overwrite it.
          database
            .query(
              `UPDATE model_call_costs SET amount=?,currency=?,cost_source=?,request_id=?,input_tokens=?,output_tokens=?,cached_input_tokens=?,finished_at=?
            WHERE id=? AND owner_id=? AND finished_at IS NULL`,
            )
            .run(
              usage.cost,
              usage.currency,
              usage.cost_source,
              usage.request_id,
              usage.input_tokens,
              usage.output_tokens,
              usage.cached_input_tokens,
              input.now(),
              id,
              input.ownerId,
            );
        },
      };
    },
    getDocumentCosts: (jobId: string): ProcessingCosts => documentCosts([jobId]).get(jobId)!,
    getDocumentCostsBatch: documentCosts,
    getPacketCosts: (packetId: string): ProcessingCosts => packetCosts([packetId]).get(packetId)!,
    getPacketCostsBatch: packetCosts,
  };

  /** Costs for every requested Document, with packet split shares, in a fixed number of queries. */
  function documentCosts(jobIds: readonly string[]): Map<string, ProcessingCosts> {
    const owned = stagesByOwner("owner_id", jobIds);

    const lineages = database
      .query<
        { job_id: string; packet_id: string; source_pages: string; selected_pages: string },
        SQLQueryBindings[]
      >(
        `SELECT r.job_id,r.parent_packet_id AS packet_id,r.source_pages,p.selected_pages FROM document_routing r
        JOIN document_packets p ON p.id=r.parent_packet_id WHERE r.job_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(jobIds));

    const packetStages = lineages.length
      ? stagesByOwner("owner_id", [...new Set(lineages.map((lineage) => lineage.packet_id))])
      : new Map<string, Record<ProcessingCostStage, CostAmount>>();

    const lineageByJob = new Map(lineages.map((lineage) => [lineage.job_id, lineage]));
    const result = new Map<string, ProcessingCosts>();

    for (const jobId of jobIds) {
      const costs = owned.get(jobId) ?? emptyStages();
      const lineage = lineageByJob.get(jobId);

      if (!lineage) {
        result.set(jobId, summary(costs));
        continue;
      }

      const documentPages = pageCount(lineage.source_pages);
      const packetPages = pageCount(lineage.selected_pages);
      costs.split = allocateCost(
        (packetStages.get(lineage.packet_id) ?? emptyStages()).split,
        documentPages,
        packetPages,
      );
      result.set(jobId, {
        ...summary(costs),
        split_allocation: { document_pages: documentPages, packet_pages: packetPages },
      });
    }

    return result;
  }

  /** Costs for every requested Document packet in a fixed number of queries. */
  function packetCosts(packetIds: readonly string[]): Map<string, ProcessingCosts> {
    const owned = stagesByOwner("packet_id", packetIds);

    const packets = new Map(
      database
        .query<{ id: string; selected_pages: string; exclusions_json: string }, SQLQueryBindings[]>(
          "SELECT id,selected_pages,exclusions_json FROM document_packets WHERE id IN (SELECT value FROM json_each(?))",
        )
        .all(JSON.stringify(packetIds))
        .map((packet) => [packet.id, packet]),
    );

    const result = new Map<string, ProcessingCosts>();

    for (const packetId of packetIds) {
      const costs = owned.get(packetId) ?? emptyStages();
      const packet = packets.get(packetId);
      const total = summary(costs);

      if (packet)
        total.excluded_pages_cost = allocateCost(
          costs.split,
          pageCount(packet.exclusions_json),
          pageCount(packet.selected_pages),
        );
      result.set(packetId, total);
    }

    return result;
  }

  function stagesByOwner(column: "owner_id" | "packet_id", ids: readonly string[]) {
    const costs = new Map<string, Record<ProcessingCostStage, CostAmount>>();

    if (!ids.length) return costs;

    for (const row of database
      .query<Aggregate & { id: string }, SQLQueryBindings[]>(
        `SELECT ${column} AS id,stage,COALESCE(SUM(amount),0) AS amount,
      COUNT(amount) AS reported,COUNT(*)-COUNT(amount) AS unreported
      FROM model_call_costs WHERE ${column} IN (SELECT value FROM json_each(?)) GROUP BY ${column},stage`,
      )
      .all(JSON.stringify(ids))) {
      const stages = costs.get(row.id) ?? emptyStages();
      stages[row.stage] = costAmount(row.amount, row.reported, row.unreported);
      costs.set(row.id, stages);
    }

    return costs;
  }
}

function emptyStages(): Record<ProcessingCostStage, CostAmount> {
  return { split: costAmount(), auto_template: costAmount(), extraction: costAmount() };
}

function pageCount(encoded: string): number {
  const pages = parseJson(encoded);

  if (!isJsonArray(pages)) throw new Error("Stored page list is invalid");

  return pages.length;
}
