import { generateTemplate } from "./consumer/templateGeneration";
import { ExtractionCancelledError, ModelGatewayRequestError, RetryableError } from "./consumer/modelGateway";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import { evaluateAccountPasswordPolicy } from "./lib/accountPasswordPolicy";
import { bearerApiKey, HttpError } from "./lib/http";
import { newId, nowIso } from "./lib/ids";
import { InvalidPdfSourceFileError, PdfSourceFileCapacityError, PdfSourceFileLimitError, countPdfSourceFilePages } from "./lib/sourceFilePageCount";
import { parseJsonBody, validateExtractRequest, validateTemplatePayload } from "./lib/validation";
import { buildJobExportInWorker } from "./localJobExportWorker";
import { assertKnownDocumentRequestBodyLength } from "./localDocumentBodyLimit";
import { boundLocalApiBody } from "./localApiBodyLimit";
import { localRequestOriginFailure } from "./localRequestOrigin";
import { parseLocalMultipartSubmission } from "./localMultipartSubmission";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import type { LocalProductAnalytics, LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { handleWorkspaceModelConfiguration } from "./workspaceModelConfigurationHttp";
import { configurationMissing, createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import type { FetchApplication } from "./localRuntime";
import type { LocalSourceStorageConfiguration } from "./localConfiguration";
import type { LocalSourceObjectManifest } from "./localSourceObjectManifest";
import { SourceObjectMissingError, type SourceObjectStore } from "./s3SourceObjectStore";
import type { LocalAuth, LocalSession } from "./localAuth";
import { LocalWorkspaceControlError, type LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceExtractionJobSummary, LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import {
  createEphemeralLocalWorkspaceProductStoreRegistry,
  createLocalWorkspaceProductStoreRegistry,
  type LocalWorkspaceProductStoreHandle,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";
import {
  createLocalWorkspaceProductDataAccess,
  LocalWorkspaceProductDataAccessError,
  type LocalWorkspaceProductDataAccess,
} from "./localWorkspaceProductDataAccess";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceDeletion, type LocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import {
  createLocalWorkspaceProductOperations,
  LocalWorkspaceOperationError,
  type LocalWorkspaceProductOperations,
} from "./localWorkspaceProductOperations";

const DEFAULT_JOB_PAGE_SIZE = 50;
let activeJobExports = 0;

/** Everything a Workspace product route needs; present only when the app has local state and control. */
type ProductServices = {
  auth: LocalAuth;
  access: LocalWorkspaceProductDataAccess;
  operations: LocalWorkspaceProductOperations;
  sourceFileStore: LocalSourceFileStore;
  sourceStorage: LocalSourceStorageConfiguration;
  sourceObjects?: LocalRetainedSourceObjects & { activeReads: { count: number } };
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
};

/** Remote retained originals: the object store, the installation manifest and the key scheme. */
export type LocalRetainedSourceObjects = {
  store: SourceObjectStore;
  manifest: Pick<LocalSourceObjectManifest, "prepare" | "link" | "markDeleting" | "markJobDeleting" | "markWorkspaceDeleting">;
  keyFor(input: { workspaceId: string; jobId: string; mimeType: string }): string;
  /** Concurrent remote preview/download streams, so reads cannot starve uploads and cleanup. */
  maxConcurrentReads?: number;
};

type AuthorizedWorkspace = { id: string; name: string; max_source_file_bytes: number | null; source_retention_disabled: boolean };

const NO_SOURCE_STORAGE: LocalSourceStorageConfiguration = { provider: "none", originalRetentionEnabled: false };

export function createLocalApplication({
  auth,
  diagnostics,
  evaluations,
  jobPageSize = DEFAULT_JOB_PAGE_SIZE,
  maxSourceFileBytes = 10 * 1024 * 1024,
  maxJsonRequestBytes = 1024 * 1024,
  modelGatewayRequestTimeoutMs = "300000",
  liveUpdateHub,
  productAnalytics,
  productStoreFactory,
  productStoreRegistry,
  scheduleQueuedJob = async () => {},
  sourceFileStore,
  sourceStorage = NO_SOURCE_STORAGE,
  sourceObjects,
  stateDirectory,
  workspaceControl,
  workspaceDeletion,
  workspaceProductOperations,
}: {
  evaluations?: { handle(request: Request): Promise<Response> };
  auth?: LocalAuth;
  diagnostics?: () => Record<string, unknown>;
  jobPageSize?: number;
  maxSourceFileBytes?: number;
  maxJsonRequestBytes?: number;
  modelGatewayRequestTimeoutMs?: string;
  liveUpdateHub?: LocalLiveUpdateHub;
  productAnalytics?: LocalProductAnalytics;
  productStoreFactory?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  productStoreRegistry?: LocalWorkspaceProductStoreRegistry;
  scheduleQueuedJob?: (job: LocalQueuedExtractionJob) => void | Promise<void>;
  sourceFileStore?: LocalSourceFileStore;
  sourceStorage?: LocalSourceStorageConfiguration;
  sourceObjects?: LocalRetainedSourceObjects;
  stateDirectory?: string;
  workspaceControl?: LocalWorkspaceControl;
  workspaceDeletion?: LocalWorkspaceDeletion;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
} = {}): FetchApplication {
  const localJobPageSize = Number.isSafeInteger(jobPageSize) && jobPageSize > 0 ? jobPageSize : DEFAULT_JOB_PAGE_SIZE;
  const jobCursorSecret = randomBytes(32);
  let product: ProductServices | null = null;
  let localWorkspaceDeletion = workspaceDeletion ?? null;
  if (stateDirectory && workspaceControl) {
    const registry = productStoreRegistry ?? (productStoreFactory
      ? createEphemeralLocalWorkspaceProductStoreRegistry({ stateDirectory, createStore: productStoreFactory })
      : createLocalWorkspaceProductStoreRegistry({ stateDirectory }));
    const operations = workspaceProductOperations ?? createLocalWorkspaceProductOperations();
    const files = sourceFileStore ?? createLocalSourceFileStore({ stateDirectory });
    localWorkspaceDeletion ??= createLocalWorkspaceDeletion({
      sourceFileStore: files,
      stateDirectory,
      workspaceControl,
      workspaceProductOperations: operations,
      productStoreRegistry: registry,
      sourceObjectManifest: sourceObjects?.manifest,
      onWorkspaceAccessRevoked: liveUpdateHub?.broadcastWorkspaceContextInvalidation,
    });
    if (auth) {
      product = {
        auth,
        access: createLocalWorkspaceProductDataAccess({ registry, operations }),
        operations,
        sourceFileStore: files,
        sourceStorage,
        sourceObjects: sourceObjects && { ...sourceObjects, activeReads: { count: 0 } },
        stateDirectory,
        workspaceControl,
      };
    }
  }

  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname.startsWith("/v1/") && request.headers.has("cookie") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const rejection = localRequestOriginFailure(request, auth);
      if (rejection) return rejection;
    }
    if (pathname.startsWith("/v1/evaluations/") && evaluations) return evaluations.handle(request);
    // Document uploads are streamed and bounded by their own multipart limits.
    if (request.body && !(request.method === "POST" && ["/v1/extract", "/v1/templates/generate"].includes(pathname))) {
      try {
        request = await boundLocalApiBody(request, maxJsonRequestBytes);
      } catch (error) {
        return error instanceof HttpError
          ? httpErrorResponse(error)
          : errorResponse(400, "invalid_request_body", "Could not read the request body");
      }
    }

    if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
      if (!auth) return errorResponse(503, "local_auth_unavailable", "Local authentication has not finished initializing.");
      return (await passwordPolicyFailure(request, url)) ?? auth.handler(request);
    }

    if (request.method === "GET" && pathname === "/v1/health") {
      return Response.json({
        ok: true,
        service: "document-extraction-api",
        ...(diagnostics ? { diagnostics: diagnostics() } : {}),
      });
    }

    const modelConfigurationMatch = pathname.match(/^\/v1\/workspaces\/([^/]+)\/model-configuration(\/test)?$/);
    if (modelConfigurationMatch) {
      if (!product) return productStoreUnavailable();
      return handleWorkspaceModelConfiguration({
        request,
        workspaceId: decodeURIComponent(modelConfigurationMatch[1]!),
        test: Boolean(modelConfigurationMatch[2]),
        auth: product.auth,
        workspaceControl: product.workspaceControl,
        stateDirectory: product.stateDirectory,
        access: product.access,
        liveUpdateHub,
      });
    }

    if (["/v1/invitations", "/v1/workspaces"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      if (!auth || !workspaceControl) {
        return errorResponse(503, "local_control_unavailable", "Local Workspace control has not finished initializing.");
      }
      const session = await auth.getSession(request);
      if (!session) return unauthorized();
      try {
        return await handleControlRequest(request, pathname, session, workspaceControl, localWorkspaceDeletion, sourceStorage);
      } catch (error) {
        return workspaceErrorResponse(error);
      }
    }

    if (request.method === "POST" && pathname === "/v1/templates/generate") {
      if (!product) return productStoreUnavailable();
      return handleTemplateGeneration({ product, request, maxSourceFileBytes, modelGatewayRequestTimeoutMs });
    }

    const templateMatch = pathname.match(/^\/v1\/templates(?:\/([^/]+))?$/);
    if (templateMatch) {
      if (!product) return productStoreUnavailable();
      return handleTemplateRequest({
        product,
        productAnalytics,
        request,
        templateId: templateMatch[1] ? decodeURIComponent(templateMatch[1]) : "",
      });
    }

    if (request.method === "POST" && pathname === "/v1/extract") {
      if (!product) return productStoreUnavailable();
      return handleLocalDocumentSubmission({ product, maxSourceFileBytes, liveUpdateHub, productAnalytics, request, scheduleQueuedJob });
    }

    if (request.method === "POST" && pathname === "/v1/jobs/export") {
      if (!product) return productStoreUnavailable();
      return handleLocalJobExport(product, request);
    }

    if (request.method === "GET" && pathname === "/v1/jobs/filter-options") {
      if (!product) return productStoreUnavailable();
      return withAuthorizedProductStore(product, request, ({ store }) =>
        Response.json({ available_models: store.listExtractionJobModels() }));
    }

    const sourceMatch = pathname.match(/^\/v1\/jobs\/([^/]+)\/source$/);
    if ((request.method === "GET" || request.method === "HEAD") && sourceMatch) {
      if (!product) return productStoreUnavailable();
      return handleRetainedSourceFileRead({ product, jobId: decodeURIComponent(sourceMatch[1]!), request });
    }

    const jobMatch = pathname.match(/^\/v1\/jobs(?:\/([^/]+))?$/);
    if ((request.method === "GET" || request.method === "DELETE") && jobMatch) {
      if (!product) return productStoreUnavailable();
      return handleLocalJobRead({
        product,
        jobId: jobMatch[1] ? decodeURIComponent(jobMatch[1]) : "",
        jobCursorSecret,
        jobPageSize: localJobPageSize,
        request,
      });
    }

    return routeNotFound();
  };
}

/** Authorizes the request, then runs `work` against its Workspace product store. */
async function withAuthorizedProductStore(
  product: ProductServices,
  request: Request,
  work: (context: { store: LocalWorkspaceProductStoreHandle; signal: AbortSignal; workspace: AuthorizedWorkspace }) => Response | Promise<Response>,
): Promise<Response> {
  const authorization = await authorizeLocalProductRequest(product, request);
  if ("response" in authorization) return authorization.response;
  const { workspace } = authorization;
  return product.access
    .run({ workspaceId: workspace.id, mode: "create" }, (context) => work({ ...context, workspace }))
    .catch(workspaceProductDataAccessErrorResponse);
}

function handleTemplateGeneration({
  product,
  request,
  maxSourceFileBytes,
  modelGatewayRequestTimeoutMs,
}: {
  product: ProductServices;
  request: Request;
  maxSourceFileBytes: number;
  modelGatewayRequestTimeoutMs: string;
}): Promise<Response> {
  const { stateDirectory } = product;
  return withAuthorizedProductStore(product, request, async ({ store, signal: workspaceSignal, workspace }) => {
    let temporaryPath: string | undefined;
    const signal = AbortSignal.any([request.signal, workspaceSignal]);
    try {
      const configuration = store.getModelConfiguration();
      if (!configuration) throw configurationMissing();
      const credential = createWorkspaceCredentialVault(stateDirectory).decrypt(workspace.id, configuration.credential_ciphertext);
      const maximumBytes = workspace.max_source_file_bytes ?? maxSourceFileBytes;
      assertKnownDocumentRequestBodyLength(request, maximumBytes);
      const sample = await parseLocalMultipartSubmission({
        request: new Request(request, { signal }), stateDirectory, maxSourceFileBytes: maximumBytes, purpose: "template-generation",
      });
      temporaryPath = sample.source.temporaryPath;
      if (sample.source.mimeType === "application/pdf") {
        await countLocalSourceFilePages(sample.source.mimeType, await Bun.file(temporaryPath).arrayBuffer(), signal);
      }
      const template = await generateTemplate({
        AI_MODEL: configuration.model_name,
        MODEL_GATEWAY_URL: configuration.gateway_url,
        LITELLM_KEY: credential,
        MODEL_GATEWAY_SEQUENTIAL_CALLS: String(configuration.sequential_calls),
        MODEL_SUPPORTS_PDF_INPUT: String(configuration.supports_pdf_input),
        MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(configuration.supports_structured_output),
        MODEL_GATEWAY_WORKSPACE_ID: workspace.id,
        MODEL_GATEWAY_REQUEST_TIMEOUT_MS: modelGatewayRequestTimeoutMs,
      }, Bun.file(temporaryPath), sample.source.mimeType, sample.instructions || "", signal);
      return Response.json(template, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (signal.aborted || error instanceof ExtractionCancelledError) {
        return errorResponse(499, "template_generation_cancelled", "Template generation cancelled");
      }
      if (error instanceof HttpError) return httpErrorResponse(error);
      if (error instanceof ModelGatewayRequestError || error instanceof RetryableError) {
        return errorResponse(502, "template_generation_failed", `${error.message}. Check the workspace model configuration or try again.`);
      }
      return errorResponse(500, "template_generation_failed", "Template generation failed. Please try again.");
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true });
    }
  });
}

function handleTemplateRequest({
  product,
  productAnalytics,
  request,
  templateId,
}: {
  product: ProductServices;
  productAnalytics?: LocalProductAnalytics;
  request: Request;
  templateId: string;
}): Promise<Response> {
  return withAuthorizedProductStore(product, request, async ({ store, workspace }) => {
    try {
      ensureStarterTemplate(product.workspaceControl, store, workspace.id);
      if (templateId && request.method === "GET") {
        const template = store.getTemplate(templateId);
        if (!template) throw templateNotFound();
        return Response.json(template);
      }
      if (templateId && request.method === "PATCH") {
        const patch = validateTemplatePayload(parseJsonBody(await request.text()), true);
        const updated = store.updateTemplate({
          templateId,
          name: patch.name,
          description: patch.description,
          fields: patch.fields,
          updatedAt: nowIso(),
        });
        if (!updated) throw templateNotFound();
        recordLocalProductAnalytics(productAnalytics, {
          type: "template_updated",
          workspaceId: workspace.id,
          templateId: updated.template_id,
          templateVersion: updated.version,
          status: updated.status,
          fieldCount: store.getTemplate(templateId)?.fields.length ?? 0,
        });
        return Response.json(updated);
      }
      if (templateId && request.method === "DELETE") {
        if (!store.deleteTemplate({ templateId, deletedAt: nowIso() })) throw templateNotFound();
        return new Response(null, { status: 204 });
      }
      if (!templateId && request.method === "GET") {
        return Response.json({ templates: store.listTemplates() });
      }
      if (!templateId && request.method === "POST") {
        const payload = validateTemplatePayload(parseJsonBody(await request.text()));
        const created = store.createTemplate({
          templateId: newId("tpl"),
          name: payload.name!,
          description: payload.description || null,
          fields: payload.fields || [],
          createdAt: nowIso(),
        });
        recordLocalProductAnalytics(productAnalytics, {
          type: "template_created",
          workspaceId: workspace.id,
          templateId: created.template_id,
          templateVersion: created.version,
          status: created.status,
          fieldCount: payload.fields?.length ?? 0,
        });
        return Response.json(created, { status: 201 });
      }
      return routeNotFound();
    } catch (error) {
      if (error instanceof HttpError) return httpErrorResponse(error);
      throw error;
    }
  });
}

function handleLocalDocumentSubmission({
  product,
  maxSourceFileBytes,
  liveUpdateHub,
  productAnalytics,
  request,
  scheduleQueuedJob,
}: {
  product: ProductServices;
  maxSourceFileBytes: number;
  liveUpdateHub?: LocalLiveUpdateHub;
  productAnalytics?: LocalProductAnalytics;
  request: Request;
  scheduleQueuedJob: (job: LocalQueuedExtractionJob) => void | Promise<void>;
}): Promise<Response> {
  const { sourceFileStore, sourceStorage, stateDirectory, workspaceControl } = product;
  return withAuthorizedProductStore(product, request, async ({ store: productStore, signal: workspaceSignal, workspace }) => {
    const workspaceId = workspace.id;
    // Captured once, when the server begins accepting the upload; later setting changes apply to later uploads.
    const sourceRetained = retainsNewOriginals(sourceStorage, workspace);
    const maximumBytes = workspace.max_source_file_bytes ?? maxSourceFileBytes;
    const signal = AbortSignal.any([request.signal, workspaceSignal]);
    try {
      const configuration = productStore.getModelConfiguration();
      if (!configuration) throw configurationMissing();
      // Refuse the upload early when the stored credential can no longer be used.
      createWorkspaceCredentialVault(stateDirectory).decrypt(workspaceId, configuration.credential_ciphertext);
      assertKnownDocumentRequestBodyLength(request, maximumBytes);
      ensureStarterTemplate(workspaceControl, productStore, workspaceId);

      let sourceMimeType: string;
      let sourceName: string | null;
      let sourceByteSize: number;
      let sourceBytes: ArrayBuffer;
      let temporaryPath: string | null = null;
      let templateId: string;
      if (sourceFileStore.promoteTemporary) {
        const streamed = await parseLocalMultipartSubmission({
          maxSourceFileBytes: maximumBytes,
          request: new Request(request, { signal }),
          stateDirectory,
        });
        templateId = streamed.templateId;
        sourceMimeType = streamed.source.mimeType;
        sourceName = streamed.source.name.trim() || null;
        sourceByteSize = streamed.source.size;
        temporaryPath = streamed.source.temporaryPath;
      } else {
        const validated = await validateExtractRequest(request, maximumBytes);
        templateId = validated.templateId;
        sourceMimeType = validated.source.type;
        sourceName = validated.source.name.trim() || null;
        sourceByteSize = validated.source.size;
        sourceBytes = await validated.source.arrayBuffer();
      }
      try {
        const template = productStore.getSubmissionTemplate(templateId);
        if (!template) throw new HttpError(404, "template_not_found", "Template not found");
        if (temporaryPath && sourceMimeType === "application/pdf") sourceBytes = await Bun.file(temporaryPath).arrayBuffer();
        const sourceFilePageCount = await countLocalSourceFilePages(sourceMimeType, sourceBytes!, signal);
        signal.throwIfAborted();
        const templateFieldCount = productStore.getTemplate(template.template_id)?.fields.length ?? 0;
        const jobId = newId("job");
        const submittedAt = nowIso();
        const sourceFileKey = temporaryPath
          ? await sourceFileStore.promoteTemporary!({ workspaceId, jobId, mimeType: sourceMimeType, temporaryPath })
          : await sourceFileStore.write({ workspaceId, jobId, mimeType: sourceMimeType, bytes: sourceBytes! });
        temporaryPath = null;
        sourceBytes = new ArrayBuffer(0);
        const retainedObjectKey = sourceRetained && sourceStorage.provider === "s3"
          ? await publishRetainedOriginal({ product, workspaceId, jobId, sourceFileKey, sourceMimeType, signal })
          : null;

        let queued;
        try {
          queued = productStore.createQueuedExtractionJob({
            jobId,
            templateId: template.template_id,
            templateVersion: template.template_version,
            sourceFileKey,
            sourceMimeType,
            sourceName,
            sourceFilePageCount,
            sourceRetained,
            retainedObjectKey,
            submittedAt,
          });
          // The job transaction is the durable acceptance point; linking only records it for recovery.
          if (retainedObjectKey) product.sourceObjects!.manifest.link({ objectKey: retainedObjectKey });
          const queuedJob = productStore.getExtractionJob(jobId);
          if (queuedJob) liveUpdateHub?.broadcastJob(workspaceId, queuedJob);
          recordLocalProductAnalytics(productAnalytics, {
            type: "document_submitted",
            workspaceId,
            templateId: template.template_id,
            templateVersion: template.template_version,
            extractionJobId: jobId,
            status: "queued",
            attempt: 1,
            sourceMimeType,
            sourceByteSize,
          });
        } catch (error) {
          if (retainedObjectKey && !productStore.getExtractionJobSummary(jobId)) {
            product.sourceObjects!.manifest.markDeleting({ objectKey: retainedObjectKey });
          }
          await deleteLocalSourceFileQuietly(sourceFileStore, sourceFileKey);
          throw error;
        }

        try {
          await scheduleQueuedJob({
            job_id: jobId,
            workspace_id: workspaceId,
            template_id: template.template_id,
            template_version: template.template_version,
            enqueued_at: submittedAt,
          });
        } catch (error) {
          // A failed job keeps its Source file for retention; an unrecorded one must not leak it.
          let failed = false;
          try {
            failed = productStore.failQueuedExtractionJob({
              jobId,
              failedAt: nowIso(),
              errorCode: "local_runner_schedule_failed",
              errorMessage: error instanceof Error ? error.message : "Unknown error",
            });
            if (failed) {
              const failedJob = productStore.getExtractionJob(jobId);
              if (failedJob) liveUpdateHub?.broadcastJob(workspaceId, failedJob);
              recordLocalProductAnalytics(productAnalytics, {
                type: "extraction_failed",
                workspaceId,
                templateId: template.template_id,
                templateVersion: template.template_version,
                extractionJobId: jobId,
                status: "failed",
                attempt: 1,
                sourceMimeType,
                errorCode: "local_runner_schedule_failed",
                fieldCount: templateFieldCount,
              });
            }
          } finally {
            if (!failed) await deleteLocalSourceFileQuietly(sourceFileStore, sourceFileKey);
          }
          throw error;
        }

        return Response.json(queued, {
          status: 202,
          headers: {
            "cache-control": "no-store",
            location: `/v1/jobs/${encodeURIComponent(queued.job_id)}`,
            "retry-after": "2",
          },
        });
      } finally {
        if (temporaryPath) await rm(temporaryPath, { force: true });
      }
    } catch (error) {
      if (error instanceof SourceStorageUnavailableError) {
        return errorResponse(503, "source_storage_unavailable", "The original document couldn't be saved. Please try again.", { "cache-control": "no-store", "retry-after": "5" });
      }
      if (signal.aborted) return errorResponse(499, "document_submission_cancelled", "Document submission cancelled");
      if (error instanceof HttpError) return httpErrorResponse(error);
      return errorResponse(500, "document_submission_failed", "Document submission could not be queued");
    }
  });
}

function handleLocalJobRead({
  product,
  jobId,
  jobCursorSecret,
  jobPageSize,
  request,
}: {
  product: ProductServices;
  jobId: string;
  jobCursorSecret: Uint8Array;
  jobPageSize: number;
  request: Request;
}): Promise<Response> {
  const { operations, sourceFileStore } = product;
  return withAuthorizedProductStore(product, request, async ({ store: productStore, workspace }) => {
    const workspaceId = workspace.id;
    let documentDeletionStarted = false;
    try {
      if (request.method === "DELETE") {
        await operations.beginDocumentDeletion({ workspaceId, jobId });
        documentDeletionStarted = true;
        const deleted = productStore.deleteExtractionJob({ jobId });
        // A remote original is handed to durable object cleanup before the deletion intent clears;
        // without object cleanup configured, the intent stays for the sweep to retry.
        const releasedRemote = !deleted?.retained_object_key || Boolean(product.sourceObjects);
        if (deleted?.retained_object_key) product.sourceObjects?.manifest.markJobDeleting({ workspaceId, jobId });
        if (deleted && releasedRemote && await deleteLocalSourceFileQuietly(sourceFileStore, deleted.source_file_key)) {
          productStore.markSourceFileCleaned({ jobId, sourceFileKey: deleted.source_file_key, cleanedAt: nowIso() });
        }
        operations.completeDocumentDeletion({ workspaceId, jobId });
        documentDeletionStarted = false;
        return deleted
          ? Response.json({ deleted: true, job_id: deleted.job_id })
          : errorResponse(404, "not_found", "Job not found");
      }
      if (jobId === "counts") {
        return Response.json(productStore.getExtractionJobCounts(), { headers: { "cache-control": "no-store" } });
      }
      if (!jobId) {
        const { searchParams } = new URL(request.url);
        const search = (searchParams.get("search") || "").trim().toLowerCase();
        const filters = normalizeJobFilters({
          dateFrom: searchParams.get("date_from"),
          dateTo: searchParams.get("date_to"),
          model: searchParams.get("model"),
        });
        const cursor = decodeJobCursor({ cursor: searchParams.get("cursor"), filters, search, secret: jobCursorSecret });
        const candidates = productStore.listExtractionJobs({ search, ...filters, cursor, limit: jobPageSize + 1 });
        const hasMore = candidates.length > jobPageSize;
        const jobs = hasMore ? candidates.slice(0, jobPageSize) : candidates;
        const finalJob = jobs.at(-1);
        return Response.json({
          jobs: jobs.map((job) => ({ ...job, results: [] })),
          ...productStore.getExtractionJobCounts(),
          next_cursor: hasMore && finalJob
            ? encodeJobCursor({ createdAt: finalJob.created_at, filters, jobId: finalJob.job_id, search, secret: jobCursorSecret })
            : null,
          has_more: hasMore,
        });
      }
      const jobSummary = productStore.getExtractionJobSummary(jobId);
      if (!jobSummary) return errorResponse(404, "not_found", "Job not found", { "cache-control": "no-store" });
      const entityTag = extractionJobEntityTag(workspaceId, jobSummary);
      const headers = new Headers({ "cache-control": "private, no-cache", etag: entityTag });
      if (jobSummary.status === "queued" || jobSummary.status === "processing") headers.set("retry-after", "5");
      if (ifNoneMatchIncludes(request.headers.get("if-none-match"), entityTag)) {
        return new Response(null, { status: 304, headers });
      }
      return Response.json({
        ...jobSummary,
        results: jobSummary.status === "completed" ? productStore.getExtractionJobResults(jobId) : [],
      }, { headers });
    } catch (error) {
      if (documentDeletionStarted) operations.failDocumentDeletion({ workspaceId, jobId });
      if (error instanceof LocalWorkspaceOperationError) return errorResponse(409, error.code, error.message);
      if (error instanceof HttpError) return httpErrorResponse(error);
      throw error;
    }
  });
}

async function handleLocalJobExport(product: ProductServices, request: Request): Promise<Response> {
  const authorization = await authorizeLocalProductRequest(product, request);
  if ("response" in authorization) return authorization.response;
  const { workspace } = authorization;

  if (activeJobExports >= 2) {
    return errorResponse(503, "export_capacity_unavailable", "Two exports are already running; try again shortly", { "retry-after": "2" });
  }
  activeJobExports += 1;
  return product.access.run({ workspaceId: workspace.id, mode: "create" }, async ({ store: productStore, signal }) => {
    try {
      const jobIds = validateJobExportPayload(parseJsonBody<unknown>(await request.text()));
      let jobs;
      try {
        jobs = productStore.getExtractionJobExports(jobIds);
      } catch (error) {
        if (error instanceof RangeError) throw new HttpError(413, "export_too_large", error.message);
        throw error;
      }
      if (!jobs.length) throw new HttpError(409, "no_exportable_jobs", "None of the selected jobs are completed or failed");

      const exportWorkbook = await buildJobExportInWorker({ jobs, workspaceName: workspace.name }, AbortSignal.any([signal, request.signal]));
      return new Response(exportWorkbook.bytes, {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${exportWorkbook.filename}"`,
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "x-exported-job-count": String(jobs.length),
          "x-skipped-job-count": String(jobIds.length - jobs.length),
        },
      });
    } catch (error) {
      if (error instanceof HttpError) return httpErrorResponse(error);
      return errorResponse(500, "job_export_failed", "Selected jobs could not be exported");
    }
  }).catch(workspaceProductDataAccessErrorResponse).finally(() => { activeJobExports -= 1; });
}

