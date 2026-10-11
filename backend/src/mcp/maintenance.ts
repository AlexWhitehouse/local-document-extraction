import type { Database } from "bun:sqlite";
import type { McpAuthorization } from "./authorization";
import type { McpUploadStore } from "./uploads";

/** Removes up to 200 dynamically registered clients older than a day that nothing references.
 * A client with any grant row (even revoked), token or consent is kept. Better Auth stores
 * dates as ISO text, so cutoffs are bound as ISO strings. */
export function pruneUnusedMcpClients(database: Database, now = Date.now()): void {
  database.query(`DELETE FROM oauthClient WHERE id IN (SELECT c.id FROM oauthClient c
    WHERE c.createdAt < ?
      AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.clientId)
      AND NOT EXISTS (SELECT 1 FROM oauthAccessToken t WHERE t.clientId = c.clientId)
      AND NOT EXISTS (SELECT 1 FROM oauthRefreshToken t WHERE t.clientId = c.clientId)
      AND NOT EXISTS (SELECT 1 FROM oauthConsent t WHERE t.clientId = c.clientId)
    ORDER BY c.createdAt LIMIT 200)`).run(new Date(now - 86400_000).toISOString());
}

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
        // Tokens are provider-owned and stored as ISO text; expired rows cannot authorize access.
        database.query("DELETE FROM oauthAccessToken WHERE expiresAt < ?").run(now);
        database.query("DELETE FROM oauthRefreshToken WHERE expiresAt < ?").run(now);
        pruneUnusedMcpClients(database);
      })();
    })();

    try { await running; } finally { running = null; }
  };
}
