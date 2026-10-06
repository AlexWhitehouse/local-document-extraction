import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createLocalExtractionRunner as createRunner } from "../localExtractionRunner";
import { createGoProcessingSession, type GoProcessingOptions } from "../goProcessingSession";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "../localSourceFileStore";
import { classifyDocument, assessDocumentSplit } from "../consumer/documentAssessment";
import { materializePdfPageGroups } from "../lib/pdfPageOperations";
import { runExtraction, RetryableError, type ModelGatewayConfiguration } from "../consumer/modelGateway";
import type { ModelFieldResult } from "../consumer/modelResultNormalizer";
import type { FieldDefinition } from "../lib/types";
import { HttpError } from "../lib/http";
import { isJsonObject, isString, parseJson, type JsonValue } from "../../../shared/json";

type Completion = Awaited<ReturnType<typeof classifyDocument>> | Awaited<ReturnType<typeof assessDocumentSplit>> | { results: ModelFieldResult[] };

type Failure = { message: string; retryable: boolean; code?: string; retry_after_ms?: number; status?: number };

/** Drives the authoritative adapter with controlled model/PDF responses. Actual
 * Go execution and transport are covered by goProcessor.bun.test.ts and Go tests. */
export function createLocalExtractionRunner(input: Omit<Parameters<typeof createRunner>[0], "execute"> & {
  extract?: (input: { fields: FieldDefinition[]; signal: AbortSignal; sourceBytes: ArrayBuffer; sourceMimeType: string }) => Promise<ModelFieldResult[]>;
  classify?: typeof classifyDocument;
  splitDocument?: typeof assessDocumentSplit;
  materializePages?: typeof materializePdfPageGroups;
  sourceFileStore?: LocalSourceFileStore;
  sourceObjects?: GoProcessingOptions["sourceObjects"];
  modelGatewayRequestTimeoutMs?: string;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  random?: () => number;
  productAnalytics?: GoProcessingOptions["productAnalytics"];
  onJobLifecycleChange?: GoProcessingOptions["notify"];
  onGatewayOutcome?: GoProcessingOptions["outcome"];
}) {
  const sourceFiles = input.sourceFileStore ?? createLocalSourceFileStore({ stateDirectory: input.stateDirectory });

  return createRunner({ ...input, execute: async (context) => {
    const root = join(input.stateDirectory, "temporary", "submissions");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, "adapter-test-"));
    const files = { ...sourceFiles };

    if (input.materializePages) delete files.createPdfView;

    // Tests with in-memory Source stores still supply a real private file to the adapter.
    if (!files.resolveProcessingSource) files.resolveProcessingSource = async (key) => {
      const bytes = await files.read(key);
      const path = join(directory, "source");

      if (bytes) await Bun.write(path, bytes);

      return { path, identity: key };
    };

    const session = createGoProcessingSession(context, {
      stateDirectory: input.stateDirectory, sourceFiles: files, sourceObjects: input.sourceObjects,
      timeoutMs: Number(input.modelGatewayRequestTimeoutMs ?? 120000), retryDelayMs: input.retryDelayMs ?? 0,
      schedule: input.scheduleJob ?? (() => {}), notify: input.onJobLifecycleChange ?? (() => {}),
      outcome: input.onGatewayOutcome ?? (() => {}), productAnalytics: input.productAnalytics,
      now: input.now, random: input.random, maxAttempts: input.maxAttempts, maxRetryDelayMs: input.maxRetryDelayMs,
    }, directory);

    const envelope = (value: Completion): JsonValue => parseJson(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
    let stage = "extract";

    try {
      for (let round = 0; round < 10; round++) {
        const next = await session("next", null);

        if (next.stage === "done" || !isString(next.stage) || !isJsonObject(next.task)) return;
        stage = next.stage;
        const configuration = context.store.getModelConfiguration();
        const task = next.task;

        if (task.done) return;

        if (stage === "materialize") {
          const packet = context.store.getDocumentPacket(context.job.job_id)!;
          const groups = packet.child_slots.filter((slot) => slot.state === "reserved").map((slot) => slot.pages);
          const artifacts: string[] = [];

          if (!task.virtual) {
            if (!isString(task.source)) throw new Error("Missing source path");
            const pages = await (input.materializePages ?? materializePdfPageGroups)(Bun.file(task.source), groups, context.signal);

            for (const [index, bytes] of pages.entries()) {
              const name = `artifact-${index}`;
              await Bun.write(join(directory, name), bytes);
              artifacts.push(name);
            }
          }

          await session("materialize/complete", { artifacts });

          return;
        }

        if (!isString(task.prefix) || !isString(task.suffix) || !isString(task.source) || !isString(task.mime)) throw new Error("Invalid task descriptor");
        const request = parseJson(`${task.prefix}{"type":"text","text":"source"}${task.suffix}`);

        if (!isJsonObject(request) || !isString(request.model)) throw new Error("Invalid model request");
        const role = stage === "extract" ? configuration : configuration?.classification_model ?? configuration;

        const environment: ModelGatewayConfiguration = {
          AI_MODEL: request.model, MODEL_GATEWAY_URL: configuration?.gateway_url,
          LITELLM_KEY: isString(task.credential) ? task.credential : "",
          MODEL_SUPPORTS_PDF_INPUT: String(role?.supports_pdf_input), MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(role?.supports_structured_output),
          modelCallObserver: context.store.modelCallObserver({ ownerId: context.job.job_id, stage: stage === "extract" ? "extraction" : stage === "route" ? "auto_template" : "split", model: request.model, configurationRevision: configuration?.revision ?? 1, now: input.now ?? (() => new Date().toISOString()) }),
        };

        const metadata = context.store.getProcessingSource(context.job.job_id)!;
        const source = await sourceFiles.open?.(metadata.source_file_key) ?? Bun.file(task.source);
        let result: Completion;

        for (let retry = 0; ; retry++) {
          try {
            if (stage === "extract") {
              const job = context.store.getExtractionJob(context.job.job_id)!;
              const database = new Database(join(input.stateDirectory, "data", "workspaces", `${context.job.workspace_id}.sqlite`), { readonly: true });
              let fields: FieldDefinition[];

              try { fields = database.query<FieldDefinition, [string, number]>("SELECT field_id AS id, name, description, data_type FROM template_fields WHERE template_id = ? AND version = ? ORDER BY position").all(job.template_id!, job.template_version!); }
              finally { database.close(); }

              const sourceBytes = await source.arrayBuffer();
              result = { results: input.extract ? await input.extract({ fields, signal: context.signal, sourceBytes, sourceMimeType: task.mime }) : await runExtraction(environment, fields, sourceBytes, task.mime, context.signal) };
            } else if (stage === "route") {
              const routing = context.store.getDocumentRouting(context.job.job_id)!;
              result = await (input.classify ?? classifyDocument)(environment, {
                source, mimeType: task.mime, candidates: routing.candidates.map(({ id, name, description }) => ({ id, name, description: description ?? "" })),
                previous: routing.selection_reason ? { reason: routing.selection_reason, evidence: routing.evidence } : undefined,
              }, context.signal);
            } else {
              const packet = context.store.getDocumentPacket(context.job.job_id)!;
              result = await (input.splitDocument ?? assessDocumentSplit)(environment, {
                source, selectedPages: packet.selected_pages, excludeBlankPages: packet.processing_policy.exclude_blank_pages,
                previous: packet.reason ? { reason: packet.reason, evidence: packet.evidence } : undefined,
              }, context.signal);
            }

            break;
          } catch (error) {
            if (stage === "extract" || !(error instanceof RetryableError) || retry === 2) throw error;
          }
        }

        await session(`${stage}/complete`, envelope(result));

        if (stage === "extract") return;
      }

      throw new Error("Adapter fixture exceeded decision rounds");
    } catch (error) {
      if (context.signal.aborted) return;
      const failure: Failure = { message: error instanceof Error ? error.message : "Processing failed", retryable: error instanceof RetryableError };

      if (error instanceof HttpError) failure.code = error.code;

      if (error instanceof RetryableError) { failure.retry_after_ms = error.retryAfterMs ?? 0; failure.status = error.status ?? 0; }

      await session("failure", { stage, failure });
    } finally { await rm(directory, { recursive: true, force: true }); }
  } });
}
