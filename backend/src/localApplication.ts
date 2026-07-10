import { evaluateAccountPasswordPolicy } from "./lib/accountPasswordPolicy";
import { HttpError } from "./lib/http";
import { newId, nowIso } from "./lib/ids";
import { InvalidPdfSourceFileError, countPdfSourceFilePages } from "./lib/sourceFilePageCount";
import { parseJsonBody, validateExtractRequest, validateTemplatePayload } from "./lib/validation";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import type { FetchApplication } from "./localRuntime";
import type { LocalAuth } from "./localAuth";
import {
  LocalWorkspaceControlError,
  type LocalWorkspaceControl,
} from "./localWorkspaceControl";
import {
  createLocalWorkspaceProductStore,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";

export const DEFAULT_MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;

export function createLocalApplication({
  auth,
  maxSourceFileBytes = DEFAULT_MAX_SOURCE_FILE_BYTES,
  liveUpdateHub,
  productAnalytics,
  productStoreFactory = createLocalWorkspaceProductStore,
  scheduleQueuedJob = async () => {},
  sourceFileStore,
  stateDirectory,
  workspaceControl,
}: {
  auth?: LocalAuth;
  maxSourceFileBytes?: number;
  liveUpdateHub?: LocalLiveUpdateHub;
  productAnalytics?: LocalProductAnalytics;
  productStoreFactory?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  scheduleQueuedJob?: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  sourceFileStore?: LocalSourceFileStore;
  stateDirectory?: string;
  workspaceControl?: LocalWorkspaceControl;
} = {}): FetchApplication {
  const localSourceFileStore = sourceFileStore ?? (stateDirectory ? createLocalSourceFileStore({ stateDirectory }) : null);
  return async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
      if (!auth) {
        return Response.json(
          {
            error: {
              code: "local_auth_unavailable",
              message: "Local authentication has not finished initializing.",
            },
          },
          { status: 503 },
        );
      }

      const passwordFailure = await passwordPolicyFailure(request, url);
      if (passwordFailure) {
        return passwordFailure;
      }

      return auth.handler(request);
    }

    if (request.method === "GET" && url.pathname === "/v1/health") {
      return Response.json({ ok: true, service: "document-extraction-api" });
    }

    if (url.pathname === "/v1/invitations") {
      if (!auth || !workspaceControl) {
        return Response.json({ error: { code: "local_control_unavailable", message: "Local Workspace control has not finished initializing." } }, { status: 503 });
      }
      const session = await auth.getSession(request);
      if (!session) {
        return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
      }
      if (request.method === "GET") {
        return Response.json({ invitations: workspaceControl.listPendingInvitations({ email: session.email }) });
      }
    }

    const acceptInvitationMatch = url.pathname.match(/^\/v1\/invitations\/([^/]+)\/accept$/);
    if (acceptInvitationMatch) {
      if (!auth || !workspaceControl) {
        return Response.json({ error: { code: "local_control_unavailable", message: "Local Workspace control has not finished initializing." } }, { status: 503 });
      }
      const session = await auth.getSession(request);
      if (!session) {
        return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
      }
      if (request.method === "POST") {
        try {
          return Response.json(workspaceControl.acceptInvitation({
            invitationId: decodeURIComponent(acceptInvitationMatch[1] || ""),
            userId: session.id,
            userEmail: session.email,
          }));
        } catch (error) {
          return workspaceErrorResponse(error);
        }
      }
    }
    const declineInvitationMatch = url.pathname.match(/^\/v1\/invitations\/([^/]+)\/decline$/);
    if (declineInvitationMatch && auth && workspaceControl && request.method === "POST") {
      const session = await auth.getSession(request);
      if (!session) return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
      try {
        return Response.json(workspaceControl.declineInvitation({ invitationId: decodeURIComponent(declineInvitationMatch[1] || ""), userEmail: session.email }));
      } catch (error) { return workspaceErrorResponse(error); }
    }

    const templateMatch = url.pathname.match(/^\/v1\/templates(?:\/([^/]+))?$/);
    if (templateMatch) {
      if (!auth || !workspaceControl || !stateDirectory) {
        return Response.json(
          { error: { code: "local_product_store_unavailable", message: "Local Workspace product storage has not finished initializing." } },
          { status: 503 },
        );
      }
      const apiKey = bearerApiKey(request);
      const session = apiKey ? null : await auth.getSession(request);
      const workspaceId = request.headers.get("x-workspace-id")?.trim() || "";
      const workspace = apiKey
        ? workspaceControl.authorizeApiKey({ apiKey })
        : session && workspaceId
          ? workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id })
          : null;
      if (!workspace) {
        const response = apiKey || session
          ? { status: 403, code: "forbidden", message: "You do not have access to this workspace" }
          : { status: 401, code: "unauthorized", message: "Authentication required" };
        return Response.json({ error: { code: response.code, message: response.message } }, { status: response.status });
      }

      const productWorkspaceId = workspace.id;

      const productStore = productStoreFactory({ stateDirectory, workspaceId: productWorkspaceId });
      try {
        if (workspaceControl.hasPendingStarterTemplateBootstrap({ workspaceId: productWorkspaceId })) {
          productStore.ensureStarterInvoiceTemplate({ createdAt: nowIso() });
          workspaceControl.completeStarterTemplateBootstrap({ workspaceId: productWorkspaceId });
        }
        const templateId = templateMatch[1] ? decodeURIComponent(templateMatch[1]) : "";
        if (templateId && request.method === "GET") {
          const template = productStore.getTemplate(templateId);
          if (!template) {
            throw new HttpError(404, "not_found", "Template not found");
          }
          return Response.json(template);
        }
        if (templateId && request.method === "PATCH") {
          const patch = validateTemplatePayload(parseJsonBody(await request.text()), true);
          const updated = productStore.updateTemplate({
            templateId,
            name: patch.name,
            description: patch.description,
            fields: patch.fields,
            updatedAt: nowIso(),
          });
          if (!updated) {
            throw new HttpError(404, "not_found", "Template not found");
          }
          recordLocalProductAnalytics(productAnalytics, {
            type: "template_updated",
            workspaceId: productWorkspaceId,
            templateId: updated.template_id,
            templateVersion: updated.version,
            status: updated.status,
            fieldCount: productStore.getTemplate(templateId)?.fields.length ?? 0,
          });
          return Response.json(updated);
        }
        if (templateId && request.method === "DELETE") {
          const deleted = productStore.deleteTemplate({ templateId, deletedAt: nowIso() });
          if (!deleted) {
            throw new HttpError(404, "not_found", "Template not found");
          }
          return new Response(null, { status: 204 });
        }
        if (!templateId && request.method === "GET") {
          return Response.json({ templates: productStore.listTemplates() });
        }
        if (!templateId && request.method === "POST") {
          const payload = validateTemplatePayload(parseJsonBody(await request.text()));
          const created = productStore.createTemplate({
            templateId: newId("tpl"),
            name: payload.name!,
            description: payload.description || null,
            fields: payload.fields || [],
            createdAt: nowIso(),
          });
          recordLocalProductAnalytics(productAnalytics, {
            type: "template_created",
            workspaceId: productWorkspaceId,
            templateId: created.template_id,
            templateVersion: created.version,
            status: created.status,
            fieldCount: payload.fields?.length ?? 0,
          });
          return Response.json(created, { status: 201 });
        }
        return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 });
      } catch (error) {
        if (error instanceof HttpError) {
          return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
        }
        throw error;
      } finally {
        productStore.close();
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/extract") {
      if (!auth || !workspaceControl || !stateDirectory || !localSourceFileStore) {
        return Response.json(
          { error: { code: "local_product_store_unavailable", message: "Local Workspace product storage has not finished initializing." } },
          { status: 503 },
        );
      }
      return handleLocalDocumentSubmission({
        auth,
        maxSourceFileBytes,
        liveUpdateHub,
        productAnalytics,
        productStoreFactory,
        request,
        scheduleQueuedJob,
        sourceFileStore: localSourceFileStore,
        stateDirectory,
        workspaceControl,
      });
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs(?:\/([^/]+))?$/);
    if (request.method === "GET" && jobMatch) {
      if (!auth || !workspaceControl || !stateDirectory) {
        return Response.json(
          { error: { code: "local_product_store_unavailable", message: "Local Workspace product storage has not finished initializing." } },
          { status: 503 },
        );
      }
      return handleLocalJobRead({
        auth,
        jobId: jobMatch[1] ? decodeURIComponent(jobMatch[1]) : "",
        productStoreFactory,
        request,
        stateDirectory,
        workspaceControl,
      });
    }

    if (url.pathname === "/v1/workspaces" || url.pathname.startsWith("/v1/workspaces/")) {
      if (!auth || !workspaceControl) {
        return Response.json(
          {
            error: {
              code: "local_control_unavailable",
              message: "Local Workspace control has not finished initializing.",
            },
          },
          { status: 503 },
        );
      }

      const session = await auth.getSession(request);
      if (!session) {
        return Response.json(
          { error: { code: "unauthorized", message: "Authentication required" } },
          { status: 401 },
        );
      }

      try {
        return await handleWorkspaceRequest(request, url, workspaceControl, session);
      } catch (error) {
        return workspaceErrorResponse(error);
      }
    }

    return Response.json(
      {
        error: {
          code: "not_found",
          message: "Route not found",
        },
      },
      { status: 404 },
    );
  };
}

