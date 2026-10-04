import {
  assessDocumentSplit,
  classifyDocument,
  DOCUMENT_ASSESSMENT_LIMITS,
  type AssessmentFeedback,
} from "./consumer/documentAssessment";
import { RetryableError, withDocumentProcessingMemory } from "./consumer/modelGateway";
import { withPdfOperationCapacity, materializePdfPageGroups, PDF_PAGE_OPERATION_LIMITS } from "./lib/pdfPageOperations";
import type { LocalRetainedSourceObjects } from "./localApplication";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import type { LocalSourceFileStore } from "./localSourceFileStore";
import type { LocalWorkspaceProductStoreHandle } from "./localWorkspaceProductStoreRegistry";
import {
  classificationModelEnvironment,
  classificationModelOf,
  configurationMissing,
  createWorkspaceCredentialVault,
} from "./workspaceModelConfiguration";

export type DocumentProcessingFunctions = {
  classify?: typeof classifyDocument;
  splitDocument?: typeof assessDocumentSplit;
  materializePages?: typeof materializePdfPageGroups;
};

type ProcessingContext = {
  store: LocalWorkspaceProductStoreHandle;
  workspaceId: string;
  ownerId: string;
  signal: AbortSignal;
};

/** Durable decision rounds belong to the store. This module owns bounded execution and source artifacts. */
export function createLocalDocumentProcessingRunner(
  input: DocumentProcessingFunctions & {
    stateDirectory: string;
    sourceFiles: LocalSourceFileStore;
    sourceObjects?: LocalRetainedSourceObjects;
    now(): string;
    modelGatewayRequestTimeoutMs?: string;
    scheduleJob(job: LocalQueuedExtractionJob): void | Promise<void>;
    notifyJob(workspaceId: string, store: LocalWorkspaceProductStoreHandle, jobId: string): void;
    onGatewayOutcome?: (outcome: "failed" | "success" | "throttled" | "timeout") => void;
  },
) {
  const vault = createWorkspaceCredentialVault(input.stateDirectory);
  const classify = input.classify ?? classifyDocument;
  const split = input.splitDocument ?? assessDocumentSplit;
  const materialize = input.materializePages ?? materializePdfPageGroups;

  const notifyGateway = (outcome: "failed" | "success" | "throttled" | "timeout") => {
    try {
      input.onGatewayOutcome?.(outcome);
    } catch {
      /* Diagnostics cannot change processing outcomes. */
    }
  };

  const modelAttempt = (context: ProcessingContext, stage: "split" | "auto_template") => {
    const configuration = context.store.getModelConfiguration();

    if (!configuration) throw configurationMissing();
    const model = classificationModelOf(configuration);

    return {
      environment: {
        ...classificationModelEnvironment(configuration, {
          credential: vault.decrypt(context.workspaceId, configuration.credential_ciphertext),
          workspaceId: context.workspaceId,
          requestTimeoutMs: input.modelGatewayRequestTimeoutMs ?? "120000",
        }),
        modelCallObserver: context.store.modelCallObserver({
          ownerId: context.ownerId,
          stage,
          model: model.model_name,
          configurationRevision: configuration.revision,
          now: input.now,
        }),
      },
      snapshot: {
        revision: configuration.revision,
        model_name: model.model_name,
        gateway_url: model.gateway_url,
        supports_pdf_input: model.supports_pdf_input,
        supports_structured_output: model.supports_structured_output,
        sequential_calls: model.sequential_calls,
      },
    };
  };

  const source = async ({ store, ownerId, signal }: ProcessingContext): Promise<Blob> => {
    const metadata = store.getProcessingSource(ownerId);

    if (!metadata) throw new Error("The document source is no longer available.");

    const local =
      metadata.source_file_key &&
      (input.sourceFiles.open
        ? await input.sourceFiles.open(metadata.source_file_key)
        : await input.sourceFiles
            .read(metadata.source_file_key)
            .then((bytes) => (bytes ? new Blob([Uint8Array.from(bytes)], { type: metadata.source_mime_type }) : null)));

    signal.throwIfAborted();

    if (local) return local;

    if (metadata.retained_object_key && input.sourceObjects) {
      const remote = await input.sourceObjects.store.open(metadata.retained_object_key);

      if (remote.size > PDF_PAGE_OPERATION_LIMITS.sourceBytes)
        throw new Error("The document exceeds the supported processing size.");
      const reader = remote.stream().getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;

      const abort = () => {
        void reader.cancel().catch(() => undefined);
      };

      signal.addEventListener("abort", abort, { once: true });

      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();

          if (done) break;
          length += value.byteLength;

          if (length > PDF_PAGE_OPERATION_LIMITS.sourceBytes)
            throw new Error("The document exceeds the supported processing size.");
          chunks.push(value);
        }

        signal.throwIfAborted();

        return new Blob(
          chunks.map((bytes) => Uint8Array.from(bytes)),
          { type: metadata.source_mime_type },
        );
      } finally {
        signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }

    throw new Error("The document source is temporarily unavailable.");
  };

  // A round has a fixed, bounded transport retry allowance; a process restart
  // consumes the interrupted round rather than restoring any decision budget.
  const call = async <T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();

      try {
        const result = await run();
        notifyGateway("success");

        return result;
      } catch (error) {
        if (signal.aborted) throw error;
        notifyGateway(
          error instanceof RetryableError && error.status === 429
            ? "throttled"
            : error instanceof Error && /timeout|timed out/i.test(error.message)
              ? "timeout"
              : "failed",
        );

        if (!(error instanceof RetryableError) || attempt >= 3) throw error;
        const delayMs = Math.max(250 * 2 ** (attempt - 1), error.retryAfterMs ?? 0);

        // Long Retry-After values cannot monopolize a Workspace runner indefinitely.
        if (delayMs > 60_000) throw error;
        await abortableDelay(delayMs, signal);
      }
    }
  };

  const route = async (context: ProcessingContext): Promise<boolean> => {
    const { store, ownerId: jobId, workspaceId, signal } = context;
    const notify = () => input.notifyJob(workspaceId, store, jobId);

    const hold = (reason: string, evidence?: string[]) => {
      store.holdDocumentRouting({ jobId, reason, evidence, updatedAt: input.now() });
      notify();

      return false;
    };

    let document: Blob | undefined;

    try {
      for (;;) {
        signal.throwIfAborted();
        const job = store.getExtractionJobSummary(jobId);

        if (!job || job.status === "awaiting_template") return false;

        if (job.template_id !== null) return true;
        const routing = store.getDocumentRouting(jobId);

        if (!routing) return false;

        if (routing.routing_rounds >= 3)
          return hold(
            routing.selection_reason || "Automatic template selection remains unresolved after reassessment.",
            routing.evidence,
          );
        const candidates = store.getRoutingCandidates(routing.template_tags);

        if (!candidates.length)
          return hold("No eligible templates match the supplied tags. Select a template to continue.");

        if (candidates.length > DOCUMENT_ASSESSMENT_LIMITS.candidates)
          return hold("Too many templates match the supplied tags. Select a template to continue.");
        const attempt = modelAttempt(context, "auto_template");

        const round = store.claimRoutingRound({
          jobId,
          updatedAt: input.now(),
          configurationSnapshot: attempt.snapshot,
        });

        if (!round) return Boolean(store.getExtractionJobSummary(jobId)?.template_id);
        notify();
        document ??= await source(context);
        const previous = feedback(round.selection_reason, round.evidence);

        const result = await call(
          () =>
            classify(
              attempt.environment,
              {
                source: document!,
                mimeType: document!.type || store.getProcessingSource(jobId)!.source_mime_type,
                candidates: round.candidates.map((candidate) => ({
                  id: candidate.id,
                  name: candidate.name,
                  description: candidate.description ?? "",
                })),
                previous,
              },
              signal,
            ),
          signal,
        );

        signal.throwIfAborted();

        if (
          !store.recordRoutingAssessment({
            jobId,
            round: round.routing_rounds,
            reason: result.reason,
            evidence: result.evidence,
            updatedAt: input.now(),
          })
        )
          return false;

        if (result.status === "selected" && result.template_id) {
          if (
            store.bindDocumentTemplate({
              jobId,
              templateId: result.template_id,
              expectedRound: round.routing_rounds,
              updatedAt: input.now(),
            })
          ) {
            notify();

            return true;
          }

          store.recordRoutingAssessment({
            jobId,
            round: round.routing_rounds,
            reason:
              "The selected template changed or no longer matches the supplied tags. Reassess the current candidates.",
            evidence: [],
            updatedAt: input.now(),
          });
        } else if (result.status === "no_match") {
          return hold(result.reason, result.evidence);
        }
      }
    } catch (error) {
      if (signal.aborted) return false;

      return hold(message(error));
    }
  };

  const cleanupPacketSource = async (context: ProcessingContext) => {
    const packet = context.store.getProcessingSource(context.ownerId);

    if (!packet?.source_file_key || (packet.source_retained && !packet.retained_object_key)) return;

    try {
      await input.sourceFiles.delete(packet.source_file_key);
      context.store.markSourceFileCleaned({
        jobId: context.ownerId,
        sourceFileKey: packet.source_file_key,
        cleanedAt: input.now(),
      });
    } catch {
      /* The durable retention sweep retries original cleanup. */
    }
  };

  const processPacket = async (context: ProcessingContext): Promise<void> => {
    const { store, ownerId: packetId, workspaceId, signal } = context;
    let document: Blob | undefined;

    try {
      for (;;) {
        signal.throwIfAborted();
        let packet = store.getDocumentPacket(packetId);

        if (!packet || packet.status === "awaiting_review" || packet.status === "failed") return;

        if (packet.status === "completed" && packet.outcome === "no_documents") {
          await cleanupPacketSource(context);

          return;
        }

        if (packet.plan_accepted) {
          const reserved = packet.child_slots.filter((slot) => slot.state === "reserved");
          const ready: LocalQueuedExtractionJob[] = [];

          if (reserved.length) {
            // The parser bounds its own process, but output buffers stay alive
            // through local writes and remote uploads. Keep that entire lifetime
            // inside the same byte budget used by model preparation.
            const maximumArtifacts = Math.min(
              PDF_PAGE_OPERATION_LIMITS.totalArtifactBytes,
              reserved.length * PDF_PAGE_OPERATION_LIMITS.artifactBytes,
            );

            await withDocumentProcessingMemory(
              PDF_PAGE_OPERATION_LIMITS.sourceBytes + maximumArtifacts * 3,
              signal,
              async (lease) => {
                document ??= await source(context);

                const artifacts = await withPdfOperationCapacity(
                  () =>
                    materialize(
                      document!,
                      reserved.map((slot) => slot.pages),
                      signal,
                    ),
                  signal,
                );

                lease.shrinkTo(document.size + artifacts.reduce((sum, bytes) => sum + bytes.byteLength, 0) * 3);

                for (let index = 0; index < reserved.length; index++) {
                  signal.throwIfAborted();
                  const slot = reserved[index]!;
                  const bytes = artifacts[index]!;
                  const sourceFileKey = `workspaces/${workspaceId}/jobs/${slot.job_id}/source.pdf`;

                  if (!store.reservePacketChildSource({ packetId, jobId: slot.job_id, sourceFileKey })) continue;
                  let retainedObjectKey: string | null = null;
                  let accepted = false;

                  try {
                    await input.sourceFiles.write({
                      workspaceId,
                      jobId: slot.job_id,
                      mimeType: "application/pdf",
                      bytes,
                    });
                    signal.throwIfAborted();
                    packet = store.getDocumentPacket(packetId);

                    if (
                      !packet ||
                      packet.child_slots.find((child) => child.job_id === slot.job_id)?.state !== "reserved"
                    )
                      continue;

                    if (packet.source_retained && store.getProcessingSource(packetId)?.retained_object_key) {
                      const objects = input.sourceObjects;

                      if (!objects) throw new Error("Retained document storage is unavailable.");
                      retainedObjectKey = objects.keyFor({
                        workspaceId,
                        jobId: slot.job_id,
                        mimeType: "application/pdf",
                      });
                      objects.manifest.prepare({
                        objectKey: retainedObjectKey,
                        workspaceId,
                        ownerKind: "job",
                        ownerId: slot.job_id,
                      });

                      if (
                        !store.reservePacketChildSource({
                          packetId,
                          jobId: slot.job_id,
                          sourceFileKey,
                          retainedObjectKey,
                        })
                      )
                        continue;
                      await objects.store.put({
                        key: retainedObjectKey,
                        file: new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
                        mimeType: "application/pdf",
                      });
                    }

                    signal.throwIfAborted();

                    const queued = store.materializePacketChild({
                      packetId,
                      jobId: slot.job_id,
                      sourceFileKey,
                      sourceFilePageCount: slot.pages.length,
                      retainedObjectKey,
                      updatedAt: input.now(),
                    });

                    accepted = Boolean(queued || store.getExtractionJobSummary(slot.job_id));

                    if (!accepted) continue;

                    if (retainedObjectKey) {
                      try {
                        input.sourceObjects!.manifest.link({ objectKey: retainedObjectKey });
                      } catch {
                        /* Manifest recovery observes the committed child. */
                      }
                    }

                    input.notifyJob(workspaceId, store, slot.job_id);

                    if (queued) ready.push({ ...queued, workspace_id: workspaceId, enqueued_at: input.now() });
                  } finally {
                    if (!accepted) {
                      if (retainedObjectKey)
                        input.sourceObjects?.manifest.markDeleting({ objectKey: retainedObjectKey });
                      await input.sourceFiles.delete(sourceFileKey).catch(() => undefined);
                    }
                  }
                }
              },
            );
          }

          if (store.finishPacketMaterialization({ packetId, updatedAt: input.now() }))
            await cleanupPacketSource(context);

          for (const child of ready) {
            signal.throwIfAborted();
            await input.scheduleJob(child);
          }

          return;
        }

        if (packet.assessment_rounds >= 3) {
          store.holdDocumentPacket({
            packetId,
            reason: packet.reason || "Document boundaries remain uncertain after reassessment.",
            updatedAt: input.now(),
          });

          return;
        }

        const attempt = modelAttempt(context, "split");

        const round = store.claimPacketRound({
          packetId,
          updatedAt: input.now(),
          configurationSnapshot: attempt.snapshot,
        });

        if (!round) return;
        document ??= await source(context);

        const result = await call(
          () =>
            split(
              attempt.environment,
              {
                source: document!,
                selectedPages: round.selected_pages,
                excludeBlankPages:
                  round.processing_policy.enable_smart_splitting && round.processing_policy.exclude_blank_pages,
                previous: feedback(round.reason, round.evidence),
              },
              signal,
            ),
          signal,
        );

        signal.throwIfAborted();

        if (
          !store.recordPacketAssessment({
            packetId,
            round: round.assessment_rounds,
            reason: result.reason,
            evidence: result.evidence,
            groups: result.groups,
            exclusions: result.exclusions,
            updatedAt: input.now(),
          })
        )
          return;

        if (result.status === "resolved") {
          const current = store.getDocumentPacket(packetId);

          if (!current) return;

          const accepted = store.acceptDocumentPacketPlan({
            packetId,
            revision: current.plan_revision,
            expectedRound: round.assessment_rounds,
            groups: result.groups,
            exclusions: result.exclusions,
            updatedAt: input.now(),
          });

          if (!accepted) return;

          if (!accepted.child_slots.length) {
            await cleanupPacketSource(context);

            return;
          }
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      const packet = store.getDocumentPacket(packetId);

      if (!packet) return;

      if (packet.plan_accepted) store.failDocumentPacket({ packetId, reason: message(error), updatedAt: input.now() });
      else store.holdDocumentPacket({ packetId, reason: message(error), updatedAt: input.now() });
    }
  };

  return { route, processPacket };
}

function feedback(reason: string | null | undefined, evidence?: string[]): AssessmentFeedback | undefined {
  return reason ? { reason, evidence: evidence ?? [] } : undefined;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message.slice(0, 2000) : "Document processing could not finish automatically.";
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);

    signal.addEventListener("abort", abort, { once: true });
  });
}
