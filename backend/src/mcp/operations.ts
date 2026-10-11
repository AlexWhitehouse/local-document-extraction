import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { LocalWorkspaceProductStoreHandle } from "../localWorkspaceProductStoreRegistry";
import { isJsonObject, parseJson, type JsonObject, type JsonValue } from "../../../shared/json";
import { HttpError } from "../lib/http";
import type { DelegatedActor } from "./grants";

type OperationRow = {
  id: string; grant_id: string; workspace_id: string; action: string; input_hash: string;
  input_json: string; status: "pending" | "executing" | "completed" | "denied" | "failed";
  result_json: string | null; expires_at: string; created_at: string; approval: number;
};

export type McpOperation = Omit<OperationRow, "input_json" | "result_json"> & { input: JsonObject; result: JsonObject | null };

function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return "null";

  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  if (isJsonObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;

  return JSON.stringify(value);
}

export function mcpInputHash(input: JsonObject): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

export function findMcpSubmissionResult(store: LocalWorkspaceProductStoreHandle, operationId: string): JsonObject | null {
  const packet = store.getDocumentPacket(operationId);

  if (packet) return { packet_id: packet.packet_id, status: packet.status };
  const job = store.getExtractionJobSummary(operationId);

  return job ? { job_id: job.job_id, status: job.status } : null;
}

function jsonObject(text: string): JsonObject {
  const value = parseJson(text);

  if (!isJsonObject(value)) throw new Error("Invalid persisted MCP operation");

  return value;
}

function operation(row: OperationRow): McpOperation {
  const { input_json, result_json, ...rest } = row;

  return { ...rest, input: jsonObject(input_json), result: result_json ? jsonObject(result_json) : null };
}

export function createMcpOperationStore(database: Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS mcp_operations (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, action TEXT NOT NULL,
    idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL, input_json TEXT NOT NULL,
    status TEXT NOT NULL, result_json TEXT, approval INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    UNIQUE(grant_id, workspace_id, action, idempotency_key)
  );`);

  // A fresh application instance owns no executions from the previous process.
  // Product receipts and deterministic submission IDs reconcile committed work.
  database.query("UPDATE mcp_operations SET status = 'failed', result_json = ? WHERE status = 'executing'")
    .run(JSON.stringify({ error: { code: "mcp_outcome_unknown" } }));

  function get(id: string): McpOperation | null {
    const row = database.query<OperationRow, [string]>("SELECT * FROM mcp_operations WHERE id = ?").get(id);

    return row ? operation(row) : null;
  }

  return {
    get,
    recover(actor: DelegatedActor, id: string, result: JsonObject): void {
      database.transaction(() => {
        const saved = get(id);

        if (!saved || saved.grant_id !== actor.grantId || saved.workspace_id !== actor.workspaceId) throw new HttpError(404, "not_found", "Operation not found.");

        const updated = database.query("UPDATE mcp_operations SET status = 'completed', result_json = ? WHERE id = ? AND status IN ('executing', 'failed')")
          .run(JSON.stringify(result), id);

        if (updated.changes) database.query(`INSERT INTO mcp_security_activity
          (id,user_id,client_id,grant_id,workspace_id,action,request_id,approval_id,outcome,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), actor.userId, actor.clientId, actor.grantId, actor.workspaceId,
            saved.action, id, saved.approval ? id : null, "recovered_commit", new Date().toISOString());
      })();
    },
    find(actor: DelegatedActor, action: string, key: string): McpOperation | null {
      const row = database.query<OperationRow, [string, string, string, string]>(
        "SELECT * FROM mcp_operations WHERE grant_id = ? AND workspace_id = ? AND action = ? AND idempotency_key = ?",
      ).get(actor.grantId, actor.workspaceId, action, key);

      return row ? operation(row) : null;
    },
    prepare(actor: DelegatedActor, action: string, key: string, input: JsonObject, approval: boolean): McpOperation {
      const hash = mcpInputHash(input);

      const existing = database.query<OperationRow, [string, string, string, string]>(
        "SELECT * FROM mcp_operations WHERE grant_id = ? AND workspace_id = ? AND action = ? AND idempotency_key = ?",
      ).get(actor.grantId, actor.workspaceId, action, key);

      if (existing) {
        if (existing.input_hash !== hash) throw new HttpError(409, "mcp_idempotency_conflict", "This operation key was already used with different inputs.");

        return operation(existing);
      }

      const id = randomUUID();

      database.query(`INSERT INTO mcp_operations
        (id,grant_id,workspace_id,action,idempotency_key,input_hash,input_json,status,approval,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,'pending',?,?,?)`).run(id, actor.grantId, actor.workspaceId, action, key, hash,
          canonical(input), approval ? 1 : 0, new Date().toISOString(), new Date(Date.now() + (approval ? 600_000 : 30 * 86400_000)).toISOString());

      const saved = get(id);

      if (!saved) throw new Error("MCP operation was not persisted");

      return saved;
    },
    claim(id: string): boolean {
      return database.query("UPDATE mcp_operations SET status = 'executing' WHERE id = ? AND status = 'pending' AND expires_at > ?")
        .run(id, new Date().toISOString()).changes === 1;
    },
    /** Returns a claimed operation to pending when its product store holds no committed result. */
    release(id: string): void {
      database.query("UPDATE mcp_operations SET status = 'pending' WHERE id = ? AND status = 'executing'").run(id);
    },
    deny(id: string): void {
      database.query("UPDATE mcp_operations SET status = 'denied' WHERE id = ? AND status = 'pending'").run(id);
    },
    complete(id: string, result: JsonObject): void {
      database.query("UPDATE mcp_operations SET status = 'completed', result_json = ? WHERE id = ? AND status = 'executing'")
        .run(JSON.stringify(result), id);
    },
    fail(id: string, code: string): void {
      database.query("UPDATE mcp_operations SET status = 'failed', result_json = ? WHERE id = ? AND status = 'executing'")
        .run(JSON.stringify({ error: { code } }), id);
    },
    transaction<T>(work: () => T): T { return database.transaction(work)(); },
  };
}

/** Receipts commit with product mutations. A crash between databases can then
 * recover the result and finish the control audit without repeating the action. */
export function createMcpProductReceipts(database: Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS mcp_operation_receipts (
    id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
  );`);

  database.query("DELETE FROM mcp_operation_receipts WHERE created_at < ?").run(new Date(Date.now() - 90 * 86400_000).toISOString());

  return {
    getMcpOperationReceipt(id: string): JsonObject | null {
      const row = database.query<{ result_json: string }, [string]>("SELECT result_json FROM mcp_operation_receipts WHERE id = ?").get(id);

      return row ? jsonObject(row.result_json) : null;
    },
    runMcpProductOperation(id: string, inputHash: string, work: () => JsonObject): JsonObject {
      return database.transaction(() => {
        const prior = database.query<{ input_hash: string; result_json: string }, [string]>("SELECT input_hash, result_json FROM mcp_operation_receipts WHERE id = ?").get(id);

        if (prior) {
          if (prior.input_hash !== inputHash) throw new HttpError(409, "mcp_idempotency_conflict", "Operation inputs changed.");

          return jsonObject(prior.result_json);
        }

        const result = work();

        database.query("INSERT INTO mcp_operation_receipts (id,input_hash,result_json,created_at) VALUES (?,?,?,?)")
          .run(id, inputHash, JSON.stringify(result), new Date().toISOString());

        return result;
      })();
    },
  };
}
