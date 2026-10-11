import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mcp, type McpOptions, type requireMcpAuth } from "@better-auth/mcp";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import type { Database } from "bun:sqlite";
import { z } from "zod";
import { HttpError } from "../lib/http";
import { createMcpGrantStore, actorFor, type DelegatedActor, type McpGrantStore } from "./grants";
import { MCP_SCOPES, type McpScope } from "./scopes";

import { isSecureMcpUrl, validateMcpConfiguration, type McpConfiguration } from "./configuration";

export type { McpConfiguration } from "./configuration";

export type McpClient = { id: string; name: string; uri: string | null; provenance: "dynamic" };

export type McpAuthorization = {
  configuration: McpConfiguration;
  resource: string;
  grants: McpGrantStore;
  database: Database;
  consentInfo(oauthQuery: string): Promise<{ client: McpClient; requestedScopes: McpScope[]; expiresAt: string }>;
  consent(input: { request: Request; oauthQuery: string; accept: boolean; grantId?: string; scopes?: McpScope[] }): Promise<string>;
  protect(request: Request, handler: (request: Request, actor: DelegatedActor) => Promise<Response>): Promise<Response>;
};

const clientSchema = z.object({ client_id: z.string(), client_name: z.string().nullish(), client_uri: z.string().nullish() });

const tokenClaimsSchema = z.object({ sub: z.string(), client_id: z.string(), grant_id: z.string(), scope: z.string() });

const registrationSchema = z.object({ redirect_uris: z.array(z.string().refine(isSecureMcpUrl)).min(1).max(8) });

type PublicOAuthClient = z.infer<typeof clientSchema>;

type VerifiedMcpClaims = Parameters<Parameters<typeof requireMcpAuth>[1]>[1];

export function createMcpProviderPolicy(input: { database: Database; secret: string; baseURL: string; configuration: McpConfiguration; requireEmailVerification?: boolean }) {
  const { database, secret, configuration } = input;
  const origin = new URL(input.baseURL);

  validateMcpConfiguration(input.baseURL, configuration);
  const resource = `${origin.origin}/mcp`;
  const grants = createMcpGrantStore(database, input.requireEmailVerification);
  const consentContext = new AsyncLocalStorage<string>();

  const options: McpOptions = {
    resource,
    loginPage: "/mcp/connect",
    consentPage: "/mcp/connect",
    scopes: MCP_SCOPES,
    grantTypes: ["authorization_code", "refresh_token"],
    accessTokenExpiresIn: 300,
    refreshTokenExpiresIn: 30 * 86400,
    refreshTokenReuseInterval: 0,
    // The provider also uses this lifetime for signed login/consent queries.
    codeExpiresIn: 600,
    allowDynamicClientRegistration: configuration.enabled,
    allowUnauthenticatedClientRegistration: configuration.enabled,
    clientPrivileges: () => false,
    resourcePrivileges: () => false,
    validateRedirectUri: (uri, registered) => registered.includes(uri),
    postLogin: {
      page: "/mcp/connect",
      shouldRedirect: () => false,
      // Every new authorization requires fresh Workspace consent. Only our
      // authenticated consent endpoint supplies a persisted grant reference.
      consentReferenceId: ({ session }) => {
        if (session.impersonatedBy) throw new APIError("FORBIDDEN", { message: "Impersonated sessions cannot connect apps." });

        return consentContext.getStore() ?? randomUUID();
      },
    },
    customAccessTokenClaims: ({ referenceId, user }) => {
      if (!referenceId || !user) throw new APIError("FORBIDDEN", { message: "An active connection is required." });

      try {
        const grant = grants.active(referenceId);

        if (grant.user_id !== user.id) throw new Error("Grant user mismatch");

        return { grant_id: grant.id };
      } catch {
        throw new APIError("FORBIDDEN", { message: "This connection is no longer active." });
      }
    },
  };

  return {
    plugin: mcp(options), grants, resource, consentContext,
    async consentInfo(oauthQuery: string, publicClient: (clientId: string) => Promise<PublicOAuthClient>) {
      if (oauthQuery.length > 16_384 || !(await verifyOAuthQueryParams(oauthQuery, secret))) {
        throw new HttpError(400, "mcp_authorization_expired", "This connection request is invalid or expired. Connect the app again.");
      }

      const query = new URLSearchParams(oauthQuery);
      const clientId = query.get("client_id");
      const resources = query.getAll("resource");

      if (!clientId || resources.length !== 1 || resources[0] !== resource) {
        throw new HttpError(400, "mcp_invalid_resource", "The app must request this installation's MCP address.");
      }

      const client = clientSchema.parse(await publicClient(clientId));
      const scopes = z.array(z.enum(MCP_SCOPES)).parse((query.get("scope") ?? "").split(" ").filter(Boolean));

      if (!scopes.includes("workspace:read")) throw new HttpError(400, "mcp_scope_required", "The app must request workspace:read.");

      return {
        client: { id: client.client_id, name: client.client_name ?? "Connected app", uri: client.client_uri ?? null, provenance: "dynamic" as const },
        requestedScopes: scopes,
        expiresAt: new Date(Number(query.get("exp")) * 1000).toISOString(),
      };
    },
    actor(claims: VerifiedMcpClaims): DelegatedActor {
      const parsed = tokenClaimsSchema.safeParse(claims);

      if (!parsed.success) throw new HttpError(403, "mcp_invalid_grant", "The token is not bound to a connection.");
      const grant = grants.active(parsed.data.grant_id);

      if (grant.user_id !== parsed.data.sub || grant.client_id !== parsed.data.client_id) {
        throw new HttpError(403, "mcp_invalid_grant", "The token does not belong to this connection.");
      }

      return actorFor(grant, parsed.data.scope.split(" "));
    },
    async guardAuthRequest(request: Request): Promise<Response | null> {
      const path = new URL(request.url).pathname;

      if (!configuration.enabled && (path.includes("/oauth2/") || path.includes("/.well-known/"))) {
        return Response.json({ error: "mcp_disabled" }, { status: 404 });
      }

      if (["/oauth2/consent", "/oauth2/update-consent", "/oauth2/delete-consent"].some((suffix) => path.endsWith(suffix))) {
        return Response.json({ error: "access_denied", error_description: "Use the application consent screen." }, { status: 403 });
      }

      if (path.endsWith("/oauth2/register") && request.method === "POST") {
        const body = registrationSchema.safeParse(await request.clone().json().catch(() => null));
        const count = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM oauthClient").get()?.count ?? 0;

        if (!body.success || count >= 1000) {
          return Response.json({ error: "invalid_redirect_uri", error_description: "Client registration is not allowed for this callback." }, { status: 400 });
        }
      }

      return null;
    },
  };
}
