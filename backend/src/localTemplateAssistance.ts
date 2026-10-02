import { rm } from "node:fs/promises";
import { diagnoseTemplateDraft, templateColumns } from "../../shared/templateAssistant";
import { assistTemplate, ASSISTANCE_LIMITS, suggestTemplateRequests } from "./consumer/templateAssistance";
import { ExtractionCancelledError, ModelGatewayRequestError, RetryableError } from "./consumer/modelGateway";
import { HttpError } from "./lib/http";
import { validateSourceFileMetadata } from "./lib/validation";
import { countLocalSourceFilePages, withAuthorizedProductStore, type ProductServices } from "./localApplication";
import { parseLocalMultipartSubmission } from "./localMultipartSubmission";
import type { LocalWorkspaceProductStoreHandle } from "./localWorkspaceProductStoreRegistry";
import { LocalWorkspaceOperationError, type LocalWorkspaceProductOperation } from "./localWorkspaceProductOperations";
import { SourceObjectMissingError } from "./s3SourceObjectStore";
import { assistantModelEnvironment, configurationMissing, createWorkspaceCredentialVault } from "./workspaceModelConfiguration";

const noStore = { "cache-control": "no-store" };
const invalid = (message: string) => new HttpError(400, "invalid_template_assistance", message);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value);

function validateAssistanceDraft(draft: unknown) {
  if (!object(draft)) throw invalid("draft must be a Template draft object; incomplete fields are supported");
  if (Buffer.byteLength(JSON.stringify(draft)) > ASSISTANCE_LIMITS.draftBytes) throw invalid("The draft exceeds the 64 KiB assistance limit");
  if (Array.isArray(draft.fields)) {
    if (draft.fields.length > 100) throw invalid("Diagnose at most 100 draft fields per assistance request; reduce the draft first");
    let totalColumns = 0;
    for (const field of draft.fields) {
      const count = templateColumns(field).length;
      if (count > 100) throw invalid("Diagnose at most 100 columns per draft field; reduce the draft first");
      totalColumns += count;
    }
    if (totalColumns > 200) throw invalid("Diagnose at most 200 draft columns across all fields; reduce the draft first");
  }
  if (Buffer.byteLength(JSON.stringify(diagnoseTemplateDraft(draft))) > 128 * 1024) throw invalid("This draft produces too many diagnostics for one assistance request. Resolve some highlighted errors before requesting assistance.");
}

type SuggestionRequest = { draft: unknown; action: "explain" | "edit"; jobId?: string; sampleName?: string };
export function validateSuggestionRequest(value: unknown): SuggestionRequest {
  if (!object(value) || Object.keys(value).some((key) => !["draft", "action", "jobId", "sampleName"].includes(key))) throw invalid("Unsupported suggestion request properties");
  validateAssistanceDraft(value.draft);
  if (value.action !== "explain" && value.action !== "edit") throw invalid("action must be explain or edit");
  if (value.jobId !== undefined && !identifier(value.jobId)) throw invalid("jobId must identify one completed Extraction job");
  if (value.sampleName !== undefined && (typeof value.sampleName !== "string" || value.sampleName.length > 255)) throw invalid("sampleName must be at most 255 characters");
  return value as SuggestionRequest;
}

type AssistanceRequest = { draft: unknown; action: "explain" | "edit"; instructions: string; base: Record<string, unknown>; jobId?: string; useRetainedSource?: boolean };
export function validateAssistanceRequest(raw: string): AssistanceRequest {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalid("payload must contain valid JSON"); }
  if (!object(value) || Object.keys(value).some((key) => !["draft", "action", "instructions", "base", "jobId", "useRetainedSource"].includes(key))) throw invalid("Unsupported assistance request properties");
  validateAssistanceDraft(value.draft);
  if (value.action !== "explain" && value.action !== "edit") throw invalid("action must be explain or edit");
  if (typeof value.instructions !== "string" || Buffer.byteLength(value.instructions) > ASSISTANCE_LIMITS.instructionsBytes) throw invalid("instructions must be at most 4 KiB");
  if (value.action === "edit" && !value.instructions.trim()) throw invalid("Describe the change you want to make");
  const base = value.base;
  if (!object(base) || Object.keys(base).sort().join(",") !== ["editorId", "requestId", "revision", "scopeGeneration", "templateId"].sort().join(",")
    || !identifier(base.editorId) || typeof base.templateId !== "string" || base.templateId.length > 160
    || [base.requestId, base.revision, base.scopeGeneration].some((item) => !Number.isSafeInteger(item) || (item as number) < 0)) throw invalid("base must identify the editor, Template, revision, request, and scope generation");
  if (value.jobId !== undefined && !identifier(value.jobId)) throw invalid("jobId must identify one completed Extraction job");
  if (value.useRetainedSource !== undefined && typeof value.useRetainedSource !== "boolean") throw invalid("useRetainedSource must be a boolean");
  if (value.useRetainedSource && !value.jobId) throw invalid("Select a completed job before using its retained Source");
  return value as AssistanceRequest;
}