async function handleControlRequest(
  request: Request,
  pathname: string,
  session: LocalSession,
  workspaceControl: LocalWorkspaceControl,
  workspaceDeletion: LocalWorkspaceDeletion | null,
  sourceStorage: LocalSourceStorageConfiguration,
): Promise<Response> {
  const { method } = request;
  if (pathname === "/v1/invitations") {
    return method === "GET"
      ? Response.json({ invitations: workspaceControl.listPendingInvitations({ email: session.email }) })
      : routeNotFound();
  }

  const invitationResponse = pathname.match(/^\/v1\/invitations\/([^/]+)\/(accept|decline)$/);
  if (invitationResponse && method === "POST") {
    const invitationId = decodeURIComponent(invitationResponse[1]!);
    return Response.json(invitationResponse[2] === "accept"
      ? workspaceControl.acceptInvitation({ invitationId, userId: session.id, userEmail: session.email })
      : workspaceControl.declineInvitation({ invitationId, userEmail: session.email }));
  }

  if (pathname === "/v1/workspaces") {
    if (method === "GET") {
      return Response.json({ workspaces: workspaceControl.listAcceptedWorkspaces({ userId: session.id, userName: session.name }) });
    }
    if (method === "POST") {
      const { name } = await readJsonObject(request);
      if (name !== undefined && (typeof name !== "string" || !name.trim())) return invalidName();
      return Response.json(
        workspaceControl.createWorkspace({ userId: session.id, ...(typeof name === "string" ? { name } : {}) }),
        { status: 201 },
      );
    }
    return routeNotFound();
  }

  const match = pathname.match(/^\/v1\/workspaces\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (!match) return routeNotFound();
  const workspaceId = decodeURIComponent(match[1]!);
  const [resource, resourceId] = [match[2], match[3] === undefined ? undefined : decodeURIComponent(match[3])];
  const userId = session.id;
  switch ([method, resource, resourceId === undefined ? undefined : ":id"].filter(Boolean).join(" ")) {
    case "GET context": {
      const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId });
      return workspace ? Response.json({ workspace }) : forbidden();
    }
    case "POST api-key":
      return Response.json(workspaceControl.rotateApiKey({ workspaceId, userId }));
    case "GET users":
      return Response.json({ users: workspaceControl.listWorkspaceUsers({ workspaceId, userId }) });
    case "POST users :id": {
      const { action } = await readJsonObject(request);
      return Response.json(workspaceControl.applyWorkspaceMemberAction({
        workspaceId,
        actorUserId: userId,
        targetUserId: resourceId!,
        action: typeof action === "string" ? action : "",
      }));
    }
    case "POST leave":
      return Response.json(workspaceControl.leaveWorkspace({ workspaceId, userId, userName: session.name }));
    case "GET invitations":
      return Response.json({ invitations: workspaceControl.listWorkspaceInvitations({ workspaceId, userId }) });
    case "POST invitations": {
      const { email, role } = await readJsonObject(request);
      if (typeof email !== "string" || !email.trim()) return errorResponse(400, "invalid_email", "email must be a non-empty string");
      return Response.json(workspaceControl.createInvitation({
        workspaceId,
        inviterUserId: userId,
        email,
        ...(typeof role === "string" ? { role } : {}),
      }), { status: 201 });
    }
    case "DELETE invitations :id":
      return Response.json(workspaceControl.cancelInvitation({ workspaceId, invitationId: resourceId!, userId }));
    case "GET source-retention": {
      const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId });
      return workspace ? Response.json(sourceRetentionSettings(sourceStorage, workspace)) : forbidden();
    }
    case "PUT source-retention": {
      const { disabled } = await readJsonObject(request);
      if (typeof disabled !== "boolean") return errorResponse(400, "invalid_source_retention", "disabled must be true or false");
      if (disabled === false && sourceStorage.provider === "none") {
        return errorResponse(409, "source_storage_not_configured", "This installation has no storage configured for original documents");
      }
      workspaceControl.setWorkspaceSourceRetention({ workspaceId, userId, disabled });
      const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId });
      return workspace ? Response.json(sourceRetentionSettings(sourceStorage, workspace)) : forbidden();
    }
    case "PATCH": {
      const { name } = await readJsonObject(request);
      if (typeof name !== "string" || !name.trim()) return invalidName();
      return Response.json(workspaceControl.renameWorkspace({ workspaceId, userId, name: name.trim() }));
    }
    case "DELETE":
      if (!workspaceDeletion) return productStoreUnavailable();
      await workspaceDeletion.deleteWorkspace({ workspaceId, userId });
      return Response.json({ ok: true, workspace_id: workspaceId });
    default:
      return routeNotFound();
  }
}