async function handleLocalDocumentSubmission({
  auth,
  maxSourceFileBytes,
  liveUpdateHub,
  productAnalytics,
  productStoreFactory,
  request,
  scheduleQueuedJob,
  sourceFileStore,
  stateDirectory,
  workspaceControl,
}: {
  auth: LocalAuth;
  maxSourceFileBytes: number;
  liveUpdateHub?: LocalLiveUpdateHub;
  productAnalytics?: LocalProductAnalytics;
  productStoreFactory: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  request: Request;
  scheduleQueuedJob: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  sourceFileStore: LocalSourceFileStore;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
}): Promise<Response> {
  const authorization = await authorizeLocalProductRequest({ auth, request, workspaceControl });
  if ("response" in authorization) {
    return authorization.response;
  }

  const productStore = productStoreFactory({ stateDirectory, workspaceId: authorization.workspace.id });
  try {
    if (workspaceControl.hasPendingStarterTemplateBootstrap({ workspaceId: authorization.workspace.id })) {
      productStore.ensureStarterInvoiceTemplate({ createdAt: nowIso() });
      workspaceControl.completeStarterTemplateBootstrap({ workspaceId: authorization.workspace.id });
    }

    const maximumBytes = authorization.workspace.max_source_file_bytes ?? maxSourceFileBytes;
    const { templateId, source } = await validateExtractRequest(request, maximumBytes);
    const template = productStore.getSubmissionTemplate(templateId);
    if (!template) {
      throw new HttpError(404, "template_not_found", "Template not found");
    }

    const sourceBytes = await source.arrayBuffer();
    const sourceFilePageCount = await countLocalSourceFilePages(source.type, sourceBytes);
    const templateFieldCount = productStore.getTemplate(template.template_id)?.fields.length ?? 0;
    const jobId = newId("job");
    const submittedAt = nowIso();
    const sourceFileKey = await sourceFileStore.write({
      workspaceId: authorization.workspace.id,
      jobId,
      mimeType: source.type,
      bytes: sourceBytes,
    });
    const sourceName = source.name.trim() || null;

    let queued;
    try {
      queued = productStore.createQueuedExtractionJob({
        jobId,
        templateId: template.template_id,
        templateVersion: template.template_version,
        sourceFileKey,
        sourceMimeType: source.type,
        sourceName,
        sourceFilePageCount,
        submittedAt,
      });
      const queuedJob = productStore.getExtractionJob(jobId);
      if (queuedJob) {
        liveUpdateHub?.broadcastJob(authorization.workspace.id, queuedJob);
      }
      recordLocalProductAnalytics(productAnalytics, {
        type: "document_submitted",
        workspaceId: authorization.workspace.id,
        templateId: template.template_id,
        templateVersion: template.template_version,
        extractionJobId: jobId,
        status: "queued",
        attempt: 1,
        sourceMimeType: source.type,
        sourceByteSize: sourceBytes.byteLength,
      });
    } catch (error) {
      await deleteLocalSourceFileQuietly(sourceFileStore, sourceFileKey);
      throw error;
    }

    try {
      await scheduleQueuedJob({
        job_id: jobId,
        workspace_id: authorization.workspace.id,
        template_id: template.template_id,
        template_version: template.template_version,
        enqueued_at: submittedAt,
      });
    } catch (error) {
      try {
        const failed = productStore.failQueuedExtractionJob({
          jobId,
          failedAt: nowIso(),
          errorCode: "local_runner_schedule_failed",
          errorMessage: errorMessage(error),
        });
        if (failed) {
          const failedJob = productStore.getExtractionJob(jobId);
          if (failedJob) {
            liveUpdateHub?.broadcastJob(authorization.workspace.id, failedJob);
          }
          recordLocalProductAnalytics(productAnalytics, {
            type: "extraction_failed",
            workspaceId: authorization.workspace.id,
            templateId: template.template_id,
            templateVersion: template.template_version,
            extractionJobId: jobId,
            status: "failed",
            attempt: 1,
            sourceMimeType: source.type,
            errorCode: "local_runner_schedule_failed",
            fieldCount: templateFieldCount,
          });
        }
      } finally {
        await deleteLocalSourceFileQuietly(sourceFileStore, sourceFileKey);
      }
      throw error;
    }

    return Response.json(queued, { status: 202 });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return Response.json(
      { error: { code: "document_submission_failed", message: "Document submission could not be queued" } },
      { status: 500 },
    );
  } finally {
    productStore.close();
  }
}

