import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { parseLocalMultipartSubmission } from "../localMultipartSubmission";
import { countLocalSourceFilePages, handleLocalDocumentSubmission, handleTemplateGeneration, handleRetainedSourceFileRead } from "../localApplication";
import { handleTemplateAssistance } from "../localTemplateAssistance";
import { HttpError } from "../lib/http";
import type { LocalSession } from "../localAuth";
import type { McpAuthorization } from "./authorization";
import type { DelegatedActor } from "./grants";
import { actorFor } from "./grants";
import { mcpClient, assertMcpBrowserSession } from "./management";
import { approvalResponse } from "./approvals";
import { registerMcpTool, type McpToolContext } from "./server";
import { findMcpSubmissionResult } from "./operations";

type Upload = {
  id: string; grant_id: string; workspace_id: string; scope: "documents:submit" | "templates:write";
  status: "pending" | "uploading" | "uploaded" | "consumed"; name: string | null; mime_type: string | null;
  size: number | null; expires_at: string; operation_id: string | null;
};

export type McpUploadStore = ReturnType<typeof createMcpUploadStore>;

export function createMcpUploadStore(database: Database, stateDirectory: string) {
  const directory = join(stateDirectory, "temporary", "mcp-uploads");
  database.exec(`CREATE TABLE IF NOT EXISTS mcp_uploads (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, workspace_id TEXT NOT NULL, scope TEXT NOT NULL,
    status TEXT NOT NULL, name TEXT, mime_type TEXT, size INTEGER, expires_at TEXT NOT NULL, operation_id TEXT
  );`);

  function get(id: string): Upload | null {
    return database.query<Upload, [string]>("SELECT * FROM mcp_uploads WHERE id = ?").get(id);
  }

  function path(upload: Upload): string { return join(directory, `${upload.id}.source`); }

  async function sweep(): Promise<void> {
    const expired = database.query<Upload, [string]>(`SELECT u.* FROM mcp_uploads u LEFT JOIN mcp_grants g ON g.id=u.grant_id
      WHERE u.expires_at <= ? OR g.id IS NULL OR g.revoked_at IS NOT NULL LIMIT 100`).all(new Date().toISOString());

    for (const upload of expired) {
      await rm(path(upload), { force: true });
      database.query("DELETE FROM mcp_uploads WHERE id = ?").run(upload.id);
    }

    await mkdir(directory, { recursive: true, mode: 0o700 });

    for (const name of await readdir(directory)) {
      if (!name.endsWith(".upload")) continue;
      const file = join(directory, name);
      const details = await stat(file);

      if (details.mtimeMs < Date.now() - 3600_000) await rm(file, { force: true });
    }
  }

  return {
    get, path, sweep,
    create(actor: DelegatedActor, scope: Upload["scope"]): Upload {
      const count = database.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM mcp_uploads WHERE grant_id = ? AND status != 'consumed'").get(actor.grantId)?.count ?? 0;

      const globalCount = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM mcp_uploads").get()?.count ?? 0;

      if (count >= 10 || globalCount >= 500) throw new HttpError(429, "mcp_upload_limit", "Finish existing uploads before requesting another.");
      const id = randomUUID();

      database.query("INSERT INTO mcp_uploads(id,grant_id,workspace_id,scope,status,expires_at) VALUES (?,?,?,?,'pending',?)")
        .run(id, actor.grantId, actor.workspaceId, scope, new Date(Date.now() + 15 * 60_000).toISOString());
      const upload = get(id);

      if (!upload) throw new Error("Upload request was not persisted");

      return upload;
    },
    claim(id: string): boolean {
      return database.query("UPDATE mcp_uploads SET status='uploading' WHERE id=? AND status='pending' AND expires_at > ?")
        .run(id, new Date().toISOString()).changes === 1;
    },
    release(id: string): void { database.query("UPDATE mcp_uploads SET status='pending' WHERE id=? AND status='uploading'").run(id); },
    save(id: string, source: { name: string; mimeType: string; size: number }): void {
      database.query("UPDATE mcp_uploads SET status='uploaded',name=?,mime_type=?,size=? WHERE id=? AND status='uploading'")
        .run(source.name, source.mimeType, source.size, id);
    },
    consume(id: string, operationId: string): boolean {
      return database.query("UPDATE mcp_uploads SET status='consumed',operation_id=? WHERE id=? AND status='uploaded' AND expires_at>? ")
        .run(operationId, id, new Date().toISOString()).changes === 1;
    },
  };
}