function retainsNewOriginals(sourceStorage: LocalSourceStorageConfiguration, workspace: AuthorizedWorkspace): boolean {
  return sourceStorage.provider !== "none" && sourceStorage.originalRetentionEnabled && !workspace.source_retention_disabled;
}

function sourceRetentionSettings(sourceStorage: LocalSourceStorageConfiguration, workspace: AuthorizedWorkspace) {
  return {
    workspace_id: workspace.id,
    storage_configured: sourceStorage.provider !== "none",
    installation_retains_originals: sourceStorage.originalRetentionEnabled,
    source_retention_disabled: workspace.source_retention_disabled,
    retains_new_originals: retainsNewOriginals(sourceStorage, workspace),
  };
}

/**
 * Streams a retained original. Workspace access is checked on every request; only the product
 * store's retained flag grants retrieval, so processing-only files are never served.
 */
function handleRetainedSourceFileRead({ product, jobId, request }: { product: ProductServices; jobId: string; request: Request }): Promise<Response> {
  const noStore = { "cache-control": "private, no-store" };
  return withAuthorizedProductStore(product, request, async ({ store }) => {
    if (!store.getExtractionJobSummary(jobId)) return errorResponse(404, "not_found", "Job not found", noStore);
    const retained = store.getRetainedSourceFile(jobId);
    if (!retained) return errorResponse(404, "source_not_retained", "The original document was not retained", noStore);
    const unavailable = () => errorResponse(503, "source_unavailable", "The original document is temporarily unavailable", { ...noStore, "retry-after": "5" });
    const headers = new Headers({
      ...noStore,
      "content-type": retained.source_mime_type,
      "content-disposition": attachmentDisposition(retained.source_name, retained.source_mime_type),
      "x-content-type-options": "nosniff",
    });
    if (retained.retained_object_key) {
      const objects = product.sourceObjects;
      if (!objects || objects.activeReads.count >= (objects.maxConcurrentReads ?? 8)) return unavailable();
      objects.activeReads.count += 1;
      let released = false;
      const release = () => { if (!released) { released = true; objects.activeReads.count -= 1; } };
      try {
        const object = await objects.store.open(retained.retained_object_key);
        headers.set("content-length", String(object.size));
        if (request.method === "HEAD") { release(); return new Response(null, { headers }); }
        return new Response(releaseWhenDone(object.stream(), release), { headers });
      } catch (error) {
        release();
        if (error instanceof SourceObjectMissingError) return errorResponse(404, "source_missing", "The original document is missing from storage", noStore);
        console.warn("Retained original could not be read from object storage", error);
        return unavailable();
      }
    }
    let file: Blob | null;
    try {
      if (!product.sourceFileStore.open) throw new Error("Source file store cannot open retained originals");
      file = await product.sourceFileStore.open(retained.source_file_key);
    } catch (error) {
      console.warn("Retained Source file could not be opened", error);
      return unavailable();
    }
    if (!file) return errorResponse(404, "source_missing", "The original document is missing from storage", noStore);
    headers.set("content-length", String(file.size));
    return new Response(request.method === "HEAD" ? null : file.stream(), { headers });
  });
}

