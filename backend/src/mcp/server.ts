import { randomUUID } from "node:crypto";
import { McpServer, createMcpHandler, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isJsonObject, parseJson, type JsonObject } from "../../../shared/json";
import { HttpError } from "../lib/http";
import { boundLocalApiBody } from "../localApiBodyLimit";
import type { ProductServices } from "../localApplication";
import { publicDocumentPacket } from "../localDocumentProcessingHttp";
import { LocalWorkspaceControlError } from "../localWorkspaceControl";
import type { LocalWorkspaceProductStoreHandle } from "../localWorkspaceProductStoreRegistry";
import type { McpAuthorization } from "./authorization";
import type { DelegatedActor } from "./grants";
import { createMcpMaintenance } from "./maintenance";
import { createMcpManagement } from "./management";
import { createMcpOperationStore } from "./operations";
import type { McpScope } from "./scopes";
import { registerMcpProductTools } from "./productTools";
import { handleMcpApproval, registerMcpApprovalTools, mcpActionScope } from "./approvals";
import { actorFor } from "./grants";
import type { LocalWorkspaceDeletion } from "../localWorkspaceDeletion";
import type { LocalQueuedExtractionJob } from "../localExtractionQueue";
import type { LocalLiveUpdateHub } from "../localLiveUpdateHub";
import { createLocalSubmissionAdmission } from "../localSubmissionAdmission";
import { createMcpUploadStore, handleMcpUpload, handleMcpSource, registerMcpUploadTools } from "./uploads";

const id = z.string().min(1).max(200);

const paging = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(25) };

const cursorSchema = z.object({ createdAt: z.string(), jobId: z.string() });

export type McpToolContext = {
  requiredScopes: Map<string, McpScope>;
  signal: AbortSignal;
  runtime: McpRuntimeServices;
  actor: DelegatedActor;
  authorization: McpAuthorization;
  product: ProductServices;
  operations: ReturnType<typeof createMcpOperationStore>;
  assert(scope: McpScope): void;
  withStore<T>(scope: McpScope, work: (store: LocalWorkspaceProductStoreHandle) => T | Promise<T>): Promise<T>;
  url(path: string): string;
};

export type McpRuntimeServices = {
  workspaceDeletion?: LocalWorkspaceDeletion | null;
  maxSourceFileBytes: number;
  modelGatewayRequestTimeoutMs: string;
  scheduleQueuedJob: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  liveUpdateHub?: LocalLiveUpdateHub;
  onWorkspaceModelConfigurationChanged?: (workspaceId: string) => void;
  admission: Pick<ReturnType<typeof createLocalSubmissionAdmission>, "run">;
};

function result(output: JsonObject): CallToolResult {
  const text = JSON.stringify(output);

  if (Buffer.byteLength(text) > 256 * 1024) throw new HttpError(413, "mcp_result_too_large", "The result is too large. Request fewer records or open it in the application.");

  return { content: [{ type: "text", text }], structuredContent: output };
}

export function toolResult<T extends object>(value: T): JsonObject {
  const valueJson = parseJson(JSON.stringify(value));

  if (!isJsonObject(valueJson)) throw new Error("MCP tools must return an object");

  return valueJson;
}

export function registerMcpTool<Fields extends Record<string, z.ZodType>>(
  server: McpServer, context: McpToolContext, name: string, scope: McpScope,
  description: string, schema: z.ZodObject<Fields>,
  work: (input: z.output<z.ZodObject<Fields>>) => Promise<JsonObject> | JsonObject,
  mutation = false,
) {
  context.requiredScopes.set(name, scope);

  if (!context.actor.scopes.includes(scope) || !context.authorization.grants.active(context.actor.grantId).scopes.includes(scope)) return;

  server.registerTool(name, { description, inputSchema: schema,
    annotations: { readOnlyHint: !mutation, destructiveHint: mutation, idempotentHint: !mutation, openWorldHint: false },
  }, async (input) => {
    const requestId = randomUUID();
    const startedAt = performance.now();

    try {
      context.assert(scope);
      context.authorization.grants.audit({ actor: context.actor, action: name, requestId, outcome: "started" });

      const output = await work(input);

      // Revocation during an awaited read must also prevent delivery of data.
      context.assert(scope);
      context.authorization.grants.audit({ actor: context.actor, action: name, requestId, outcome: "completed" });
      context.authorization.grants.touch(context.actor.grantId);

      return result({ ...output, duration_ms: Math.round(performance.now() - startedAt) });
    } catch (error) {
      const code = error instanceof HttpError ? error.code : error instanceof LocalWorkspaceControlError ? error.code : "mcp_operation_failed";
      context.authorization.grants.audit({ actor: context.actor, action: name, requestId, outcome: code });

      return { ...result({ error: { code, message: error instanceof HttpError || error instanceof LocalWorkspaceControlError ? error.message : "The action could not be completed. Try again." } }), isError: true };
    }
  });
}