async function handleLocalJobRead({
  auth,
  jobId,
  productStoreFactory,
  request,
  stateDirectory,
  workspaceControl,
}: {
  auth: LocalAuth;
  jobId: string;
  productStoreFactory: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  request: Request;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
}): Promise<Response> {
  const authorization = await authorizeLocalProductRequest({ auth, request, workspaceControl });
  if ("response" in authorization) {
    return authorization.response;
  }

  const productStore = productStoreFactory({ stateDirectory, workspaceId: authorization.workspace.id });
  try {
    if (!jobId) {
      return Response.json({ jobs: productStore.listExtractionJobs().map((job) => ({ ...job, results: [] })) , next_cursor: null, has_more: false });
    }
    const job = productStore.getExtractionJob(jobId);
    if (!job) {
      return Response.json({ error: { code: "not_found", message: "Job not found" } }, { status: 404 });
    }
    return Response.json(job);
  } finally {
    productStore.close();
  }
}

async function authorizeLocalProductRequest({
  auth,
  request,
  workspaceControl,
}: {
  auth: LocalAuth;
  request: Request;
  workspaceControl: LocalWorkspaceControl;
}): Promise<{ workspace: { id: string; max_source_file_bytes: number | null } } | { response: Response }> {
  const apiKey = bearerApiKey(request);
  const session = apiKey ? null : await auth.getSession(request);
  const workspaceId = request.headers.get("x-workspace-id")?.trim() || "";
  const workspace = apiKey
    ? workspaceControl.authorizeApiKey({ apiKey })
    : session && workspaceId
      ? workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id })
      : null;
  if (workspace) {
    return { workspace };
  }

  const response = apiKey || session
    ? { status: 403, code: "forbidden", message: "You do not have access to this workspace" }
    : { status: 401, code: "unauthorized", message: "Authentication required" };
  return { response: Response.json({ error: { code: response.code, message: response.message } }, { status: response.status }) };
}