function requireUpload(context: McpToolContext, uploads: McpUploadStore, id: string, scope?: Upload["scope"]): Upload {
  const upload = uploads.get(id);

  if (!upload || upload.grant_id !== context.actor.grantId || upload.workspace_id !== context.actor.workspaceId) {
    throw new HttpError(404, "mcp_upload_not_found", "Upload request not found.");
  }

  context.assert(upload.scope);

  if (scope && scope !== upload.scope) throw new HttpError(403, "mcp_upload_used", "This file belongs to a different action.");

  if (upload.expires_at <= new Date().toISOString()) throw new HttpError(410, "mcp_upload_expired", "This upload request expired. Ask the app for another.");

  return upload;
}

export async function handleMcpUpload(request: Request, session: LocalSession, uploads: McpUploadStore,
  authorization: McpAuthorization, contextFor: (actor: DelegatedActor) => McpToolContext): Promise<Response | null> {
  const match = /^\/v1\/mcp\/uploads\/([^/]+)$/.exec(new URL(request.url).pathname);

  if (!match) return null;
  const upload = uploads.get(decodeURIComponent(match[1]!));
  const grant = upload && authorization.grants.get(upload.grant_id);

  if (!upload || !grant || grant.user_id !== session.id) throw new HttpError(404, "mcp_upload_not_found", "Upload request not found.");
  const context = contextFor(actorFor(grant));
  requireUpload(context, uploads, upload.id);
  const workspace = context.product.workspaceControl.getAcceptedWorkspaceContext({ workspaceId: upload.workspace_id, userId: session.id });

  if (!workspace) throw new HttpError(403, "mcp_workspace_unavailable", "The workspace is no longer accessible.");
  const maximumBytes = workspace.max_source_file_bytes ?? context.runtime.maxSourceFileBytes;

  if (request.method === "GET") return Response.json({ id: upload.id, client: mcpClient(grant), workspace: { id: workspace.id, name: workspace.name },
    expires_at: upload.expires_at, status: upload.status === "consumed" ? "uploaded" : upload.status === "uploading" ? "pending" : upload.status,
    max_source_file_bytes: maximumBytes });

  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use GET or POST.");
  assertMcpBrowserSession(session);

  return context.runtime.admission.run(request, async () => {
    if (!uploads.claim(upload.id)) throw new HttpError(409, "mcp_upload_used", "This upload request has already been used.");
    let temporaryPath: string | null = null;

    try {
      const parsed = await parseLocalMultipartSubmission({ request, maxSourceFileBytes: maximumBytes, stateDirectory: context.product.stateDirectory, purpose: "mcp-upload" });
      temporaryPath = parsed.source.temporaryPath;
      await countLocalSourceFilePages(parsed.source.mimeType, temporaryPath, request.signal);
      assertMcpBrowserSession(session);
      requireUpload(context, uploads, upload.id);
      await rename(temporaryPath, uploads.path(upload));
      temporaryPath = null;
      requireUpload(context, uploads, upload.id);
      uploads.save(upload.id, parsed.source);

      return Response.json({ id: upload.id, status: "uploaded", source_ref: upload.id });
    } catch (error) {
      if (temporaryPath) await rm(temporaryPath, { force: true });
      await rm(uploads.path(upload), { force: true });
      uploads.release(upload.id);
      throw error;
    }
  });
}

