import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { HttpError } from "../lib/http";
import type { LocalWorkspaceControl, LocalWorkspace } from "../localWorkspaceControl";
import { MCP_SCOPES, type McpScope } from "./scopes";

const scopesSchema = z.array(z.enum(MCP_SCOPES));

type GrantRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  client_id: string;
  client_name: string;
  client_uri: string | null;
  workspace_id: string;
  scopes_json: string;
  query_hash: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};

export type McpGrant = Omit<GrantRow, "scopes_json" | "query_hash"> & { scopes: McpScope[] };

export type DelegatedActor = {
  kind: "delegated";
  userId: string;
  clientId: string;
  grantId: string;
  workspaceId: string;
  scopes: readonly string[];
};

export type McpGrantStore = ReturnType<typeof createMcpGrantStore>;

function readGrant(row: GrantRow): McpGrant {
  const { scopes_json, query_hash: _query, ...grant } = row;

  return { ...grant, scopes: scopesSchema.parse(JSON.parse(scopes_json)) };
}

export function createMcpGrantStore(database: Database, requireEmailVerification = false) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mcp_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      session_id TEXT, client_id TEXT NOT NULL, client_name TEXT NOT NULL, client_uri TEXT,
      workspace_id TEXT NOT NULL, scopes_json TEXT NOT NULL, query_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, last_used_at TEXT, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS mcp_grants_user ON mcp_grants(user_id);
    CREATE TABLE IF NOT EXISTS mcp_security_activity (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, grant_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, request_id TEXT NOT NULL,
      approval_id TEXT, outcome TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mcp_activity_time ON mcp_security_activity(created_at);
  `);

  if (!database.query<{ name: string }, []>("PRAGMA table_info(mcp_grants)").all().some((column) => column.name === "session_id")) {
    database.exec("ALTER TABLE mcp_grants ADD COLUMN session_id TEXT");
  }

  function get(id: string): McpGrant | null {
    const row = database.query<GrantRow, [string]>("SELECT * FROM mcp_grants WHERE id = ?").get(id);

    return row ? readGrant(row) : null;
  }

  function assertEligibleUser(userId: string): void {
    const user = database.query<{ banned: number | null; banExpires: number | null; emailVerified: number }, [string]>(
      "SELECT banned, banExpires, emailVerified FROM user WHERE id = ?",
    ).get(userId);

    if (!user || (requireEmailVerification && !user.emailVerified) || (user.banned && (!user.banExpires || user.banExpires > Date.now()))) {
      throw new HttpError(403, "mcp_account_unavailable", "This account cannot use connected apps.");
    }
  }

  function active(id: string): McpGrant {
    const grant = get(id);

    if (!grant || grant.revoked_at || grant.expires_at <= new Date().toISOString()) {
      throw new HttpError(403, "mcp_connection_revoked", "This connection has expired or been revoked. Connect the app again.");
    }

    assertEligibleUser(grant.user_id);
    const client = database.query<{ disabled: number | null }, [string]>("SELECT disabled FROM oauthClient WHERE clientId = ?").get(grant.client_id);

    if (!client || client.disabled) throw new HttpError(403, "mcp_connection_revoked", "This app is no longer available.");

    if (!grant.scopes.includes("offline_access") && !database.query(
      "SELECT 1 FROM session WHERE id = ? AND userId = ? AND expiresAt > ?",
    ).get(grant.session_id, grant.user_id, Date.now())) {
      throw new HttpError(403, "mcp_connection_revoked", "The authorizing browser session ended. Connect the app again.");
    }

    return grant;
  }

  function authorize(actor: DelegatedActor, control: LocalWorkspaceControl, scope: McpScope): LocalWorkspace {
    const grant = active(actor.grantId);

    if (grant.user_id !== actor.userId || grant.client_id !== actor.clientId || grant.workspace_id !== actor.workspaceId) {
      throw new HttpError(403, "mcp_grant_mismatch", "This connection does not permit that workspace.");
    }

    const workspace = control.getAcceptedWorkspaceContext({ workspaceId: grant.workspace_id, userId: grant.user_id });

    if (!workspace) throw new HttpError(403, "mcp_workspace_unavailable", "You no longer have access to this workspace.");

    if (!actor.scopes.includes(scope) || !grant.scopes.includes(scope)) {
      throw new HttpError(403, "mcp_scope_required", "This connection does not permit that action.");
    }

    return workspace;
  }

  function audit(input: {
    actor: DelegatedActor; action: string; requestId: string; outcome: string;
    targetId?: string; approvalId?: string;
  }): void {
    database.query(`INSERT INTO mcp_security_activity
      (id,user_id,client_id,grant_id,workspace_id,action,target_id,request_id,approval_id,outcome,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      randomUUID(), input.actor.userId, input.actor.clientId, input.actor.grantId, input.actor.workspaceId,
      input.action, input.targetId ?? null, input.requestId, input.approvalId ?? null, input.outcome, new Date().toISOString(),
    );
  }

  function revoke(id: string, userId: string): void {
    database.transaction(() => {
      const grant = get(id);

      if (!grant || grant.user_id !== userId) throw new HttpError(404, "mcp_connection_not_found", "Connection not found.");

      database.query("UPDATE mcp_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
        .run(new Date().toISOString(), id);
      // Provider records carry the immutable grant ID as their consent reference.
      database.query('DELETE FROM oauthRefreshToken WHERE referenceId = ?').run(id);
      database.query('DELETE FROM oauthAccessToken WHERE referenceId = ?').run(id);
      database.query('DELETE FROM oauthConsent WHERE referenceId = ?').run(id);
      audit({ actor: actorFor(grant), action: "connection.revoke", requestId: randomUUID(), outcome: "completed" });
    })();
  }

  return {
    get, active, authorize, audit, revoke, assertEligibleUser,
    create(input: {
      userId: string; sessionId: string; clientId: string; clientName: string; clientUri: string | null;
      workspaceId: string; scopes: McpScope[]; oauthQuery: string;
    }): McpGrant {
      assertEligibleUser(input.userId);

      const activeCount = database.query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) AS count FROM mcp_grants WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?",
      ).get(input.userId, new Date().toISOString())?.count ?? 0;

      if (activeCount >= 100) throw new HttpError(429, "mcp_connection_limit", "Disconnect an unused app before adding another connection.");

      const id = randomUUID();
      const now = new Date().toISOString();
      const queryHash = createHash("sha256").update(input.oauthQuery).digest("hex");

      if (database.query("SELECT 1 FROM mcp_grants WHERE query_hash = ?").get(queryHash)) {
        throw new HttpError(409, "mcp_consent_consumed", "This request was already used. Connect the app again.");
      }

      database.query(`INSERT INTO mcp_grants
        (id,user_id,session_id,client_id,client_name,client_uri,workspace_id,scopes_json,query_hash,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, input.userId, input.sessionId, input.clientId, input.clientName, input.clientUri, input.workspaceId,
        JSON.stringify(input.scopes), queryHash, now, new Date(Date.now() + 30 * 86400_000).toISOString(),
      );

      return active(id);
    },
    list(userId: string): McpGrant[] {
      return database.query<GrantRow, [string]>("SELECT * FROM mcp_grants WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100")
        .all(userId).map(readGrant);
    },
    touch(id: string): void {
      database.query("UPDATE mcp_grants SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    },
    revokeUser(userId: string): void {
      for (const grant of database.query<GrantRow, [string]>("SELECT * FROM mcp_grants WHERE user_id = ? AND revoked_at IS NULL").all(userId)) {
        revoke(grant.id, userId);
      }
    },
  };
}

export function actorFor(grant: McpGrant, tokenScopes: readonly string[] = grant.scopes): DelegatedActor {
  return { kind: "delegated", userId: grant.user_id, clientId: grant.client_id,
    grantId: grant.id, workspaceId: grant.workspace_id, scopes: tokenScopes };
}