export function createMcpApplication(input: { product: ProductServices; authorization: McpAuthorization; runtime: McpRuntimeServices }) {
  const { product, authorization } = input;
  const operations = createMcpOperationStore(authorization.database);
  const uploads = createMcpUploadStore(authorization.database, product.stateDirectory);
  const maintain = createMcpMaintenance(authorization, uploads);

  function contextFor(actor: DelegatedActor, signal: AbortSignal): McpToolContext {
    return {
      actor, product, authorization, operations, signal, runtime: input.runtime, requiredScopes: new Map(),
      assert: (scope) => { authorization.grants.authorize(actor, product.workspaceControl, scope); },
      withStore: (scope, work) => product.access.run({ workspaceId: actor.workspaceId, mode: "create" }, ({ store }) => {
        authorization.grants.authorize(actor, product.workspaceControl, scope);

        return work(store);
      }),
      url: (path) => new URL(path, authorization.resource).href,
    };
  }

  const management = createMcpManagement({ auth: product.auth, authorization, workspaceControl: product.workspaceControl,
    handleAction: async (request, session) => (await handleMcpUpload(request, session, uploads, authorization,
      (actor) => contextFor(actor, request.signal))) ?? handleMcpApproval(request, session, (operationId) => {
      const operation = operations.get(operationId);
      const grant = operation && authorization.grants.get(operation.grant_id);

      if (!grant || grant.user_id !== session.id) throw new HttpError(404, "mcp_approval_not_found", "Approval request not found.");

      return contextFor(actorFor(grant), request.signal);
    }),
  });

  const active = new Map<string, { count: number; used: number; resetAt: number }>();

  return async (request: Request): Promise<Response> => {
    await maintain();
    const path = new URL(request.url).pathname;

    if (path.startsWith("/v1/mcp/") && !path.startsWith("/v1/mcp/sources/")) {
      const response = await management(request);
      response.headers.set("cache-control", "private, no-store");

      return response;
    }

    if (!authorization.configuration.enabled) return Response.json({ error: "mcp_disabled" }, { status: 404 });

    const canonicalOrigin = new URL(authorization.resource).origin;
    const host = request.headers.get("host");
    const origin = request.headers.get("origin");

    if ((host && host !== new URL(authorization.resource).host) || (origin && origin !== canonicalOrigin)) {
      return Response.json({ error: "untrusted_origin" }, { status: 403 });
    }

    if (!path.startsWith("/v1/mcp/sources/") && request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });

    return authorization.protect(request, async (verifiedRequest, actor) => {
      authorization.grants.authorize(actor, product.workspaceControl, "workspace:read");

      const now = Date.now();

      for (const [key, bucket] of active) if (bucket.resetAt <= now && bucket.count === 0) active.delete(key);
      const key = `${actor.userId}:${actor.clientId}:${actor.workspaceId}`;
      const bucket = active.get(key) ?? { count: 0, used: 0, resetAt: now + 60_000 };

      if (bucket.count >= 4 || bucket.used >= 120 || (!active.has(key) && active.size >= 1000)) {
        return Response.json({ error: "mcp_rate_limited" }, { status: 429, headers: { "retry-after": "5" } });
      }

      active.set(key, bucket);
      bucket.count++;
      bucket.used++;

      let streamed = false;
      const signal = AbortSignal.any([verifiedRequest.signal, AbortSignal.timeout(360_000)]);
      verifiedRequest = new Request(verifiedRequest, { signal });

      const finish = (response: Response) => {
        streamed = true;

        return retainResponseSlot(response, signal, () => { bucket.count--; });
      };

      try {
        if (path.startsWith("/v1/mcp/sources/")) return finish(await handleMcpSource(verifiedRequest, contextFor(actor, signal)));
        const bounded = await boundLocalApiBody(verifiedRequest, 256 * 1024);
        const context = contextFor(actor, verifiedRequest.signal);

        const server = new McpServer({ name: "document-extraction", version: "1.0.0" });
        registerReadTools(server, context);
        registerMcpProductTools(server, context);
        registerMcpApprovalTools(server, context);
        registerMcpUploadTools(server, context, uploads);

        const call = await bounded.clone().json().catch(() => null);
        const streamingMethod = z.object({ method: z.string(), id: z.union([z.string(), z.number()]).optional() }).safeParse(call);

        if (streamingMethod.success && /^(subscriptions|tasks)\//.test(streamingMethod.data.method)) {
          await server.close();

          return Response.json({ jsonrpc: "2.0", id: streamingMethod.data.id ?? null, error: { code: -32601, message: "This installation supports request-scoped tools only." } });
        }

        const parsedCall = z.object({ method: z.literal("tools/call"), params: z.object({ name: z.string(), arguments: z.record(z.string(), z.json()).optional() }) }).safeParse(call);
        const needed: McpScope[] = [];

        if (parsedCall.success) {
          const { name, arguments: args } = parsedCall.data.params;
          const scope = context.requiredScopes.get(name);

          if (scope) needed.push(scope);

          if (name === "request_action_approval" && args && isJsonObject(args.request)) {
            const actionScope = mcpActionScope(args.request);

            if (actionScope) needed.push(actionScope);
          }

          if (name === "assist_template" && args && isJsonObject(args.payload)) {
            if (args.payload.jobId) needed.push("documents:read");

            if (args.payload.useRetainedSource) needed.push("sources:read");
          }
        }

        const grant = authorization.grants.active(actor.grantId);
        const missing = needed.filter((scope) => !actor.scopes.includes(scope) || !grant.scopes.includes(scope));

        if (missing.length) {
          await server.close();

          return Response.json({ error: "insufficient_scope" }, { status: 403, headers: {
            "www-authenticate": `Bearer error="insufficient_scope", scope="${missing.join(" ")}", resource_metadata="${canonicalOrigin}/.well-known/oauth-protected-resource/mcp"`,
          } });
        }

        const handler = createMcpHandler(() => server, { legacy: "stateless", responseMode: "auto" });

        return finish(await handler.fetch(bounded, { authInfo: {
          token: verifiedRequest.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "",
          clientId: actor.clientId, scopes: [...actor.scopes], resource: new URL(authorization.resource),
        } }));
      } finally {
        if (!streamed) bucket.count--;
      }
    });
  };
}

