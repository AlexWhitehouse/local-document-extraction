import { z } from "zod";
import type { LocalAuth, LocalSession } from "../localAuth";
import type { LocalWorkspaceControl } from "../localWorkspaceControl";
import { localRequestOriginFailure } from "../localRequestOrigin";
import { HttpError } from "../lib/http";
import { boundLocalApiBody } from "../localApiBodyLimit";
import { MCP_SCOPES, MCP_SCOPE_DESCRIPTIONS } from "./scopes";
import type { McpAuthorization } from "./authorization";
import { actorFor, type McpGrant } from "./grants";

const consentSchema = z.object({
  oauth_query: z.string().max(16384), accept: z.boolean(),
  workspace_id: z.string().min(1).optional(), scopes: z.array(z.enum(MCP_SCOPES)).max(MCP_SCOPES.length).optional(),
}).strict();

export function mcpClient(grant: McpGrant) {
  return { id: grant.client_id, name: grant.client_name, uri: grant.client_uri, provenance: "dynamic" as const };
}

export function assertMcpBrowserSession(session: LocalSession): void {
  if (session.impersonatedBy) throw new HttpError(403, "mcp_impersonation_not_allowed", "Stop impersonating before managing connected apps.");

  if (session.isActive && !session.isActive()) throw new HttpError(401, "unauthorized", "Sign in again to continue.");
}

export function createMcpManagement(input: {
  auth: LocalAuth; authorization: McpAuthorization; workspaceControl: LocalWorkspaceControl;
  handleAction?: (request: Request, session: LocalSession) => Promise<Response | null>;
}) {
  const { auth, authorization, workspaceControl } = input;

  return async (request: Request): Promise<Response> => {
    try {
      const session = await auth.getSession(request);

      if (!session) throw new HttpError(401, "unauthorized", "Sign in to manage connected apps.");
      const path = new URL(request.url).pathname;

      if (!["GET", "HEAD"].includes(request.method)) {
        const originFailure = localRequestOriginFailure(request, auth);

        if (originFailure) return originFailure;
        assertMcpBrowserSession(session);
      }

      if (path === "/v1/mcp/connections" && request.method === "GET") {
        return Response.json({
          enabled: authorization.configuration.enabled, mcp_url: authorization.resource, scopes: MCP_SCOPE_DESCRIPTIONS,
          connections: authorization.grants.list(session.id).map((grant) => {
            const workspace = workspaceControl.getAcceptedWorkspaceContext({ userId: session.id, workspaceId: grant.workspace_id });

            return { id: grant.id, client: mcpClient(grant),
              workspace: { id: grant.workspace_id, name: workspace?.name ?? "Unavailable workspace", accessible: Boolean(workspace) },
              scopes: grant.scopes, created_at: grant.created_at, last_used_at: grant.last_used_at, revoked_at: grant.revoked_at };
          }),
        });
      }

      const connectionMatch = /^\/v1\/mcp\/connections\/([^/]+)$/.exec(path);

      if (connectionMatch && request.method === "DELETE") {
        authorization.grants.revoke(decodeURIComponent(connectionMatch[1]!), session.id);

        return Response.json({ ok: true });
      }

      if (!authorization.configuration.enabled) throw new HttpError(503, "mcp_disabled", "Connected apps are turned off for this installation.");

      if (path === "/v1/mcp/consent" && request.method === "GET") {
        const oauthQuery = new URL(request.url).searchParams.get("oauth_query") ?? "";
        const info = await authorization.consentInfo(oauthQuery);
        const query = new URLSearchParams(oauthQuery);

        const loginRequired = (query.get("prompt") ?? "").split(" ").includes("login") &&
          (!session.createdAt || session.createdAt < Number(query.get("ba_iat")));

        return Response.json({ client: info.client, requested_scopes: info.requestedScopes,
          scopes: MCP_SCOPE_DESCRIPTIONS.filter((scope) => info.requestedScopes.includes(scope.id)),
          expires_at: info.expiresAt, login_required: loginRequired,
          workspaces: workspaceControl.listAcceptedWorkspaces({ userId: session.id }).map(({ id, name, role }) => ({ id, name, role })),
        });
      }

      if (path === "/v1/mcp/consent" && request.method === "POST") {
        const bounded = await boundLocalApiBody(request, 32768);
        const parsed = consentSchema.safeParse(await bounded.json());

        if (!parsed.success) throw new HttpError(400, "mcp_scope_invalid", "Choose a workspace and valid permissions.");
        const body = parsed.data;
        const info = await authorization.consentInfo(body.oauth_query);

        if (!body.accept) return Response.json({ redirect_uri: await authorization.consent({ request, oauthQuery: body.oauth_query, accept: false }) });

        if (!body.workspace_id || !body.scopes?.includes("workspace:read") || !body.scopes.every((scope) => info.requestedScopes.includes(scope))) {
          throw new HttpError(400, "mcp_scope_invalid", "Choose a workspace and requested permissions.");
        }

        const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId: body.workspace_id, userId: session.id });

        if (!workspace) throw new HttpError(403, "mcp_workspace_unavailable", "You no longer have access to this workspace.");
        assertMcpBrowserSession(session);

        const grant = authorization.grants.create({ userId: session.id, sessionId: session.sessionId!, clientId: info.client.id,
          clientName: info.client.name, clientUri: info.client.uri, workspaceId: workspace.id,
          scopes: body.scopes, oauthQuery: body.oauth_query });

        try {
          const redirectUri = await authorization.consent({ request, oauthQuery: body.oauth_query, accept: true, grantId: grant.id, scopes: body.scopes });
          const redirect = new URL(redirectUri, authorization.resource);

          // A stale login prompt may send the browser back to sign-in instead of
          // returning a code. It must not leave behind a usable connection.
          if (!redirect.searchParams.has("code")) authorization.grants.revoke(grant.id, session.id);
          else authorization.grants.audit({ actor: actorFor(grant), action: "connection.create", requestId: grant.id, outcome: "completed" });

          return Response.json({ redirect_uri: redirectUri });
        } catch (error) {
          authorization.grants.revoke(grant.id, session.id);
          throw error;
        }
      }

      const action = await input.handleAction?.(request, session);

      if (action) return action;
      throw new HttpError(404, "not_found", "Page not found.");
    } catch (error) {
      if (error instanceof HttpError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });

      return Response.json({ error: { code: "mcp_request_failed", message: "The request could not be completed. Try again." } }, { status: 400 });
    }
  };
}