function evidenceSnapshot(store: LocalWorkspaceProductStoreHandle, jobId: string) {
  let job;
  try { job = store.getTemplateAssistantEvidence(jobId, ASSISTANCE_LIMITS.evidenceBytes); }
  catch (error) { if (error instanceof RangeError) throw new HttpError(413, "template_assistance_evidence_too_large", error.message); throw error; }
  if (!job) throw new HttpError(404, "template_assistance_evidence_unavailable", "The selected completed job is no longer available in this Workspace. Retry or explicitly remove it.");
  const evidence = { job_id: job.job_id, original_filename: job.source_name, template_id: job.template_id, template_name: job.template_name,
    template_version: job.template_version, fields: job.fields, results: job.results, source_available: job.source_retained };
  if (Buffer.byteLength(JSON.stringify(evidence)) > ASSISTANCE_LIMITS.evidenceBytes) throw new HttpError(413, "template_assistance_evidence_too_large", "The selected results exceed the 128 KiB assistance evidence limit. Choose a smaller result or explicitly remove it.");
  return evidence;
}

/** Reads only through an authorized retained-source record; never promotes, removes, or changes retention. */
async function retainedSource(product: ProductServices, store: LocalWorkspaceProductStoreHandle, jobId: string, maximumBytes: number, signal: AbortSignal, probe = false): Promise<{ blob?: Blob; mimeType: string }> {
  const source = store.getRetainedSourceFile(jobId);
  if (!source) throw new HttpError(404, "source_not_retained", "This job's original Source was not retained. Choose result-only analysis or upload a sample.");
  try {
    if (source.retained_object_key) {
      const objects = product.sourceObjects;
      if (!objects || objects.activeReads.count >= (objects.maxConcurrentReads ?? 8)) throw new Error("Source unavailable");
      objects.activeReads.count += 1;
      try {
        const remote = await objects.store.open(source.retained_object_key);
        signal.throwIfAborted();
        validateSourceFileMetadata(source.source_mime_type, remote.size, maximumBytes);
        if (probe) return { mimeType: source.source_mime_type };
        const reader = remote.stream().getReader();
        const abort = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener("abort", abort, { once: true });
        try {
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximumBytes) throw new HttpError(400, "source_file_too_large", "The retained Source exceeds the current source size limit");
            chunks.push(value);
          }
          signal.throwIfAborted();
          if (size !== remote.size) throw new Error("Source changed while reading");
          return { blob: new Blob([Buffer.concat(chunks)]), mimeType: source.source_mime_type };
        } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } finally { objects.activeReads.count -= 1; }
    }
    const file = await product.sourceFileStore.open?.(source.source_file_key);
    signal.throwIfAborted();
    if (!file) throw new SourceObjectMissingError();
    validateSourceFileMetadata(source.source_mime_type, file.size, maximumBytes);
    return { ...(probe ? {} : { blob: file }), mimeType: source.source_mime_type };
  } catch (error) {
    if (signal.aborted) throw new ExtractionCancelledError("Evidence loading cancelled");
    if (error instanceof HttpError) throw error;
    if (error instanceof SourceObjectMissingError) throw new HttpError(404, "source_missing", "The retained Source is missing. Retry or explicitly choose result-only analysis.");
    throw new HttpError(503, "source_unavailable", "The retained Source is temporarily unavailable. Retry or explicitly choose result-only analysis.");
  }
}