/** Releases a read permit when the stream ends, errors or the client disconnects. */
function releaseWhenDone(stream: ReadableStream<Uint8Array>, release: () => void): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { release(); controller.close(); return; }
        controller.enqueue(value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      release();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

class SourceStorageUnavailableError extends Error {}

/**
 * Saves a retained original to object storage before its job is accepted. The manifest entry is
 * recorded first so a crash or late write can always be found and cleaned up.
 */
async function publishRetainedOriginal({ product, workspaceId, jobId, sourceFileKey, sourceMimeType, signal }: {
  product: ProductServices;
  workspaceId: string;
  jobId: string;
  sourceFileKey: string;
  sourceMimeType: string;
  signal: AbortSignal;
}): Promise<string> {
  const objects = product.sourceObjects;
  const file = objects && await product.sourceFileStore.open?.(sourceFileKey);
  if (!objects || !file) {
    await deleteLocalSourceFileQuietly(product.sourceFileStore, sourceFileKey);
    throw new SourceStorageUnavailableError("Object storage is not available for retained originals");
  }
  const objectKey = objects.keyFor({ workspaceId, jobId, mimeType: sourceMimeType });
  objects.manifest.prepare({ objectKey, workspaceId, jobId });
  try {
    await objects.store.put({ key: objectKey, file, mimeType: sourceMimeType });
    signal.throwIfAborted();
  } catch (error) {
    objects.manifest.markDeleting({ objectKey });
    await deleteLocalSourceFileQuietly(product.sourceFileStore, sourceFileKey);
    if (signal.aborted) throw error;
    console.warn("Retained original could not be saved to object storage", error);
    throw new SourceStorageUnavailableError("The original could not be saved");
  }
  return objectKey;
}

const DOWNLOAD_EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function attachmentDisposition(sourceName: string | null, mimeType: string): string {
  const name = sourceName?.trim() || `document.${DOWNLOAD_EXTENSIONS[mimeType] ?? "bin"}`;
  const fallback = name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "_").slice(0, 200) || "document";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  return request.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function ensureStarterTemplate(workspaceControl: LocalWorkspaceControl, store: LocalWorkspaceProductStoreHandle, workspaceId: string): void {
  if (!workspaceControl.hasPendingStarterTemplateBootstrap({ workspaceId })) return;
  store.ensureStarterInvoiceTemplate({ createdAt: nowIso() });
  workspaceControl.completeStarterTemplateBootstrap({ workspaceId });
}

function extractionJobEntityTag(workspaceId: string, job: LocalWorkspaceExtractionJobSummary): string {
  const visibleRepresentation = JSON.stringify([
    "job-v1",
    workspaceId,
    job.job_id,
    job.status,
    job.source_name,
    job.source_mime_type,
    job.source_file_page_count,
    job.source_retained,
    job.template_id,
    job.template_version,
    job.model_name,
    job.error_code,
    job.error_message,
    job.created_at,
    job.updated_at,
    job.completed_at,
    job.current_attempt,
    job.completed_attempt,
    job.last_failed_attempt,
  ]);
  const digest = createHash("sha256").update(visibleRepresentation).digest("hex");
  return `W/"job-v1-${digest}"`;
}

function ifNoneMatchIncludes(value: string | null, currentEntityTag: string): boolean {
  if (!value) return false;
  const candidates = value.match(/(?:W\/)?"[^"\r\n]*"|\*/g) ?? [];
  const normalizedCurrent = currentEntityTag.replace(/^W\//, "");
  return candidates.some((candidate) => candidate === "*" || candidate.replace(/^W\//, "") === normalizedCurrent);
}

function validateJobExportPayload(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "invalid_job_export", "Job export must be an object");
  }
  const jobIds = (input as { job_ids?: unknown }).job_ids;
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    throw new HttpError(400, "invalid_job_export", "Select at least one job to export");
  }
  if (jobIds.length > 500) throw new HttpError(413, "export_too_large", "Select at most 500 Documents per export");
  const normalized = jobIds.map((jobId) => typeof jobId === "string" ? jobId.trim() : "");
  if (normalized.some((jobId) => !jobId)) {
    throw new HttpError(400, "invalid_job_export", "Every exported job ID must be a non-empty string");
  }
  return [...new Set(normalized)];
}

type JobFilters = { dateFrom: string; dateTo: string; model: string };

function normalizeJobFilters({ dateFrom, dateTo, model }: { dateFrom: string | null; dateTo: string | null; model: string | null }): JobFilters {
  const normalizedDateFrom = normalizeJobFilterDate(dateFrom, "date_from");
  const normalizedDateTo = normalizeJobFilterDate(dateTo, "date_to");
  const normalizedModel = (model || "").trim();
  if (normalizedModel.length > 255) {
    throw new HttpError(400, "invalid_job_filters", "model must be 255 characters or fewer");
  }
  if (normalizedDateFrom && normalizedDateTo && normalizedDateFrom > normalizedDateTo) {
    throw new HttpError(400, "invalid_job_filters", "date_from must be on or before date_to");
  }
  return { dateFrom: normalizedDateFrom, dateTo: normalizedDateTo, model: normalizedModel };
}

function normalizeJobFilterDate(value: string | null, parameterName: string): string {
  const normalized = (value || "").trim();
  if (!normalized) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(400, "invalid_job_filters", `${parameterName} must use YYYY-MM-DD`);
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new HttpError(400, "invalid_job_filters", `${parameterName} must be a valid date`);
  }
  return normalized;
}

