import type { SQLQueryBindings, Database } from "bun:sqlite";
import { costAmount, type CostAmount } from "../../shared/processingCosts";
import type { ModelCallObserver, ModelCallUsage } from "./consumer/modelUsage";
import { newId } from "./lib/ids";

/** Model calls the Workspace pays for that belong to no Document, such as search interpretation. */
export type WorkspaceModelCostPurpose = "search";

export type WorkspaceModelCostSummary = { calls: number; costs: CostAmount };

/** Schema version 18. Accounting only: no request or response content and no credentials. */
export function createWorkspaceModelCostSchema(database: Database): void {
  database.exec(`
    CREATE TABLE workspace_model_costs (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL CHECK (purpose IN ('search')),
      model TEXT, configuration_revision INTEGER, request_id TEXT,
      amount REAL CHECK (amount IS NULL OR amount >= 0), currency TEXT, cost_source TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER,
      started_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE INDEX idx_workspace_model_costs_started ON workspace_model_costs(started_at);
  `);
}

/** Records each call before transport, then its usage once, like Document model call receipts. */
export function createWorkspaceModelCostObserver(
  database: Database,
  input: { purpose: WorkspaceModelCostPurpose; model: string; configurationRevision: number; now(): string },
): ModelCallObserver {
  return {
    started: () => {
      const id = newId("wcall");
      database
        .query(
          "INSERT INTO workspace_model_costs(id,purpose,model,configuration_revision,started_at) VALUES (?,?,?,?,?)",
        )
        .run(id, input.purpose, input.model, input.configurationRevision, input.now());

      return id;
    },
    finished: (id: string, usage: ModelCallUsage) => {
      // A receipt is written once. Replaying it cannot add spend or overwrite it.
      database
        .query(
          `UPDATE workspace_model_costs SET amount=?,currency=?,cost_source=?,request_id=?,input_tokens=?,output_tokens=?,
          cached_input_tokens=?,finished_at=? WHERE id=? AND finished_at IS NULL`,
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
        );
    },
  };
}

/** Calls started in `[start, end)`, read through the `started_at` index. */
export function readWorkspaceModelCosts(
  database: Database,
  purpose: WorkspaceModelCostPurpose,
  range: { start: string; end: string },
): WorkspaceModelCostSummary {
  // SAFETY: an aggregate without GROUP BY always returns exactly one row.
  const row = database
    .query<{ calls: number; amount: number; reported: number }, SQLQueryBindings[]>(
      `SELECT COUNT(*) AS calls,COALESCE(SUM(amount),0) AS amount,COUNT(amount) AS reported
      FROM workspace_model_costs WHERE started_at>=? AND started_at<? AND purpose=?`,
    )
    .get(range.start, range.end, purpose)!;

  return { calls: row.calls, costs: costAmount(row.amount, row.reported, row.calls - row.reported) };
}

export function createWorkspaceModelCostStore(database: Database) {
  return {
    workspaceModelCallObserver: (input: Parameters<typeof createWorkspaceModelCostObserver>[1]) =>
      createWorkspaceModelCostObserver(database, input),
  };
}