/** Suggested requests for the open draft: one text-only model call that never reads Source files. */
export async function handleTemplateSuggestions({ product, request, modelGatewayRequestTimeoutMs }: {
  product: ProductServices; request: Request; modelGatewayRequestTimeoutMs: string;
}): Promise<Response> {
  const response = await withAuthorizedProductStore(product, request, async ({ store, signal: workspaceSignal, workspace }) => {
    let jobOperation: LocalWorkspaceProductOperation | undefined;
    const timeoutMs = Math.max(1, Math.min(60_000, Number(modelGatewayRequestTimeoutMs) || 60_000));
    let signal = AbortSignal.any([request.signal, workspaceSignal, AbortSignal.timeout(timeoutMs)]);
    try {
      let body: unknown;
      try { body = await request.json(); } catch { throw invalid("Request body must be valid JSON"); }
      const input = validateSuggestionRequest(body);
      const configuration = store.getModelConfiguration();
      if (!configuration) throw configurationMissing();
      if (input.jobId) {
        jobOperation = product.operations.acquire({ workspaceId: workspace.id, jobId: input.jobId });
        signal = AbortSignal.any([signal, jobOperation.signal]);
      }
      const job = input.jobId ? evidenceSnapshot(store, input.jobId) : null;
      const credential = createWorkspaceCredentialVault(product.stateDirectory).decrypt(workspace.id, configuration.credential_ciphertext);
      const suggestions = await suggestTemplateRequests(assistantModelEnvironment(configuration, { credential, workspaceId: workspace.id, requestTimeoutMs: modelGatewayRequestTimeoutMs }), { draft: input.draft, action: input.action, evidence: { job, attachedSampleName: input.sampleName ?? null, note: "Only the sample's name is supplied, not its contents." } }, signal);
      if (signal.aborted) throw new ExtractionCancelledError("Template suggestions cancelled");
      return Response.json({ source: "model", suggestions: suggestions.map((suggestion, index) => ({ id: `model-${index}`, ...suggestion })) }, { headers: noStore });
    } catch (error) {
      if (signal.aborted || error instanceof ExtractionCancelledError) return fail(499, "template_suggestions_cancelled", "Suggestions were cancelled or reached their deadline.");
      if (error instanceof HttpError) return fail(error.status, error.code, error.message);
      if (error instanceof LocalWorkspaceOperationError) return fail(409, "template_assistance_evidence_unavailable", "The selected Workspace or job is being deleted.");
      if (error instanceof ModelGatewayRequestError || error instanceof RetryableError) return fail(502, "template_suggestions_failed", "The configured model could not suggest requests.");
      return fail(500, "template_suggestions_failed", "Suggestions failed.");
    } finally { jobOperation?.release(); }
  });
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function handleTemplateAssistance({ product, request, maxSourceFileBytes, modelGatewayRequestTimeoutMs, evidenceJobId }: {
  product: ProductServices; request: Request; maxSourceFileBytes: number; modelGatewayRequestTimeoutMs: string; evidenceJobId?: string;
}): Promise<Response> {
  const response = await withAuthorizedProductStore(product, request, async ({ store, signal: workspaceSignal, workspace }) => {
    let temporaryPath: string | undefined;
    let jobOperation: LocalWorkspaceProductOperation | undefined;
    const timeoutMs = Math.max(1, Math.min(300_000, Number(modelGatewayRequestTimeoutMs) || 300_000));
    let signal = AbortSignal.any([request.signal, workspaceSignal, AbortSignal.timeout(timeoutMs)]);
    try {
      const maximumBytes = workspace.max_source_file_bytes ?? maxSourceFileBytes;
      if (request.method === "GET") {
        if (evidenceJobId) {
          jobOperation = product.operations.acquire({ workspaceId: workspace.id, jobId: evidenceJobId });
          signal = AbortSignal.any([signal, jobOperation.signal]);
          const evidence = evidenceSnapshot(store, evidenceJobId);
          let source_limitation: string | undefined;
          try { await retainedSource(product, store, evidenceJobId, maximumBytes, signal, true); }
          catch (error) { if (signal.aborted) throw error; evidence.source_available = false; source_limitation = error instanceof HttpError ? error.message : "Source unavailable"; }
          if (signal.aborted) throw new ExtractionCancelledError("Evidence loading cancelled");
          if (!store.getExtractionJobSummary(evidenceJobId)) throw new HttpError(404, "template_assistance_evidence_unavailable", "The selected job is no longer available. Retry or explicitly remove it.");
          return Response.json({ ...evidence, source_limitation }, { headers: noStore });
        }
        const params = new URL(request.url).searchParams;
        const limit = Number(params.get("limit") ?? 20);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid("Evidence page limit must be between 1 and 50");
        let cursor: { createdAt: string; jobId: string } | undefined;
        const rawCursor = params.get("cursor");
        if (rawCursor) {
          if (rawCursor.length > 512) throw invalid("Invalid evidence page cursor");
          try { cursor = JSON.parse(Buffer.from(rawCursor, "base64url").toString()); } catch { throw invalid("Invalid evidence page cursor"); }
          if (!cursor || Object.keys(cursor).sort().join(",") !== "createdAt,jobId" || !identifier(cursor.jobId) || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))) throw invalid("Invalid evidence page cursor");
        }
        const jobs = store.listExtractionJobs({ status: "completed", limit: limit + 1, cursor });
        const hasMore = jobs.length > limit;
        const page = jobs.slice(0, limit);
        const last = page.at(-1);
        return Response.json({ jobs: page.map((job) => ({ job_id: job.job_id, original_filename: job.source_name, template_id: job.template_id, template_version: job.template_version, completed_at: job.completed_at, source_available: job.source_retained })),
          next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, jobId: last.job_id })).toString("base64url") : null }, { headers: noStore });
      }
      const configuration = store.getModelConfiguration();
      if (!configuration) throw configurationMissing();
      const credential = createWorkspaceCredentialVault(product.stateDirectory).decrypt(workspace.id, configuration.credential_ciphertext);
      const multipart = await parseLocalMultipartSubmission({ request: new Request(request, { signal }), stateDirectory: product.stateDirectory, maxSourceFileBytes: maximumBytes, purpose: "template-assistance" });
      temporaryPath = multipart.source?.temporaryPath;
      const input = validateAssistanceRequest(multipart.payload!);
      if (multipart.source && input.useRetainedSource) throw invalid("Choose one binary source: an uploaded sample or the job's retained Source");
      if (input.jobId) {
        jobOperation = product.operations.acquire({ workspaceId: workspace.id, jobId: input.jobId });
        signal = AbortSignal.any([signal, jobOperation.signal]);
      }
      const evidence = input.jobId ? evidenceSnapshot(store, input.jobId) : null;
      let source = multipart.source ? { blob: Bun.file(multipart.source.temporaryPath) as Blob, mimeType: multipart.source.mimeType } : undefined;
      if (input.useRetainedSource) {
        const loaded = await retainedSource(product, store, input.jobId!, maximumBytes, signal);
        source = { blob: loaded.blob!, mimeType: loaded.mimeType };
      }
      if (source?.mimeType === "application/pdf") await countLocalSourceFilePages(source.mimeType, await source.blob.arrayBuffer(), signal);
      const provenance = source ? (input.useRetainedSource ? "retained_source_of_selected_job" : "separate_uploaded_sample") : "no_binary_source_supplied";
      const suppliedEvidence = { job: evidence, source: provenance, sample_name: multipart.source?.name ?? (input.useRetainedSource ? evidence?.original_filename : null), limitation: source ? null : "No binary Source was supplied. Results are model output, not ground truth." };
      const output = await assistTemplate(assistantModelEnvironment(configuration, { credential, workspaceId: workspace.id, requestTimeoutMs: modelGatewayRequestTimeoutMs }), { draft: input.draft, action: input.action, instructions: input.instructions, evidence: suppliedEvidence, source,
        evidenceContext: { sampleSupplied: Boolean(source), resultFields: evidence?.fields, result: evidence ? Object.fromEntries(evidence.results.map((row) => [row.field_id, row.answer])) : undefined } }, signal);
      if (signal.aborted) throw new ExtractionCancelledError("Template assistance cancelled");
      if (input.jobId && !store.getExtractionJobSummary(input.jobId)) throw new HttpError(404, "template_assistance_evidence_unavailable", "The selected evidence disappeared. Retry or explicitly remove it.");
      return Response.json({ base: input.base, diagnostics: diagnoseTemplateDraft(input.draft), evidence: suppliedEvidence, ...output }, { headers: noStore });
    } catch (error) {
      if (signal.aborted || error instanceof ExtractionCancelledError) return fail(499, "template_assistance_cancelled", "Template assistance was cancelled or reached its deadline. Your draft is unchanged.");
      if (error instanceof HttpError) return fail(error.status, error.code, error.message);
      if (error instanceof LocalWorkspaceOperationError) return fail(409, "template_assistance_evidence_unavailable", "The selected Workspace or job is being deleted. Retry or explicitly remove that evidence.");
      if (error instanceof ModelGatewayRequestError || error instanceof RetryableError) return fail(502, "template_assistance_failed", "The configured model could not complete assistance. Check Workspace model configuration or try again; your draft is unchanged.");
      return fail(500, "template_assistance_failed", "Template assistance failed. Retry; your draft is unchanged.");
    } finally { if (temporaryPath) await rm(temporaryPath, { force: true }); jobOperation?.release(); }
  });
  response.headers.set("cache-control", "no-store");
  return response;
}
function fail(status: number, code: string, message: string) { return Response.json({ error: { code, message } }, { status, headers: noStore }); }