async function countLocalSourceFilePages(sourceMimeType: string, sourceBytes: ArrayBuffer): Promise<number | null> {
  if (sourceMimeType !== "application/pdf") {
    return null;
  }

  try {
    return await countPdfSourceFilePages(sourceBytes);
  } catch (error) {
    if (error instanceof InvalidPdfSourceFileError) {
      throw new HttpError(400, error.code, error.message);
    }
    throw error;
  }
}

async function deleteLocalSourceFileQuietly(sourceFileStore: LocalSourceFileStore, sourceFileKey: string): Promise<void> {
  try {
    await sourceFileStore.delete(sourceFileKey);
  } catch {
    // Cleanup is best-effort after a failed submission handoff.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function recordLocalProductAnalytics(
  productAnalytics: LocalProductAnalytics | undefined,
  event: LocalWorkspaceProductAnalyticsEvent,
): void {
  if (!productAnalytics) {
    return;
  }
  try {
    productAnalytics.record(event);
  } catch (error) {
    console.warn("Local product analytics emission failed", error);
  }
}

async function handleWorkspaceRequest(
  request: Request,
  url: URL,
  workspaceControl: LocalWorkspaceControl,
  session: { id: string; name: string },
): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/v1/workspaces") {
    return Response.json({
      workspaces: workspaceControl.listAcceptedWorkspaces({ userId: session.id, userName: session.name }),
    });
  }

  if (request.method === "POST" && url.pathname === "/v1/workspaces") {
    const payload = await request.json().catch(() => ({})) as { name?: unknown };
    if (payload.name !== undefined && (typeof payload.name !== "string" || !payload.name.trim())) {
      return Response.json(
        { error: { code: "invalid_name", message: "name must be a non-empty string" } },
        { status: 400 },
      );
    }

    return Response.json(
      workspaceControl.createWorkspace({
        userId: session.id,
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
      }),
      { status: 201 },
    );
  }

  const contextMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/context$/);
  if (request.method === "GET" && contextMatch) {
    const workspace = workspaceControl.getAcceptedWorkspaceContext({
      workspaceId: decodeURIComponent(contextMatch[1] || ""),
      userId: session.id,
    });
    if (!workspace) {
      return Response.json(
        { error: { code: "forbidden", message: "You do not have access to this workspace" } },
        { status: 403 },
      );
    }
    return Response.json({ workspace });
  }

  const apiKeyMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/api-key$/);
  if (request.method === "POST" && apiKeyMatch) {
    return Response.json(workspaceControl.rotateApiKey({
      workspaceId: decodeURIComponent(apiKeyMatch[1] || ""),
      userId: session.id,
    }));
  }

  const invitationCollectionMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/invitations$/);
  if (request.method === "POST" && invitationCollectionMatch) {
    const payload = await request.json().catch(() => ({})) as { email?: unknown; role?: unknown };
    if (typeof payload.email !== "string" || !payload.email.trim()) {
      return Response.json({ error: { code: "invalid_email", message: "email must be a non-empty string" } }, { status: 400 });
    }
    return Response.json(workspaceControl.createInvitation({
      workspaceId: decodeURIComponent(invitationCollectionMatch[1] || ""),
      inviterUserId: session.id,
      email: payload.email,
      ...(typeof payload.role === "string" ? { role: payload.role } : {}),
    }), { status: 201 });
  }
  const invitationMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/invitations\/([^/]+)$/);
  if (request.method === "DELETE" && invitationMatch) {
    return Response.json(workspaceControl.cancelInvitation({ workspaceId: decodeURIComponent(invitationMatch[1] || ""), invitationId: decodeURIComponent(invitationMatch[2] || ""), userId: session.id }));
  }

  const workspaceMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)$/);
  if (workspaceMatch && request.method === "PATCH") {
    const payload = await request.json().catch(() => ({})) as { name?: unknown };
    if (typeof payload.name !== "string" || !payload.name.trim()) {
      return Response.json(
        { error: { code: "invalid_name", message: "name must be a non-empty string" } },
        { status: 400 },
      );
    }
    return Response.json(workspaceControl.renameWorkspace({
      workspaceId: decodeURIComponent(workspaceMatch[1] || ""),
      userId: session.id,
      name: payload.name.trim(),
    }));
  }

  if (workspaceMatch && request.method === "DELETE") {
    const workspaceId = decodeURIComponent(workspaceMatch[1] || "");
    workspaceControl.deleteWorkspace({ workspaceId, userId: session.id });
    return Response.json({ ok: true, workspace_id: workspaceId });
  }

  return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 });
}