function encodeJobCursor({ createdAt, filters, jobId, search, secret }: {
  createdAt: string;
  filters: JobFilters;
  jobId: string;
  search: string;
  secret: Uint8Array;
}): string {
  const payload = Buffer.from(JSON.stringify({
    created_at: createdAt,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    job_id: jobId,
    model: filters.model,
    search,
  }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Cursors are signed and bound to the filters they were issued for. */
function decodeJobCursor({ cursor, filters, search, secret }: {
  cursor: string | null;
  filters: JobFilters;
  search: string;
  secret: Uint8Array;
}): { createdAt: string; jobId: string } | null {
  if (!cursor) return null;
  const invalid = () => new HttpError(400, "invalid_cursor", "Job cursor is invalid or does not match these filters");
  const [payload, signature, ...extra] = cursor.split(".");
  if (!payload || !signature || extra.length) throw invalid();
  const signatureBytes = Buffer.from(signature, "base64url");
  const expectedBytes = createHmac("sha256", secret).update(payload).digest();
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) throw invalid();
  let parsed: Record<string, unknown> | null;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (
    !parsed ||
    typeof parsed.created_at !== "string" ||
    typeof parsed.job_id !== "string" ||
    parsed.date_from !== filters.dateFrom ||
    parsed.date_to !== filters.dateTo ||
    parsed.model !== filters.model ||
    parsed.search !== search
  ) {
    throw invalid();
  }
  return { createdAt: parsed.created_at, jobId: parsed.job_id };
}

async function authorizeLocalProductRequest(
  { auth, workspaceControl }: ProductServices,
  request: Request,
): Promise<{ workspace: AuthorizedWorkspace } | { response: Response }> {
  const apiKey = bearerApiKey(request);
  const session = apiKey ? null : await auth.getSession(request);
  const workspaceId = request.headers.get("x-workspace-id")?.trim() || "";
  const workspace = apiKey
    ? workspaceControl.authorizeApiKey({ apiKey })
    : session && workspaceId
      ? workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id })
      : null;
  if (workspace) return { workspace };
  return { response: apiKey || session ? forbidden() : unauthorized() };
}

