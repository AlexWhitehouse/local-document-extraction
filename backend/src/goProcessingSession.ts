import type { LocalProcessingCapacity } from "./localExtractionQueue";
import type { LocalProductAnalytics } from "./localProductAnalytics";
import { commitProductWrite } from "./localProductWriteBatch";
import { join, basename } from "node:path";
import { stat } from "node:fs/promises";
import { isJsonObject, isJsonArray, isString, isNumber, parseJson, type JsonValue, type JsonObject } from "../../shared/json";
import { nowIso, newId } from "./lib/ids";
import { HttpError } from "./lib/http";
import { extractionRetryDelay, EXTRACTION_MAX_ATTEMPTS } from "./extractionRetryPolicy";
import {
  buildExtractionRequest, buildChatCompletionsUrl, buildModelResponseFormat, parseExtractionContent,
  readRunResultContent, type ModelRequest, type ModelGatewayConfiguration,
} from "./consumer/modelGateway";
import {
  CLASSIFICATION_RULES, SPLIT_RULES, classificationSchema, splitSchema, candidateMetadata, feedback,
  validateDocumentClassification, validateSplitPlan, DocumentAssessmentValidationError,
  record, keys, explanation, evidence,
} from "./consumer/documentAssessment";
import { readModelCallUsage, type ModelCallObserver, type ModelCallUsage } from "./consumer/modelUsage";
import { normalizeModelResults } from "./consumer/modelResultNormalizer";
import { verifyPdfBlankPages, withPdfOperationCapacity, PdfPageSelectionError } from "./lib/pdfPageOperations";
import { classificationModelEnvironment, classificationModelOf, configurationMissing, createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import type { LocalWorkspaceProductStoreHandle } from "./localWorkspaceProductStoreRegistry";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalSourceFileStore } from "./localSourceFileStore";
import type { LocalRetainedSourceObjects } from "./localApplication";
import type { LocalWorkspaceExtractionJobSummary, LocalClaimedExtractionJob } from "./localWorkspaceProductStore";
import type { PacketChildSlot, DocumentRouting, DocumentPacket } from "./localDocumentProcessingStore";

export type GoProcessingContext = {
  capacity?: LocalProcessingCapacity;
  job: LocalQueuedExtractionJob;
  store: LocalWorkspaceProductStoreHandle;
  signal: AbortSignal;
};

export type GoProcessingOptions = {
  now?: () => string;
  random?: () => number;
  maxAttempts?: number;
  maxRetryDelayMs?: number;
  productAnalytics?: LocalProductAnalytics;
  stateDirectory: string;
  sourceFiles: LocalSourceFileStore;
  sourceObjects?: LocalRetainedSourceObjects;
  timeoutMs: number;
  retryDelayMs: number;
  schedule(job: LocalQueuedExtractionJob): void | Promise<void>;
  notify(workspaceId: string, job: LocalWorkspaceExtractionJobSummary): void;
  /** When false, job summaries are not built for notify; completion is still reported. */
  observes?(workspaceId: string): boolean;
  completed?(workspaceId: string): void;
  outcome(outcome: "success" | "failed" | "throttled" | "timeout"): void;
};

/** The adapter owns authoritative product mutations. Go owns execution and byte transport.
 * The lease and deletion signal span the entire run, just as in the Bun processor.
 */