function workspaceErrorResponse(error: unknown): Response {
  if (!(error instanceof LocalWorkspaceControlError)) {
    return Response.json(
      { error: { code: "internal_error", message: "Unexpected server error" } },
      { status: 500 },
    );
  }

  const status = error.code === "last_workspace" || error.code === "invite_exists" ? 409 : error.code === "not_found" ? 404 : 403;
  return Response.json({ error: { code: error.code, message: error.message } }, { status });
}

function bearerApiKey(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim() || "";
  if (!value.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return value.slice(7).trim() || null;
}

async function passwordPolicyFailure(request: Request, url: URL): Promise<Response | null> {
  if (request.method !== "POST") {
    return null;
  }

  const passwordField = url.pathname === "/api/auth/sign-up/email"
    ? "password"
    : url.pathname === "/api/auth/reset-password"
      ? "newPassword"
      : null;
  if (!passwordField) {
    return null;
  }

  const body = await request.clone().json().catch(() => null);
  const password = body && typeof body === "object" && passwordField in body
    ? (body as Record<string, unknown>)[passwordField]
    : null;
  if (typeof password !== "string" || evaluateAccountPasswordPolicy(password).valid) {
    return null;
  }

  return Response.json(
    {
      error: {
        code: "password_policy_not_met",
        message: "Password must meet all complexity requirements.",
      },
    },
    { status: 400 },
  );
}