async function countLocalSourceFilePages(sourceMimeType: string, sourceBytes: ArrayBuffer, signal?: AbortSignal): Promise<number | null> {
  if (sourceMimeType !== "application/pdf") return null;
  try {
    return await countPdfSourceFilePages(sourceBytes, signal);
  } catch (error) {
    if (error instanceof InvalidPdfSourceFileError || error instanceof PdfSourceFileLimitError) {
      throw new HttpError(400, error.code, error.message);
    }
    if (error instanceof PdfSourceFileCapacityError) {
      throw new HttpError(503, error.code, error.message);
    }
    throw error;
  }
}

async function deleteLocalSourceFileQuietly(sourceFileStore: LocalSourceFileStore, sourceFileKey: string): Promise<boolean> {
  try {
    await sourceFileStore.delete(sourceFileKey);
    return true;
  } catch {
    // Document deletion retains durable cleanup intent until a later sweep.
    return false;
  }
}

function recordLocalProductAnalytics(productAnalytics: LocalProductAnalytics | undefined, event: LocalWorkspaceProductAnalyticsEvent): void {
  try {
    productAnalytics?.record(event);
  } catch (error) {
    console.warn("Local product analytics emission failed", error);
  }
}

/** Better Auth only enforces a minimum length; the product requires the full complexity policy. */
async function passwordPolicyFailure(request: Request, url: URL): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  const passwordField = path === "/api/auth/sign-up/email"
    ? "password"
    : ["/api/auth/reset-password", "/api/auth/change-password"].includes(path)
      ? "newPassword"
      : null;
  if (!passwordField) return null;

  const body = await request.clone().json().catch(() => null);
  const password = body && typeof body === "object" ? (body as Record<string, unknown>)[passwordField] : null;
  if (typeof password !== "string" || evaluateAccountPasswordPolicy(password).valid) return null;
  return errorResponse(400, "password_policy_not_met", "Password must meet all complexity requirements.");
}

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