export function createGoProcessingSession(context: GoProcessingContext, options: GoProcessingOptions, directory: string) {
  const { job, store, signal } = context;
  const now = options.now ?? nowIso;
  const ownerId = job.job_id;
  const workspaceId = job.workspace_id;
  const attempt = job.attempt ?? 1;
  const vault = createWorkspaceCredentialVault(options.stateDirectory);
  let sourceByteSize = 0;
  let modelCallStarted = false;
  let sourceView: { pages?: number[]; identity: string } | null = null;
  let virtualChildren = false;
  let routing: DocumentRouting | null = null;
  let packet: DocumentPacket | null = null;
  let claimed: LocalClaimedExtractionJob | null = null;
  let children: PacketChildSlot[] = [];
  let observer: ModelCallObserver | null = null;
  let model: { modelName: string; route: string } | null = null;
  const receipts = new Map<string, ModelCallObserver>();
  let pendingUsage: { id: string; observer: ModelCallObserver; usage: ModelCallUsage } | null = null;
  // The stage most recently claimed through "next", for failures reported without one.
  let currentStage = "";

  const write = async <T>(operation: () => T): Promise<T> => {
    const usage = pendingUsage;

    const result = await commitProductWrite(store, signal, () => {
      if (usage) usage.observer.finished(usage.id, usage.usage);

      return operation();
    });

    if (usage && pendingUsage === usage) {
      receipts.delete(usage.id);
      pendingUsage = null;
    }

    return result;
  };

  const notify = (id = ownerId) => {
    if (options.observes?.(workspaceId) === false) return;
    const summary = store.getExtractionJobSummary(id);

    if (summary) {
      try { options.notify(workspaceId, summary); }
      catch { /* Live-update observers cannot change a durable outcome. */ }
    }
  };

  const outcome = (value: Parameters<GoProcessingOptions["outcome"]>[0]) => {
    try { options.outcome(value); }
    catch { /* Diagnostics cannot change processing outcomes. */ }
  };

  const sourcePath = async () => {
    const source = store.getProcessingSource(ownerId);

    if (!source) throw new Error("Document source unavailable");

    const resolved = options.sourceFiles.resolveProcessingSource
      ? await options.sourceFiles.resolveProcessingSource(source.source_file_key)
      : { path: join(options.stateDirectory, "source-files", source.source_file_key), identity: source.source_file_key };

    sourceView = resolved;
    const path = resolved.path;

    if (await Bun.file(path).exists()) return path;

    if (source.retained_object_key && options.sourceObjects) {
      const remote = await options.sourceObjects.store.open(source.retained_object_key);

      if (remote.size > 32 * 1024 * 1024) throw new Error("Source exceeds processing limit");
      const restored = join(directory, "restored-source");
      let received = 0;

      const bounded = remote.stream().pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;

          if (received > 32 * 1024 * 1024) throw new Error("Source exceeds processing limit");
          controller.enqueue(chunk);
        },
      }), { signal });

      await Bun.write(restored, new Response(bounded));
      signal.throwIfAborted();

      return restored;
    }

    throw new HttpError(404, "missing_source_file", "Source file is missing from local storage");
  };

  const environment = (stage: "extraction" | "auto_template" | "split") => {
    const config = store.getModelConfiguration();

    if (!config) throw configurationMissing();
    const credential = vault.decrypt(workspaceId, config.credential_ciphertext);
    const selected = stage === "extraction" ? config : classificationModelOf(config);

    const env: ModelGatewayConfiguration = stage === "extraction" ? {
      AI_MODEL: config.model_name,
      MODEL_GATEWAY_URL: config.gateway_url,
      MODEL_SUPPORTS_PDF_INPUT: String(config.supports_pdf_input),
      MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(config.supports_structured_output),
      MODEL_GATEWAY_SEQUENTIAL_CALLS: String(config.sequential_calls),
      LITELLM_KEY: credential,
    } : classificationModelEnvironment(config, { credential, workspaceId, requestTimeoutMs: String(options.timeoutMs) });

    observer = store.modelCallObserver({ ownerId, stage, model: selected.model_name, configurationRevision: config.revision, now });
    model = { modelName: selected.model_name, route: new URL(selected.gateway_url).hostname };

    return { env, snapshot: { revision: config.revision, model_name: selected.model_name, gateway_url: selected.gateway_url, supports_pdf_input: selected.supports_pdf_input, supports_structured_output: selected.supports_structured_output, sequential_calls: selected.sequential_calls }, revision: config.revision };
  };

  const descriptor = async (env: ModelGatewayConfiguration, request: ModelRequest, mime: string, marker: string, pages?: number[]) => {
    const body = JSON.stringify(request);
    const sourceMarker = JSON.stringify({ type: "text", text: marker });
    const index = body.indexOf(sourceMarker);

    if (index < 0) throw new Error("Model source marker missing");

    const source = await sourcePath();
    sourceByteSize = (await stat(source)).size;
    const render = mime === "application/pdf" && env.MODEL_SUPPORTS_PDF_INPUT !== "true";
    const pageCount = store.getProcessingSource(ownerId)?.source_file_page_count ?? undefined;
    let selected = sourceView?.pages ? (pages ? pages.map((page) => sourceView!.pages![page - 1]!) : sourceView.pages) : pages;

    // Every page in order is the original file, so a PDF-input model needs no subset
    // copy. Rendering keeps the page list, which keys the shared page cache.
    if (!render && !sourceView?.pages && selected && selected.length === pageCount && selected.every((page, index) => page === index + 1)) selected = undefined;

    return {
      url: buildChatCompletionsUrl(env), credential: env.LITELLM_KEY,
      prefix: body.slice(0, index), suffix: body.slice(index + sourceMarker.length),
      source, mime, pages: selected,
      // Lets Go split long whole-document renders across PDF workers.
      page_count: selected ? undefined : pageCount,
      cache_id: sourceView?.identity ?? source,
      render,
      sequential: env.MODEL_GATEWAY_SEQUENTIAL_CALLS === "true",
      timeout_ms: options.timeoutMs,
      maximum_response_bytes: job.kind === "packet" || !claimed ? 192 * 1024 : 32 * 1024 * 1024,
    };
  };

  const assessment = (env: ModelGatewayConfiguration, rules: string, input: JsonObject, schema: JsonObject, name: string, mime: string, pages?: number[]) => {
    const marker = newId("source");

    const request: ModelRequest = {
      model: env.AI_MODEL!,
      messages: [
        { role: "system", content: `${rules}\nOutput contract:\n${JSON.stringify(schema)}` },
        { role: "user", content: [{ type: "text", text: JSON.stringify(input) }, { type: "text", text: marker }] },
      ],
    };

    if (env.MODEL_SUPPORTS_STRUCTURED_OUTPUT === "true") request.response_format = buildModelResponseFormat(request.model, name, schema);

    return descriptor(env, request, mime, marker, pages);
  };

  const cleanup = async () => {
    const source = store.getProcessingSource(ownerId);

    if (!source || (source.source_retained && !source.retained_object_key)) return;

    try {
      await options.sourceFiles.delete(source.source_file_key);
      await write(() => store.markSourceFileCleaned({ jobId: ownerId, sourceFileKey: source.source_file_key, cleanedAt: now() }));
    } catch {
      // The durable retention sweep retries interrupted cleanup.
    }
  };

  const parsedAssessment = (body: JsonValue) => {
    const content = readRunResultContent(body);

    if (Buffer.byteLength(content) > 64 * 1024) throw new DocumentAssessmentValidationError("Assessment exceeds the response limit");

    try { return parseJson(content); } catch { throw new DocumentAssessmentValidationError("Assessment must be valid JSON without markdown fences"); }
  };

  const execute = async (operation: string, body: JsonValue): Promise<JsonObject> => {
    signal.throwIfAborted();
    const payload = isJsonObject(body) ? body : {};
    const updatedAt = now();

    switch (operation) {
      case "capacity/suspend":
        context.capacity?.suspend();

        return {};
      case "capacity/resume":
        await context.capacity?.resume();
        signal.throwIfAborted();

        return {};
      case "next": {
        let stage: "split" | "route" | "extract" | "materialize";

        if (job.kind === "packet") {
          const current = store.getDocumentPacket(ownerId);

          if (current?.status === "completed" && current.outcome === "no_documents") await cleanup();

          if (!current || ["awaiting_review", "failed", "processing_children", "completed"].includes(current.status)) return { stage: "done" };
          stage = current.plan_accepted ? "materialize" : "split";
        } else {
          const current = store.getExtractionJobSummary(ownerId);

          if (!current || ["awaiting_template", "failed", "completed"].includes(current.status)) return { stage: "done" };
          stage = current.template_id == null ? "route" : "extract";
        }

        currentStage = stage;

        return { stage, task: await execute(`${stage}/claim`, null) };
      }

      case "route/claim": {
        const current = store.getDocumentRouting(ownerId);

        if (!current) return { done: true };
        const candidates = store.getRoutingCandidates(current.template_tags);

        if (current.routing_rounds >= 3 || !candidates.length || candidates.length > 100) {
          const reason = current.routing_rounds >= 3
            ? current.selection_reason || "Automatic template selection remains unresolved after reassessment."
            : !candidates.length ? "No eligible templates match the supplied tags. Select a template to continue." : "Too many templates match the supplied tags. Select a template to continue.";

          store.holdDocumentRouting({ jobId: ownerId, reason, evidence: current.evidence, updatedAt });
          notify();

          return { done: true };
        }

        const { env, snapshot } = environment("auto_template");
        routing = await write(() => store.claimRoutingRound({ jobId: ownerId, updatedAt, configurationSnapshot: snapshot }));

        if (!routing) return { done: true };
        notify();
        const projected = candidateMetadata(routing.candidates.map((c) => ({ id: c.id, name: c.name, description: c.description ?? "" })));
        const previous = routing.selection_reason ? feedback({ reason: routing.selection_reason, evidence: routing.evidence }) : undefined;
        const input: JsonObject = { candidates: projected, task: previous ? "Resolve the prior uncertainty using the attached source evidence" : "Choose the best fitting candidate for this document" };

        if (previous) input.previous = { ...previous };

        return assessment(env, CLASSIFICATION_RULES, input, classificationSchema(projected.map((c) => c.id)), "document_classification", store.getProcessingSource(ownerId)!.source_mime_type);
      }

      case "route/complete": {
        outcome("success");

        if (!routing) throw new Error("No claimed routing round");
        let result;

        try { result = validateDocumentClassification(parsedAssessment(body), routing.candidates.map((c) => ({ ...c, description: c.description ?? "" }))); }
        catch (error) {
          if (!(error instanceof DocumentAssessmentValidationError) && !(error instanceof PdfPageSelectionError)) throw error;
          result = { status: "uncertain", template_id: null, reason: error.message, evidence: [] };
        }

        const round = routing.routing_rounds;
        await write(() => {
          if (!store.recordRoutingAssessment({ jobId: ownerId, round, reason: result.reason, evidence: result.evidence, updatedAt })) return;

          if (result.status === "selected" && result.template_id) {
            if (!store.bindDocumentTemplate({ jobId: ownerId, templateId: result.template_id, expectedRound: round, updatedAt }))
              store.recordRoutingAssessment({ jobId: ownerId, round, reason: "The selected template changed or no longer matches the supplied tags. Reassess the current candidates.", evidence: [], updatedAt });
          } else if (result.status === "no_match") store.holdDocumentRouting({ jobId: ownerId, reason: result.reason, evidence: result.evidence, updatedAt });
        });
        notify();

        return {};
      }

      case "split/claim": {
        const current = store.getDocumentPacket(ownerId);

        if (!current) return { done: true };

        if (current.assessment_rounds >= 3) {
          store.holdDocumentPacket({ packetId: ownerId, reason: current.reason || "Document boundaries remain uncertain after reassessment.", updatedAt });

          return { done: true };
        }

        const { env, snapshot } = environment("split");
        packet = await write(() => store.claimPacketRound({ packetId: ownerId, updatedAt, configurationSnapshot: snapshot }));

        if (!packet) return { done: true };

        if (packet.selected_pages.length > 128) throw new Error("PDF selection exceeds automatic assessment limit");
        const previous = packet.reason ? feedback({ reason: packet.reason, evidence: packet.evidence }) : undefined;
        const input: JsonObject = { pages: packet.selected_pages.map((page, index) => ({ attachment_page: index + 1, original_page: page })), excludeBlankPages: packet.processing_policy.enable_smart_splitting && packet.processing_policy.exclude_blank_pages };

        if (previous) input.previous = { ...previous };

        return assessment(env, SPLIT_RULES, input, splitSchema, "document_split", "application/pdf", packet.selected_pages);
      }

      case "split/complete": {
        outcome("success");

        if (!packet) throw new Error("No claimed split round");
        let result;

        try {
          const value = record(parsedAssessment(body));
          keys(value, ["status", "groups", "exclusions", "reason", "evidence"]);

          if (value.status !== "resolved" && value.status !== "uncertain") throw new DocumentAssessmentValidationError("Unknown split assessment status");
          const plan = validateSplitPlan(value.groups, value.exclusions, packet.selected_pages, packet.processing_policy.exclude_blank_pages);
          const observations = evidence(value.evidence);

          if (value.status === "resolved" && !observations.length) throw new DocumentAssessmentValidationError("A resolved split plan requires document evidence");

          if (plan.exclusions.length) {
            const path = await sourcePath();
            const blank = new Set(await withPdfOperationCapacity(() => verifyPdfBlankPages(path, plan.exclusions.map((exclusion) => exclusion.page), signal), signal));

            if (plan.exclusions.some((exclusion) => !blank.has(exclusion.page))) throw new DocumentAssessmentValidationError("Proposed blank exclusions contain visible content, text, or annotations; retain those pages and reassess their placement");
          }

          result = { status: value.status, ...plan, reason: explanation(value.reason, "Split assessment reason"), evidence: observations };
        } catch (error) {
          if (!(error instanceof DocumentAssessmentValidationError) && !(error instanceof PdfPageSelectionError)) throw error;
          result = { status: "uncertain", groups: [], exclusions: [], reason: error.message, evidence: [] };
        }

        const round = packet.assessment_rounds;

        const accepted = await write(() => {
          if (!store.recordPacketAssessment({ packetId: ownerId, round, ...result, updatedAt }) || result.status !== "resolved") return null;
          const current = store.getDocumentPacket(ownerId);

          return current ? store.acceptDocumentPacketPlan({ packetId: ownerId, revision: current.plan_revision, expectedRound: round, groups: result.groups, exclusions: result.exclusions, updatedAt }) : null;
        });

        if (accepted && !accepted.child_slots.length) await cleanup();

        return {};
      }

      case "materialize/claim": {
        packet = store.getDocumentPacket(ownerId);
        children = packet?.child_slots.filter((slot) => slot.state === "reserved") ?? [];

        virtualChildren = Boolean(options.sourceFiles.createPdfView && !store.getProcessingSource(ownerId)?.retained_object_key);

        return { source: await sourcePath(), groups: children.map((slot) => slot.pages), virtual: virtualChildren };
      }

      case "materialize/complete": {
        const artifacts = payload.artifacts;

        if (!virtualChildren && (!isJsonArray(artifacts) || artifacts.length !== children.length)) throw new Error("Invalid materialized children");

        for (let index = 0; index < children.length; index++) {
          signal.throwIfAborted();
          const slot = children[index]!;
          let temporaryPath = "";

          if (!virtualChildren) {
            const artifact = isJsonArray(artifacts) ? artifacts[index] : null;

            if (!isString(artifact) || basename(artifact) !== artifact || !/^artifact-[a-zA-Z0-9]+$/.test(artifact)) throw new Error("Invalid child artifact");
            temporaryPath = join(directory, artifact);
            const info = await stat(temporaryPath);

            if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("Invalid child artifact size");
          }

          const sourceFileKey = `workspaces/${workspaceId}/jobs/${slot.job_id}/source.${virtualChildren ? "view" : "pdf"}`;

          if (!await write(() => store.reservePacketChildSource({ packetId: ownerId, jobId: slot.job_id, sourceFileKey }))) continue;
          let retainedObjectKey: string | null = null;
          let accepted = false;

          try {
            if (virtualChildren) await options.sourceFiles.createPdfView!({ workspaceId, jobId: slot.job_id, sourceFileKey: store.getProcessingSource(ownerId)!.source_file_key, pages: slot.pages });
            else if (options.sourceFiles.promoteTemporary) await options.sourceFiles.promoteTemporary({ workspaceId, jobId: slot.job_id, mimeType: "application/pdf", temporaryPath });
            else await options.sourceFiles.write({ workspaceId, jobId: slot.job_id, mimeType: "application/pdf", bytes: await Bun.file(temporaryPath).arrayBuffer() });
            signal.throwIfAborted();

            if (store.getDocumentPacketChild(ownerId, slot.job_id)?.state !== "reserved") continue;
            const packetSource = store.getProcessingSource(ownerId);

            if (packetSource?.source_retained && packetSource.retained_object_key) {
              const objects = options.sourceObjects;

              if (!objects) throw new Error("Retained document storage unavailable");
              retainedObjectKey = objects.keyFor({ workspaceId, jobId: slot.job_id, mimeType: "application/pdf" });
              objects.manifest.prepare({ objectKey: retainedObjectKey, workspaceId, ownerKind: "job", ownerId: slot.job_id });

              if (!await write(() => store.reservePacketChildSource({ packetId: ownerId, jobId: slot.job_id, sourceFileKey, retainedObjectKey }))) continue;
              await objects.store.put({ key: retainedObjectKey, file: Bun.file(join(options.stateDirectory, "source-files", sourceFileKey)), mimeType: "application/pdf" });
            }

            signal.throwIfAborted();
            const queued = await write(() => store.materializePacketChild({ packetId: ownerId, jobId: slot.job_id, sourceFileKey, sourceFilePageCount: slot.pages.length, retainedObjectKey, updatedAt: now() }));
            accepted = Boolean(queued || store.getExtractionJobSummary(slot.job_id));

            if (!accepted) continue;

            if (retainedObjectKey) {
              try { options.sourceObjects!.manifest.link({ objectKey: retainedObjectKey }); } catch { /* Reconciliation links accepted originals. */ }
            }

            notify(slot.job_id);

            if (queued) await options.schedule({ ...queued, workspace_id: workspaceId, enqueued_at: now() });
          } finally {
            if (!accepted) {
              if (retainedObjectKey) options.sourceObjects?.manifest.markDeleting({ objectKey: retainedObjectKey });
              await options.sourceFiles.delete(sourceFileKey).catch(() => {});
            }
          }
        }

        if (await write(() => store.finishPacketMaterialization({ packetId: ownerId, updatedAt: now() }))) await cleanup();

        return {};
      }

      case "extract/claim": {
        // Resolve the configuration first so the claim and model record share one
        // commit; a configuration failure still surfaces after the claim, as before.
        let resolved: ReturnType<typeof environment> | null = null;

        try { resolved = environment("extraction"); } catch { /* Re-raised after the claim below. */ }

        let recorded = false;

        claimed = await write(() => {
          const current = store.claimExtractionJobForProcessing({ jobId: ownerId, attempt, claimedAt: updatedAt });

          if (current && resolved)
            recorded = store.recordExtractionJobModel({ jobId: ownerId, attempt, configurationRevision: resolved.revision, modelName: resolved.env.AI_MODEL!, route: new URL(resolved.env.MODEL_GATEWAY_URL!).hostname });

          return current;
        });

        if (!claimed) return { done: true };
        notify();
        const { env } = resolved ?? environment("extraction");

        if (!recorded) return { done: true };
        const marker = newId("source");

        return { ...await descriptor(env, buildExtractionRequest(env, claimed.fields, claimed.source_mime_type, [{ type: "text", text: marker }]), claimed.source_mime_type, marker) };
      }

      case "extract/complete": {
        if (!claimed || !model) throw new Error("No claimed extraction");
        const results = normalizeModelResults(claimed.fields, parseExtractionContent(readRunResultContent(body)));
        outcome("success");

        if (await write(() => store.completeExtractionJob({ jobId: ownerId, attempt, completedAt: updatedAt, modelName: model!.modelName, route: model!.route, results }))) {
          notify();

          try { options.completed?.(workspaceId); }
          catch { /* Diagnostics cannot change processing outcomes. */ }

          try {
            options.productAnalytics?.record({ type: "extraction_completed", workspaceId, templateId: claimed.template_id, templateVersion: claimed.template_version, extractionJobId: ownerId, status: "completed", attempt, sourceMimeType: claimed.source_mime_type, sourceByteSize, modelName: model.modelName, fieldCount: claimed.fields.length });
          } catch { /* Analytics never changes a durable outcome. */ }

          await cleanup();
        }

        return {};
      }

      case "call/start": {
        if (!observer) throw new Error("No model attempt");
        modelCallStarted = true;
        const currentObserver = observer;
        const id = await write(() => currentObserver.started());
        receipts.set(id, observer);
        // The provider wait needs no local permit; Go resumes before reading the response.
        context.capacity?.suspend();

        return { id };
      }

      case "call/finish": {
        if (!isString(payload.id)) throw new Error("Invalid accounting receipt");
        const receipt = receipts.get(payload.id);

        if (!receipt) throw new Error("Unknown accounting receipt");
        const headers = new Headers();

        if (isJsonObject(payload.headers)) for (const [key, value] of Object.entries(payload.headers)) if (isString(value)) headers.set(key, value);
        const receiptId = payload.id;
        await write(() => receipt.finished(receiptId, readModelCallUsage(payload.body, headers)));
        receipts.delete(payload.id);

        return {};
      }

      case "failure": {
        const failure = isJsonObject(payload.failure) ? payload.failure : {};
        const message = isString(failure.message) ? failure.message : "Document processing failed";

        if (modelCallStarted) outcome(failure.status === 429 ? "throttled" : /timed out|timeout/i.test(message) ? "timeout" : "failed");

        const stage = isString(payload.stage) && payload.stage ? payload.stage : currentStage;

        // Nothing was claimed: interrupt the run so durable recovery retries it.
        if (!stage) throw new Error("Document processing interrupted before a stage was claimed");

        if (stage === "route") store.holdDocumentRouting({ jobId: ownerId, reason: message, updatedAt });
        else if (job.kind === "packet") {
          const current = store.getDocumentPacket(ownerId);

          if (current?.plan_accepted) store.failDocumentPacket({ packetId: ownerId, reason: message, updatedAt });
          else store.holdDocumentPacket({ packetId: ownerId, reason: message, updatedAt });
        } else if (claimed) {
          if (failure.retryable === true && attempt < (options.maxAttempts ?? EXTRACTION_MAX_ATTEMPTS)) {
            const delay = extractionRetryDelay(attempt, options.retryDelayMs, isNumber(failure.retry_after_ms) ? failure.retry_after_ms : 0, options.maxRetryDelayMs ?? Math.max(options.retryDelayMs, 60000), options.random);
            const nextRetryAt = new Date(Date.parse(updatedAt) + delay).toISOString();

            if (store.requeueExtractionJob({ jobId: ownerId, attempt, requeuedAt: updatedAt, errorCode: "model_gateway_retry", errorMessage: message, ...model, nextRetryAt }))
              await options.schedule({ ...job, attempt: attempt + 1, not_before: nextRetryAt, enqueued_at: updatedAt });
          } else {
            const errorCode = isString(failure.code) ? failure.code : failure.retryable === true ? "retry_exhausted" : "processing_error";
            const failed = store.failExtractionJob({ jobId: ownerId, attempt, failedAt: updatedAt, errorCode, errorMessage: message, ...model });

            if (failed) {
              try {
                options.productAnalytics?.record({ type: "extraction_failed", workspaceId, templateId: claimed.template_id, templateVersion: claimed.template_version, extractionJobId: ownerId, status: "failed", attempt, sourceMimeType: claimed.source_mime_type, errorCode, fieldCount: claimed.fields.length });
              } catch { /* Analytics never changes a durable outcome. */ }
            }
          }
        }

        notify();

        return {};
      }

      default: throw new HttpError(404, "unknown_processor_operation", "Unknown processor operation");
    }
  };

  return async (operation: string, body: JsonValue): Promise<JsonObject> => {
    if (!operation.endsWith("-with-usage")) return execute(operation, body);

    if (!isJsonObject(body) || !isJsonObject(body.receipt) || !isString(body.receipt.id)) throw new Error("Invalid completion receipt");
    const receipt = body.receipt;
    const id = body.receipt.id;
    const receiptObserver = receipts.get(id);

    if (!receiptObserver || pendingUsage) throw new Error("Unknown or overlapping completion receipt");
    const headers = new Headers();

    if (isJsonObject(receipt.headers)) for (const [key, value] of Object.entries(receipt.headers)) if (isString(value)) headers.set(key, value);
    pendingUsage = { id, observer: receiptObserver, usage: readModelCallUsage(receipt.body, headers) };

    try { return await execute(operation.replace("-with-usage", ""), body.result ?? null); }
    finally {
      // Usage and valid results share one commit. Invalid results still account
      // for the paid attempt; accounting failure must never trigger a new call.
      if (pendingUsage) {
        try { await write(() => {}); }
        catch { /* The durable receipt remains explicitly unknown. */ }

        pendingUsage = null;
      }
    }
  };
}
