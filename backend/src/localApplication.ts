import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { evaluateAccountPasswordPolicy } from "./lib/accountPasswordPolicy";
import { HttpError } from "./lib/http";
import { newId, nowIso } from "./lib/ids";
import { InvalidPdfSourceFileError, countPdfSourceFilePages } from "./lib/sourceFilePageCount";
import { parseJsonBody, validateExtractRequest, validateTemplatePayload } from "./lib/validation";
import { buildJobExportWorkbook } from "./jobExportWorkbook";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import type { LocalModelSettings } from "./localModelSettings";
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
import { createLocalWorkspaceDeletion, type LocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import {
  createLocalWorkspaceProductOperations,
  LocalWorkspaceOperationError,
  type LocalWorkspaceProductOperations,
} from "./localWorkspaceProductOperations";

export const DEFAULT_MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_JOB_PAGE_SIZE = 50;

export function createLocalApplication({
  auth,
  jobPageSize = DEFAULT_JOB_PAGE_SIZE,
  maxSourceFileBytes = DEFAULT_MAX_SOURCE_FILE_BYTES,
  liveUpdateHub,
  modelSettings,
  productAnalytics,
  productStoreFactory = createLocalWorkspaceProductStore,
  scheduleQueuedJob = async () => {},
  sourceFileStore,
  stateDirectory,
  workspaceControl,
  workspaceDeletion,
  workspaceProductOperations,
}: {
  auth?: LocalAuth;
  jobPageSize?: number;
  maxSourceFileBytes?: number;
  liveUpdateHub?: LocalLiveUpdateHub;
  modelSettings?: LocalModelSettings;
  productAnalytics?: LocalProductAnalytics;
  productStoreFactory?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  scheduleQueuedJob?: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  sourceFileStore?: LocalSourceFileStore;
  stateDirectory?: string;
  workspaceControl?: LocalWorkspaceControl;
  workspaceDeletion?: LocalWorkspaceDeletion;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
} = {}): FetchApplication {
  const localJobPageSize = Number.isSafeInteger(jobPageSize) && jobPageSize > 0
    ? jobPageSize
    : DEFAULT_JOB_PAGE_SIZE;
  const jobCursorSecret = randomBytes(32);
  const localSourceFileStore = sourceFileStore ?? (stateDirectory ? createLocalSourceFileStore({ stateDirectory }) : null);
  const localWorkspaceProductOperations = workspaceProductOperations ?? (stateDirectory && workspaceControl
    ? createLocalWorkspaceProductOperations()
    : null);
  const localWorkspaceDeletion = workspaceDeletion ?? (stateDirectory && localSourceFileStore && workspaceControl
    ? createLocalWorkspaceDeletion({
        sourceFileStore: localSourceFileStore,
        stateDirectory,
        workspaceControl,
        workspaceProductOperations: localWorkspaceProductOperations ?? undefined,
        onWorkspaceAccessRevoked: liveUpdateHub?.broadcastWorkspaceContextInvalidation,
      })
    : null);
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

    if (url.pathname === "/v1/settings/model") {
      if (!auth || !modelSettings) {
        return Response.json(
          {
            error: {
              code: "local_model_settings_unavailable",
              message: "Local model settings have not finished initializing.",
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
      if (request.method === "GET") {
        return Response.json(modelSettings.getPublicSettings());
      }
      if (request.method === "PATCH") {
        try {
          const input = validateModelSettingsPayload(
            parseJsonBody(await request.text()),
          );
          return Response.json(await modelSettings.update(input));
        } catch (error) {
          if (error instanceof HttpError) {
            return Response.json(
              { error: { code: error.code, message: error.message } },
              { status: error.status },
            );
          }
          throw error;
        }
      }
      return Response.json(
        { error: { code: "method_not_allowed", message: "Method not allowed" } },
        { status: 405, headers: { allow: "GET, PATCH" } },
      );
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
      let productOperation;
      try {
        productOperation = localWorkspaceProductOperations?.acquire({ workspaceId: productWorkspaceId });
      } catch (error) {
        return workspaceProductOperationErrorResponse(error);
      }

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
        productOperation?.release();
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
        workspaceProductOperations: localWorkspaceProductOperations!,
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/jobs/export") {
      if (!auth || !workspaceControl || !stateDirectory || !localWorkspaceProductOperations) {
        return Response.json(
          { error: { code: "local_product_store_unavailable", message: "Local Workspace product storage has not finished initializing." } },
          { status: 503 },
        );
      }
      return handleLocalJobExport({
        auth,
        productStoreFactory,
        request,
        stateDirectory,
        workspaceControl,
        workspaceProductOperations: localWorkspaceProductOperations,
      });
    }

    const jobMatch = url.pathname.match(/^\/v1\/jobs(?:\/([^/]+))?$/);
    if ((request.method === "GET" || request.method === "DELETE") && jobMatch) {
      if (!auth || !workspaceControl || !stateDirectory || !localSourceFileStore) {
        return Response.json(
          { error: { code: "local_product_store_unavailable", message: "Local Workspace product storage has not finished initializing." } },
          { status: 503 },
        );
      }
      return handleLocalJobRead({
        auth,
        jobId: jobMatch[1] ? decodeURIComponent(jobMatch[1]) : "",
        jobCursorSecret,
        jobPageSize: localJobPageSize,
        productStoreFactory,
        request,
        sourceFileStore: localSourceFileStore,
        stateDirectory,
        workspaceControl,
        workspaceProductOperations: localWorkspaceProductOperations!,
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
        return await handleWorkspaceRequest(request, url, localWorkspaceDeletion, workspaceControl, session);
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

function validateModelSettingsPayload(input: unknown): {
  gatewayUrl: string;
  modelName: string;
  apiKey?: string | null;
  sequentialCalls?: boolean;
  supportsPdfInput?: boolean;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "invalid_model_settings", "Model settings must be an object");
  }
  const payload = input as Record<string, unknown>;
  const gatewayUrl = typeof payload.gateway_url === "string"
    ? payload.gateway_url.trim()
    : "";
  const modelName = typeof payload.model_name === "string"
    ? payload.model_name.trim()
    : "";

  if (!gatewayUrl || gatewayUrl.length > 2_048) {
    throw new HttpError(
      400,
      "invalid_gateway_url",
      "Gateway URL is required and must be 2,048 characters or fewer",
    );
  }
  let parsedGatewayUrl: URL;
  try {
    parsedGatewayUrl = new URL(gatewayUrl);
  } catch {
    throw new HttpError(400, "invalid_gateway_url", "Gateway URL must be a valid URL");
  }
  if (
    (parsedGatewayUrl.protocol !== "http:" && parsedGatewayUrl.protocol !== "https:") ||
    parsedGatewayUrl.username ||
    parsedGatewayUrl.password
  ) {
    throw new HttpError(
      400,
      "invalid_gateway_url",
      "Gateway URL must use HTTP or HTTPS and must not contain credentials",
    );
  }
  if (!modelName || modelName.length > 255) {
    throw new HttpError(
      400,
      "invalid_model_name",
      "Model name is required and must be 255 characters or fewer",
    );
  }

  const behaviorSettings: {
    sequentialCalls?: boolean;
    supportsPdfInput?: boolean;
  } = {};
  if ("sequential_calls" in payload) {
    if (typeof payload.sequential_calls !== "boolean") {
      throw new HttpError(
        400,
        "invalid_sequential_calls",
        "Sequential calls must be a boolean",
      );
    }
    behaviorSettings.sequentialCalls = payload.sequential_calls;
  }
  if ("supports_pdf_input" in payload) {
    if (typeof payload.supports_pdf_input !== "boolean") {
      throw new HttpError(
        400,
        "invalid_supports_pdf_input",
        "PDF input support must be a boolean",
      );
    }
    behaviorSettings.supportsPdfInput = payload.supports_pdf_input;
  }

  if (!("api_key" in payload)) {
    return { gatewayUrl, modelName, ...behaviorSettings };
  }
  if (payload.api_key === null) {
    return { gatewayUrl, modelName, ...behaviorSettings, apiKey: null };
  }
  if (typeof payload.api_key !== "string" || !payload.api_key.trim()) {
    throw new HttpError(
      400,
      "invalid_api_key",
      "API key must be a non-empty string or null",
    );
  }
  if (payload.api_key.length > 16_384) {
    throw new HttpError(
      400,
      "invalid_api_key",
      "API key must be 16,384 characters or fewer",
    );
  }

  return {
    gatewayUrl,
    modelName,
    ...behaviorSettings,
    apiKey: payload.api_key.trim(),
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
  workspaceProductOperations,
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
  workspaceProductOperations: LocalWorkspaceProductOperations;
}): Promise<Response> {
  const authorization = await authorizeLocalProductRequest({ auth, request, workspaceControl });
  if ("response" in authorization) {
    return authorization.response;
  }

  let productOperation;
  try {
    productOperation = workspaceProductOperations.acquire({ workspaceId: authorization.workspace.id });
  } catch (error) {
    return workspaceProductOperationErrorResponse(error);
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
    productOperation.release();
  }
}

async function handleLocalJobRead({
  auth,
  jobId,
  jobCursorSecret,
  jobPageSize,
  productStoreFactory,
  request,
  sourceFileStore,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
}: {
  auth: LocalAuth;
  jobId: string;
  jobCursorSecret: Uint8Array;
  jobPageSize: number;
  productStoreFactory: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  request: Request;
  sourceFileStore: LocalSourceFileStore;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
  workspaceProductOperations: LocalWorkspaceProductOperations;
}): Promise<Response> {
  const authorization = await authorizeLocalProductRequest({ auth, request, workspaceControl });
  if ("response" in authorization) {
    return authorization.response;
  }

  let productOperation;
  try {
    productOperation = workspaceProductOperations.acquire({ workspaceId: authorization.workspace.id });
  } catch (error) {
    return workspaceProductOperationErrorResponse(error);
  }
  const productStore = productStoreFactory({ stateDirectory, workspaceId: authorization.workspace.id });
  let documentDeletionStarted = false;
  try {
    if (request.method === "DELETE") {
      await workspaceProductOperations.beginDocumentDeletion({
        workspaceId: authorization.workspace.id,
        jobId,
      });
      documentDeletionStarted = true;
      const deleted = productStore.deleteExtractionJob({ jobId });
      if (!deleted) {
        workspaceProductOperations.completeDocumentDeletion({
          workspaceId: authorization.workspace.id,
          jobId,
        });
        documentDeletionStarted = false;
        return Response.json({ error: { code: "not_found", message: "Job not found" } }, { status: 404 });
      }
      await deleteLocalSourceFileQuietly(sourceFileStore, deleted.source_file_key);
      workspaceProductOperations.completeDocumentDeletion({
        workspaceId: authorization.workspace.id,
        jobId,
      });
      documentDeletionStarted = false;
      return Response.json({ deleted: true, job_id: deleted.job_id });
    }
    if (!jobId) {
      const url = new URL(request.url);
      const search = normalizeJobSearch(url.searchParams.get("search") || "");
      const cursor = decodeJobCursor({
        cursor: url.searchParams.get("cursor"),
        search,
        secret: jobCursorSecret,
      });
      const candidates = productStore.listExtractionJobs({
        search,
        cursor,
        limit: jobPageSize + 1,
      });
      const hasMore = candidates.length > jobPageSize;
      const jobs = hasMore ? candidates.slice(0, jobPageSize) : candidates;
      const finalJob = jobs.at(-1);
      return Response.json({
        jobs: jobs.map((job) => ({ ...job, results: [] })),
        total: productStore.countExtractionJobs(),
        next_cursor: hasMore && finalJob
          ? encodeJobCursor({
              createdAt: finalJob.created_at,
              jobId: finalJob.job_id,
              search,
              secret: jobCursorSecret,
            })
          : null,
        has_more: hasMore,
      });
    }
    const job = productStore.getExtractionJob(jobId);
    if (!job) {
      return Response.json({ error: { code: "not_found", message: "Job not found" } }, { status: 404 });
    }
    return Response.json(job);
  } catch (error) {
    if (documentDeletionStarted) {
      workspaceProductOperations.failDocumentDeletion({
        workspaceId: authorization.workspace.id,
        jobId,
      });
    }
    if (error instanceof LocalWorkspaceOperationError) {
      return workspaceProductOperationErrorResponse(error);
    }
    if (error instanceof HttpError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  } finally {
    productStore.close();
    productOperation.release();
  }
}

async function handleLocalJobExport({
  auth,
  productStoreFactory,
  request,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
}: {
  auth: LocalAuth;
  productStoreFactory: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  request: Request;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
  workspaceProductOperations: LocalWorkspaceProductOperations;
}): Promise<Response> {
  const authorization = await authorizeLocalProductRequest({ auth, request, workspaceControl });
  if ("response" in authorization) {
    return authorization.response;
  }

  let productOperation;
  try {
    productOperation = workspaceProductOperations.acquire({ workspaceId: authorization.workspace.id });
  } catch (error) {
    return workspaceProductOperationErrorResponse(error);
  }
  const productStore = productStoreFactory({
    stateDirectory,
    workspaceId: authorization.workspace.id,
  });

  try {
    const jobIds = validateJobExportPayload(
      parseJsonBody<unknown>(await request.text()),
    );
    const jobs = jobIds.flatMap((jobId) => {
      const job = productStore.getExtractionJobExport(jobId);
      return job && (job.status === "completed" || job.status === "failed")
        ? [job]
        : [];
    });
    const skippedCount = jobIds.length - jobs.length;
    if (!jobs.length) {
      throw new HttpError(
        409,
        "no_exportable_jobs",
        "None of the selected jobs are completed or failed",
      );
    }

    const exportWorkbook = await buildJobExportWorkbook({
      jobs,
      workspaceName: authorization.workspace.name,
    });
    return new Response(Uint8Array.from(exportWorkbook.bytes).buffer, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="${exportWorkbook.filename}"`,
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-exported-job-count": String(jobs.length),
        "x-skipped-job-count": String(skippedCount),
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return Response.json(
      { error: { code: "job_export_failed", message: "Selected jobs could not be exported" } },
      { status: 500 },
    );
  } finally {
    productStore.close();
    productOperation.release();
  }
}

function validateJobExportPayload(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "invalid_job_export", "Job export must be an object");
  }
  const jobIds = (input as { job_ids?: unknown }).job_ids;
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    throw new HttpError(
      400,
      "invalid_job_export",
      "Select at least one job to export",
    );
  }
  const normalized = jobIds.map((jobId) =>
    typeof jobId === "string" ? jobId.trim() : ""
  );
  if (normalized.some((jobId) => !jobId)) {
    throw new HttpError(
      400,
      "invalid_job_export",
      "Every exported job ID must be a non-empty string",
    );
  }
  return [...new Set(normalized)];
}

function normalizeJobSearch(value: string): string {
  return value.trim().toLowerCase();
}

function encodeJobCursor({
  createdAt,
  jobId,
  search,
  secret,
}: {
  createdAt: string;
  jobId: string;
  search: string;
  secret: Uint8Array;
}): string {
  const payload = Buffer.from(JSON.stringify({ created_at: createdAt, job_id: jobId, search }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeJobCursor({
  cursor,
  search,
  secret,
}: {
  cursor: string | null;
  search: string;
  secret: Uint8Array;
}): { createdAt: string; jobId: string } | null {
  if (!cursor) {
    return null;
  }
  const [payload, signature, ...extra] = cursor.split(".");
  if (!payload || !signature || extra.length) {
    throw new HttpError(400, "invalid_cursor", "Job cursor is invalid or does not match this search");
  }
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  const signatureBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expectedSignature, "base64url");
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) {
    throw new HttpError(400, "invalid_cursor", "Job cursor is invalid or does not match this search");
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      created_at?: unknown;
      job_id?: unknown;
      search?: unknown;
    };
    if (
      typeof parsed.created_at !== "string" ||
      typeof parsed.job_id !== "string" ||
      typeof parsed.search !== "string" ||
      parsed.search !== search
    ) {
      throw new Error("Invalid cursor payload");
    }
    return { createdAt: parsed.created_at, jobId: parsed.job_id };
  } catch {
    throw new HttpError(400, "invalid_cursor", "Job cursor is invalid or does not match this search");
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
}): Promise<{ workspace: { id: string; name: string; max_source_file_bytes: number | null } } | { response: Response }> {
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
  workspaceDeletion: LocalWorkspaceDeletion | null,
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

  const workspaceUsersMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/users$/);
  if (request.method === "GET" && workspaceUsersMatch) {
    return Response.json({
      users: workspaceControl.listWorkspaceUsers({
        workspaceId: decodeURIComponent(workspaceUsersMatch[1] || ""),
        userId: session.id,
      }),
    });
  }

  const workspaceUserMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/users\/([^/]+)$/);
  if (request.method === "POST" && workspaceUserMatch) {
    const payload = await request.json().catch(() => ({})) as { action?: unknown };
    return Response.json(workspaceControl.applyWorkspaceMemberAction({
      workspaceId: decodeURIComponent(workspaceUserMatch[1] || ""),
      actorUserId: session.id,
      targetUserId: decodeURIComponent(workspaceUserMatch[2] || ""),
      action: typeof payload.action === "string" ? payload.action : "",
    }));
  }

  const leaveWorkspaceMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/leave$/);
  if (request.method === "POST" && leaveWorkspaceMatch) {
    return Response.json(workspaceControl.leaveWorkspace({
      workspaceId: decodeURIComponent(leaveWorkspaceMatch[1] || ""),
      userId: session.id,
      userName: session.name,
    }));
  }

  const invitationCollectionMatch = url.pathname.match(/^\/v1\/workspaces\/([^/]+)\/invitations$/);
  if (request.method === "GET" && invitationCollectionMatch) {
    return Response.json({
      invitations: workspaceControl.listWorkspaceInvitations({
        workspaceId: decodeURIComponent(invitationCollectionMatch[1] || ""),
        userId: session.id,
      }),
    });
  }
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
    if (!workspaceDeletion) {
      return Response.json(
        { error: { code: "local_product_store_unavailable", message: "Local Workspace product storage has not finished initializing." } },
        { status: 503 },
      );
    }
    await workspaceDeletion.deleteWorkspace({ workspaceId, userId: session.id });
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

function workspaceProductOperationErrorResponse(error: unknown): Response {
  if (error instanceof LocalWorkspaceOperationError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: 409 },
    );
  }
  return Response.json(
    { error: { code: "internal_error", message: "Unexpected server error" } },
    { status: 500 },
  );
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