function httpErrorResponse(error: HttpError): Response {
  return errorResponse(error.status, error.code, error.message);
}

const routeNotFound = () => errorResponse(404, "not_found", "Route not found");
const templateNotFound = () => new HttpError(404, "not_found", "Template not found");
const unauthorized = () => errorResponse(401, "unauthorized", "Authentication required");
const forbidden = () => errorResponse(403, "forbidden", "You do not have access to this workspace");
const invalidName = () => errorResponse(400, "invalid_name", "name must be a non-empty string");
const productStoreUnavailable = () =>
  errorResponse(503, "local_product_store_unavailable", "Local Workspace product storage has not finished initializing.");

function workspaceErrorResponse(error: unknown): Response {
  if (!(error instanceof LocalWorkspaceControlError)) return errorResponse(500, "internal_error", "Unexpected server error");
  const status = error.code === "last_workspace" || error.code === "invite_exists" ? 409 : error.code === "not_found" ? 404 : 403;
  return errorResponse(status, error.code, error.message);
}

function workspaceProductDataAccessErrorResponse(error: unknown): Response {
  if (!(error instanceof LocalWorkspaceProductDataAccessError)) throw error;
  const retryable = { "cache-control": "no-store", "retry-after": "1" };
  switch (error.code) {
    case "capacity_exhausted":
      return errorResponse(503, "local_product_store_capacity_unavailable", "Local Workspace product-store capacity is temporarily full", retryable);
    case "store_unavailable":
      return errorResponse(503, "local_product_store_unavailable", "Local Workspace product storage is unavailable.", retryable);
    case "workspace_invalidated":
      return errorResponse(409, "workspace_deleting", "Workspace deletion is in progress");
    case "workspace_deleting":
    case "job_deleting":
      return errorResponse(409, error.code, error.message);
    default:
      return errorResponse(500, "internal_error", "Unexpected server error");
  }
}
