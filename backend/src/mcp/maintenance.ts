import type { McpAuthorization } from "./authorization";
import type { McpUploadStore } from "./uploads";

/** Bounded, request-triggered cleanup; no background timer outlives runtime drain. */
export function createMcpMaintenance(authorization: McpAuthorization, uploads: McpUploadStore) {
  let nextRun = 0;
  let running: Promise<void> | null = null;

  return async () => {
    if (running) return running;

    if (Date.now() < nextRun) return;
    nextRun = Date.now() + 60_000;
    running = (async () => {
      const { database, grants } = authorization;
      const now = new Date().toISOString();

      for (const grant of database.query<{ id: string; user_id: string }, [string]>(
        "SELECT id,user_id FROM mcp_grants WHERE revoked_at IS NULL AND expires_at <= ? LIMIT 100",
      ).all(now)) grants.revoke(grant.id, grant.user_id);
      await uploads.sweep();
      const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString();
      database.transaction(() => {
        database.query("DELETE FROM mcp_security_activity WHERE created_at < ?").run(cutoff);
        database.query("DELETE FROM mcp_operations WHERE created_at < ? OR grant_id NOT IN (SELECT id FROM mcp_grants)").run(cutoff);
        database.query("DELETE FROM mcp_grants WHERE expires_at < ?").run(cutoff);
        // Tokens/codes are provider-owned. Expired rows cannot authorize access;
        // these tables use millisecond timestamps under the SQLite adapter.
        database.query('DELETE FROM oauthAccessToken WHERE expiresAt < ?').run(Date.now());
        database.query('DELETE FROM oauthRefreshToken WHERE expiresAt < ?').run(Date.now());
      })();
    })();

    try { await running; } finally { running = null; }
  };
}