/** A stateless legacy response may stream before the tool finishes. Keep its
 * concurrency reservation until completion, cancellation or the request deadline. */
function retainResponseSlot(response: Response, signal: AbortSignal, release: () => void): Response {
  if (!response.body) { release();

 return response; }

  const reader = response.body.getReader();
  let released = false;

  const finish = () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", cancel);
    release();
  };

  const cancel = () => { void reader.cancel().catch(() => {}).finally(finish); };

  signal.addEventListener("abort", cancel, { once: true });

  if (signal.aborted) cancel();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();

        if (next.done) { finish(); controller.close(); }
        else controller.enqueue(next.value);
      } catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } },
  });

  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");

  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function registerReadTools(server: McpServer, context: McpToolContext) {
  const { actor, authorization, product, withStore, url } = context;

  registerMcpTool(server, context, "workspace_context", "workspace:read", "Read the one consented workspace and current role and permissions. Does not list unrelated workspaces.", z.object({}).strict(), () => {
    const workspace = authorization.grants.authorize(actor, product.workspaceControl, "workspace:read");

    return { workspace: { id: workspace.id, name: workspace.name, role: workspace.role },
      scopes: actor.scopes.filter((scope) => authorization.grants.active(actor.grantId).scopes.some((item) => item === scope)),
      url: url(`/workspaces/${workspace.id}`) };
  });

  registerMcpTool(server, context, "list_documents", "documents:read", "List a bounded page of documents. Use next_cursor for the next page; poll queued work no more often than every two seconds.", z.object({ ...paging, search: z.string().max(200).optional() }).strict(), (args) => withStore("documents:read", (store) => {
    const cursor = args.cursor ? cursorSchema.parse(parseJson(Buffer.from(args.cursor, "base64url").toString())) : null;
    const rows = store.listExtractionJobs({ cursor, search: args.search, limit: args.limit + 1 });
    const more = rows.length > args.limit;
    const documents = rows.slice(0, args.limit);
    const last = documents.at(-1);

    return toolResult({ documents, next_cursor: more && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, jobId: last.job_id })).toString("base64url") : null });
  }));

  registerMcpTool(server, context, "get_document", "documents:read", "Read one document's status and bounded extracted answers. Existing work continues after a client disconnects. Poll after at least two seconds.", z.object({ document_id: id }).strict(), ({ document_id }) => withStore("documents:read", (store) => {
    const document = store.getExtractionJob(document_id);

    if (!document) throw new HttpError(404, "not_found", "Document not found.");

    return toolResult({ document, poll_after_seconds: 2, url: url(`/workspaces/${actor.workspaceId}/documents/${document_id}`) });
  }));

  registerMcpTool(server, context, "get_packet", "documents:read", "Read a document packet's status, assigned pages and split plan. Internal file identifiers and model credentials are excluded.", z.object({ packet_id: id }).strict(), ({ packet_id }) => withStore("documents:read", (store) => {
    const packet = store.getDocumentPacket(packet_id);

    if (!packet) throw new HttpError(404, "not_found", "Document packet not found.");

    return toolResult({ packet: publicDocumentPacket(packet), url: url(`/workspaces/${actor.workspaceId}/packets/${packet_id}`) });
  }));

  registerMcpTool(server, context, "list_templates", "templates:read", "List templates in the consented workspace, up to 50 per page.", z.object({ offset: z.number().int().min(0).default(0), limit: paging.limit }).strict(), ({ offset, limit }) => withStore("templates:read", (store) => {
    const rows = store.listTemplates();

    return toolResult({ templates: rows.slice(offset, offset + limit), next_offset: rows.length > offset + limit ? offset + limit : null });
  }));

  registerMcpTool(server, context, "get_template", "templates:read", "Read a template and its fields, optionally at a historical version.", z.object({ template_id: id, version: z.number().int().positive().optional() }).strict(), ({ template_id, version }) => withStore("templates:read", (store) => {
    const template = store.getTemplate(template_id, version);

    if (!template) throw new HttpError(404, "not_found", "Template not found.");

    return toolResult({ template, url: url(`/workspaces/${actor.workspaceId}/templates/${template_id}`) });
  }));

  registerMcpTool(server, context, "list_template_tags", "templates:read", "Read a bounded page of workspace template tags.", z.object({ offset: z.number().int().min(0).default(0) }).strict(), ({ offset }) => withStore("templates:read", (store) => toolResult({ tags: store.listTemplateTags().slice(offset, offset + 50) })));

  registerMcpTool(server, context, "list_members", "workspace:members", "Read workspace members when your current owner or admin role permits it.", z.object({ offset: z.number().int().min(0).default(0), limit: paging.limit }).strict(), ({ offset, limit }) => {
    const members = product.workspaceControl.listWorkspaceUsers({ workspaceId: actor.workspaceId, userId: actor.userId });

    return toolResult({ members: members.slice(offset, offset + limit), next_offset: members.length > offset + limit ? offset + limit : null });
  });

  registerMcpTool(server, context, "list_invitations", "workspace:invitations", "Read pending workspace invitations when your current owner or admin role permits it.", z.object({ offset: z.number().int().min(0).default(0), limit: paging.limit }).strict(), ({ offset, limit }) => {
    const invitations = product.workspaceControl.listWorkspaceInvitations({ workspaceId: actor.workspaceId, userId: actor.userId });

    return toolResult({ invitations: invitations.slice(offset, offset + limit), next_offset: invitations.length > offset + limit ? offset + limit : null });
  });
}