export function registerMcpUploadTools(server: McpServer, context: McpToolContext, uploads: McpUploadStore) {
  const id = z.string().min(1).max(200);
  const operationId = z.string().min(8).max(200);

  for (const scope of ["documents:submit", "templates:write"] as const) {
    registerMcpTool(server, context, scope === "documents:submit" ? "request_document_upload" : "request_template_sample_upload", scope,
      "Create a short-lived application upload link. The user signs in and selects a PDF, PNG, JPG or WEBP. Attachments in the chat are not automatically accessible. This does not start processing.", z.object({}).strict(), async () => {
        await uploads.sweep();
        context.assert(scope);
        const upload = uploads.create(context.actor, scope);

        return { source_ref: upload.id, upload_url: context.url(`/mcp/uploads/${upload.id}`), expires_at: upload.expires_at };
      }, true);
  }

  registerMcpTool(server, context, "submit_document", "documents:submit", "Submit a file uploaded through request_document_upload. May incur model charges. Returns a durable document or packet ID promptly; poll every two seconds. Reuse operation_id on retries; disconnecting does not cancel admitted work.",
    z.object({ source_ref: id, operation_id: operationId, template_id: id.optional(), template_tags: z.array(z.string()).max(30).optional(), pages: z.array(z.number().int().positive()).max(10000).optional() }).strict(), async (args) => {
      const operation = context.operations.prepare(context.actor, "document.submit", args.operation_id, args, false);

      if (operation.status === "completed") return operation.result ?? {};

      const persisted = await context.withStore("documents:submit", (store) => findMcpSubmissionResult(store, operation.id));

      if (persisted) {
        context.operations.recover(context.actor, operation.id, persisted);

        return persisted;
      }

      const upload = requireUpload(context, uploads, args.source_ref, "documents:submit");

      if (upload.status !== "uploaded") throw new HttpError(409, "mcp_upload_used", "Finish the upload before submitting it.");
      const form = sourceForm(uploads, upload);

      if (args.template_id) form.set("template_id", args.template_id);

      if (args.template_tags) form.set("template_tags", JSON.stringify(args.template_tags));

      if (args.pages) form.set("pages", JSON.stringify(args.pages));
      const request = new Request(context.url("/v1/extract"), { method: "POST", body: form, signal: context.signal });

      const response = await context.runtime.admission.run(request, async () => {
        context.assert("documents:submit");

        if (!context.operations.claim(operation.id) || !uploads.consume(upload.id, operation.id)) throw new HttpError(409, "mcp_operation_pending", "This submission is already being processed.");

        return handleLocalDocumentSubmission({ product: delegatedProduct(context, "documents:submit"), request,
          maxSourceFileBytes: context.runtime.maxSourceFileBytes, scheduleQueuedJob: context.runtime.scheduleQueuedJob,
          liveUpdateHub: context.runtime.liveUpdateHub, submissionId: operation.id });
      });

      try {
        const output = await approvalResponse(response);
        context.operations.complete(operation.id, output);

        return { ...output, request_id: operation.id, poll_after_seconds: 2 };
      } catch (error) {
        context.operations.fail(operation.id, error instanceof HttpError ? error.code : "mcp_submission_failed");
        throw error;
      } finally {
        if (uploads.get(upload.id)?.status === "consumed") await rm(uploads.path(upload), { force: true });
      }
    }, true);

  registerMcpTool(server, context, "generate_template_draft", "templates:write", "Generate a template proposal from an uploaded sample. May incur model charges. Nothing is saved; review the proposal and use create_template or update_template explicitly.",
    z.object({ source_ref: id, instructions: z.string().max(10000).optional() }).strict(), async ({ source_ref, instructions }) => {
      const upload = requireUpload(context, uploads, source_ref, "templates:write");

      if (upload.status !== "uploaded") throw new HttpError(409, "mcp_upload_used", "Finish the sample upload first.");
      const form = sourceForm(uploads, upload);

      if (instructions) form.set("instructions", instructions);
      const request = new Request(context.url("/v1/templates/generate"), { method: "POST", body: form, signal: context.signal });

      return approvalResponse(await context.runtime.admission.run(request, () => handleTemplateGeneration({ product: delegatedProduct(context, "templates:write"), request,
        maxSourceFileBytes: context.runtime.maxSourceFileBytes, modelGatewayRequestTimeoutMs: context.runtime.modelGatewayRequestTimeoutMs })));
    }, true);

  registerMcpTool(server, context, "assist_template", "templates:write", "Request a template explanation or proposed edits. May incur model charges; it never saves. Browser evaluation state is not supported. Document evidence additionally requires documents:read; retained originals require sources:read.",
    z.object({ payload: z.record(z.string(), z.json()), source_ref: id.optional() }).strict(), async ({ payload, source_ref }) => {
      if (payload.evaluation) throw new HttpError(400, "mcp_evaluations_unsupported", "Browser evaluations are outside connected-app access.");

      if (payload.jobId) context.assert("documents:read");

      if (payload.useRetainedSource) context.assert("sources:read");
      const form = source_ref ? sourceForm(uploads, requireUpload(context, uploads, source_ref, "templates:write")) : new FormData();
      form.set("payload", JSON.stringify(payload));
      const request = new Request(context.url("/v1/templates/assist"), { method: "POST", body: form, signal: context.signal });

      const response = await approvalResponse(await context.runtime.admission.run(request, () => handleTemplateAssistance({ product: delegatedProduct(context, "templates:write"), request,
        maxSourceFileBytes: context.runtime.maxSourceFileBytes, modelGatewayRequestTimeoutMs: context.runtime.modelGatewayRequestTimeoutMs })));

      if (payload.jobId) context.assert("documents:read");

      if (payload.useRetainedSource) context.assert("sources:read");

      return response;
    }, true);

  registerMcpTool(server, context, "get_original_download", "sources:read", "Get a download URL for a retained original. Send the same MCP bearer token to this installation URL; it is checked again at download time. Derived documents contain only their assigned pages.",
    z.object({ document_id: id, packet: z.boolean().default(false) }).strict(), ({ document_id, packet }) => context.withStore("sources:read", (store) => {
      const retained = packet ? store.getDocumentPacket(document_id)?.source_retained : store.getRetainedSourceFile(document_id);

      if (!retained) throw new HttpError(404, "source_unavailable", "The original is no longer available.");

      return { download_url: context.url(`/v1/mcp/sources/${encodeURIComponent(document_id)}${packet ? "?packet=true" : ""}`), authentication: "Use the MCP bearer token", expires_with_connection: true };
    }));
}

export async function handleMcpSource(request: Request, context: McpToolContext): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/v1\/mcp\/sources\/([^/]+)$/.exec(url.pathname);

  if (!match || !["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "method_not_allowed", "Use GET or HEAD.");
  context.assert("sources:read");

  const response = await handleRetainedSourceFileRead({ product: delegatedProduct(context, "sources:read"), request,
    jobId: decodeURIComponent(match[1]!), packet: url.searchParams.get("packet") === "true" });

  try { context.assert("sources:read"); }
  catch (error) { await response.body?.cancel(); throw error; }

  return response;
}

function delegatedProduct(context: McpToolContext, scope: "documents:submit" | "templates:write" | "sources:read") {
  return { ...context.product, delegation: { actor: context.actor, grants: context.authorization.grants, scope } };
}

function sourceForm(uploads: McpUploadStore, upload: Upload): FormData {
  if (upload.status !== "uploaded" || !upload.mime_type) throw new HttpError(409, "mcp_upload_used", "Finish the file upload first.");
  const form = new FormData();
  form.set("document", Bun.file(uploads.path(upload), { type: upload.mime_type }), upload.name ?? "document");

  return form;
}
