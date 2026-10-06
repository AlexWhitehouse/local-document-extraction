import {
  isJsonObject,
  isJsonArray,
  parseJson,
  type JsonObject,
  type JsonValue,
  isString,
  isBoolean,
  isNumber,
} from "../../shared/json";
import { extractionRetryDelay, EXTRACTION_MAX_ATTEMPTS } from "./extractionRetryPolicy";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runExtraction, RetryableError, type ExtractionUsage } from "./consumer/modelGateway";
import { normalizeModelResults } from "./consumer/modelResultNormalizer";
import type { ModelCallUsage } from "./consumer/modelUsage";
import { costAmount, type CostAmount } from "../../shared/processingCosts";
import { HttpError } from "./lib/http";
import { validateSourceFileMetadata, validateTemplatePayload } from "./lib/validation";
import type { FieldDefinition } from "./lib/types";
import { countPdfSourceFilePages } from "./lib/sourceFilePageCount";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import type { LocalExtractionQueue } from "./localExtractionQueue";
import { parseLocalMultipartSubmission } from "./localMultipartSubmission";
import { localRequestOriginFailure } from "./localRequestOrigin";
import { ensurePrivateStateDirectory } from "./localStatePaths";
import {
  configurationMissing,
  createWorkspaceCredentialVault,
  type StoredWorkspaceModelConfiguration,
} from "./workspaceModelConfiguration";

export const EVALUATION_METADATA_BYTES = 1024 * 1024 + 8192;

/** Saved Evaluation library originals, as seen by the temporary runner. */
export type EvaluationDocumentSourceAccess = {
  /** true while the entry exists (not logically deleted) in the Workspace. Must be cheap (one indexed read). */
  exists(input: { workspaceId: string; documentId: string }): boolean;
  /** Copies the saved original into a new private temporary file under temporary/evaluations, bounded by maxBytes. */
  copyToTemporary(input: {
    workspaceId: string;
    documentId: string;
    destinationPath: string;
    maxBytes: number;
    signal: AbortSignal;
  }): Promise<
    | { ok: true; mimeType: string; size: number; name: string | null }
    | { ok: false; reason: "not_found" | "missing" | "too_large" | "unavailable" }
  >;
};

type Candidate = {
  id: string;
  revision: number;
  model: string;
  pdf: boolean;
  structured: boolean;
  fields: FieldDefinition[];
};

type Submission = {
  id: string;
  evaluationId: string;
  revision: number;
  mode: "models" | "templates";
  candidates: Candidate[];
  documentInstanceId: string;
  actionId?: string;
  savedDocumentId?: string;
};

/** Captured gateway settings; memory only, never serialized or sent in events. */
type Captured = { revision: number; gateway_url: string; sequential_calls: boolean; credential: string };

type Action = {
  session: string;
  workspaceId: string;
  evaluationId: string;
  captured: Captured;
  open: number;
  timer?: ReturnType<typeof setTimeout>;
};

const MAX_ACTIONS_PER_SESSION = 16;

const invalid = () => new HttpError(400, "invalid_evaluation", "Provide one to eight valid Evaluation candidates.");

/** The successful attempt's model calls, summed like Document costs; unreported calls mark it incomplete. */
function receiptCost(receipts: ModelCallUsage[]): CostAmount | null {
  if (!receipts.length) return null;
  const reported = receipts.filter((receipt) => receipt.cost !== null);

  return costAmount(
    reported.reduce((sum, receipt) => sum + (receipt.cost ?? 0), 0),
    reported.length,
    receipts.length - reported.length,
  );
}

const isId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);

const deletedMessage = "Deleted from the Evaluation library.";

async function readJson(request: Request, limit: number): Promise<JsonValue> {
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    size += value.byteLength;

    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "evaluation_too_large", "Evaluation request is too large.");
    }

    chunks.push(value);
  }

  try {
    return parseJson(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw invalid();
  }
}

function validate(input: JsonValue | undefined, saved: boolean): Submission {
  if (!isJsonObject(input)) throw invalid();

  if (
    !isId(input.id) ||
    !isId(input.evaluationId) ||
    !isNumber(input.revision) ||
    !Number.isSafeInteger(input.revision) ||
    (input.mode !== "models" && input.mode !== "templates") ||
    !isJsonArray(input.candidates) ||
    input.candidates.length < 1 ||
    input.candidates.length > 8
  )
    throw invalid();
  const documentInstanceId = input.document_instance_id ?? "single";

  if (!isId(documentInstanceId) || (input.action_id !== undefined && !isId(input.action_id))) throw invalid();
  const document = input.document;

  if (saved ? !isJsonObject(document) || document.kind !== "saved" || !isId(document.id) : document !== undefined)
    throw invalid();
  const seen = new Set<string>();

  const candidates = input.candidates.map((candidate) => {
    if (
      !isJsonObject(candidate) ||
      !isId(candidate.id) ||
      seen.has(candidate.id) ||
      !isNumber(candidate.revision) ||
      !Number.isSafeInteger(candidate.revision) ||
      !isString(candidate.model) ||
      !candidate.model.trim() ||
      candidate.model.length > 256 ||
      /[\r\n\0]/.test(candidate.model) ||
      !isBoolean(candidate.pdf) ||
      !isBoolean(candidate.structured)
    )
      throw invalid();
    seen.add(candidate.id);
    const fields = validateTemplatePayload({ name: "Evaluation", fields: candidate.fields }).fields!;

    return {
      id: candidate.id,
      revision: candidate.revision,
      model: candidate.model.trim(),
      pdf: candidate.pdf,
      structured: candidate.structured,
      fields,
    };
  });

  const first = candidates[0];

  if (
    candidates.some((c) =>
      input.mode === "models"
        ? JSON.stringify(c.fields) !== JSON.stringify(first.fields)
        : c.model !== first.model || c.pdf !== first.pdf || c.structured !== first.structured,
    )
  )
    throw invalid();

  const submission: Submission = {
    id: input.id,
    evaluationId: input.evaluationId,
    revision: input.revision,
    mode: input.mode,
    candidates,
    documentInstanceId,
  };

  if (isId(input.action_id)) submission.actionId = input.action_id;

  if (saved && isJsonObject(document) && isId(document.id)) submission.savedDocumentId = document.id;

  return submission;
}

/** Request-owned computation only: no jobs, results, references or replay records are persisted. */
export function createLocalEvaluations({
  auth,
  workspaceControl,
  productStoreRegistry,
  stateDirectory,
  queue,
  maxSourceFileBytes,
  requestTimeoutMs = 300000,
  retryDelayMs = 1000,
  extract = runExtraction,
  remove = (path: string) => rm(path, { force: true }),
  onGatewayOutcome,
  libraryDocuments,
  actionIdleMs = 600000,
  deletionPollMs = 2000,
}: {
  auth: LocalAuth;
  workspaceControl: LocalWorkspaceControl;
  productStoreRegistry: LocalWorkspaceProductStoreRegistry;
  stateDirectory: string;
  queue: LocalExtractionQueue;
  maxSourceFileBytes: number;
  requestTimeoutMs?: number;
  retryDelayMs?: number;
  extract?: typeof runExtraction;
  remove?: (path: string) => Promise<void>;
  onGatewayOutcome?: (outcome: "failed" | "success" | "throttled" | "timeout") => void;
  libraryDocuments?: EvaluationDocumentSourceAccess;
  actionIdleMs?: number;
  deletionPollMs?: number;
}) {
  const directory = join(stateDirectory, "temporary", "evaluations");
  const owned = new Set<string>();
  const outstanding = new Set<string>();
  const submissions = new Set<string>();
  const abandonments = new Set<() => void>();
  // Run actions: session-scoped configuration snapshots. Lost on restart; never an authorization grant.
  const actions = new Map<string, Action>();

  const releaseAction = (id: string) => {
    const action = actions.get(id);

    if (action) {
      clearTimeout(action.timer);
      actions.delete(id);
    }
  };

  const idleAction = (id: string, action: Action) => {
    clearTimeout(action.timer);

    if (!action.open && actions.get(id) === action) {
      action.timer = setTimeout(() => releaseAction(id), actionIdleMs);
      action.timer.unref?.();
    }
  };

  let uploading = 0;
  let closed = false;

  const initialize = async () => {
    await ensurePrivateStateDirectory(stateDirectory, { recursive: true });
    await ensurePrivateStateDirectory(join(stateDirectory, "temporary"), { recursive: true });
    await ensurePrivateStateDirectory(directory);
  };

  const sweep = async () => {
    await initialize();

    if (uploading) return;

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      // An upload that started during the listing has not registered its file yet.
      if (uploading) return;
      const path = join(directory, entry.name);

      if (entry.isFile() && /^[a-f0-9-]{36}\.upload$/.test(entry.name) && !owned.has(path))
        await remove(path).catch(() => {});
    }
  };

  const ready = sweep();

  const timer = setInterval(() => {
    void sweep().catch(() => {});
  }, 30000);

  timer.unref();

  const capture = (configuration: StoredWorkspaceModelConfiguration, workspaceId: string): Captured => ({
    revision: configuration.revision,
    gateway_url: configuration.gateway_url,
    sequential_calls: configuration.sequential_calls,
    credential: createWorkspaceCredentialVault(stateDirectory).decrypt(
      workspaceId,
      configuration.credential_ciphertext,
    ),
  });

  const outcome = (value: "failed" | "success" | "throttled" | "timeout") => {
    try {
      onGatewayOutcome?.(value);
    } catch {
      /* Resource observers cannot change extraction outcomes. */
    }
  };

  const fail = (cause: unknown) =>
    cause instanceof HttpError
      ? Response.json(
          { error: { code: cause.code, message: cause.message } },
          { status: cause.status, headers: cause.status === 503 ? { "retry-after": "5" } : {} },
        )
      : Response.json(
          {
            error: {
              code: "evaluation_failed",
              message: "Evaluation could not be started. Check the document and try again.",
            },
          },
          { status: 400 },
        );

  return {
    sweep,
    close() {
      closed = true;
      clearInterval(timer);

      for (const id of [...actions.keys()]) releaseAction(id);

      for (const abandon of abandonments) abandon();
    },
    async handle(request: Request): Promise<Response> {
      let path: string | undefined;
      let transferred = false;
      let submissionKey: string | undefined;
      let ownsSubmission = false;

      try {
        await ready;

        if (closed) throw new HttpError(503, "unavailable", "Evaluations are unavailable.");

        if (request.headers.has("authorization"))
          throw new HttpError(403, "session_required", "Evaluations require a browser session.");
        const origin = localRequestOriginFailure(request, auth);

        if (origin) return origin;
        const session = await auth.getSession(request);
        const workspaceId = request.headers.get("x-workspace-id") || "";

        const authorized = () => {
          try {
            return Boolean(
              session &&
              (session.isActive?.() ?? true) &&
              workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id }),
            );
          } catch {
            return false;
          }
        };

        if (!authorized()) throw new HttpError(403, "workspace_access_denied", "Workspace access is unavailable.");
        const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session!.id })!;
        // Actions and run ownership belong to one signed-in browser session; membership stays per user.
        const sessionOwner = session!.sessionId ?? session!.id;

        const readStore = <T>(
          read: (store: NonNullable<ReturnType<typeof productStoreRegistry.acquire>>["store"]) => T,
        ) => {
          const lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });

          if (!lease) throw configurationMissing();

          try {
            return read(lease.store);
          } finally {
            lease.release();
          }
        };

        const url = new URL(request.url);

        if (request.method === "GET" && url.pathname === "/v1/evaluations/setup") {
          const configuration = readStore((store) => store.getModelConfiguration());
          // Service-derived pacing for browser staging; not a selection cap.
          const staging = { document_concurrency: Math.max(1, queue.snapshot().maxConcurrent) };

          return Response.json(
            configuration
              ? {
                  configured: true,
                  revision: configuration.revision,
                  model: configuration.model_name,
                  pdf: configuration.supports_pdf_input,
                  structured: configuration.supports_structured_output,
                  sequential: configuration.sequential_calls,
                  staging,
                }
              : { configured: false, staging },
            { headers: { "cache-control": "no-store" } },
          );
        }

        if (request.method === "POST" && url.pathname === "/v1/evaluations/actions") {
          const body = await readJson(request, 4096);

          if (!isJsonObject(body) || !isId(body.evaluation_id) || !Number.isSafeInteger(body.revision)) throw invalid();
          const configuration = readStore((store) => store.getModelConfiguration());

          if (!configuration) throw configurationMissing();

          if (body.revision !== configuration.revision)
            throw new HttpError(
              409,
              "configuration_changed",
              "Workspace model settings changed. Start a fresh Evaluation.",
            );
          const captured = capture(configuration, workspaceId);
          const own = [...actions].filter(([, action]) => action.session === sessionOwner);

          for (const [id] of own.slice(0, Math.max(0, own.length - MAX_ACTIONS_PER_SESSION + 1))) releaseAction(id);
          const actionId = randomUUID();

          const action: Action = {
            session: sessionOwner,
            workspaceId,
            evaluationId: body.evaluation_id,
            captured,
            open: 0,
          };

          actions.set(actionId, action);
          idleAction(actionId, action);

          return Response.json({ action_id: actionId }, { status: 201, headers: { "cache-control": "no-store" } });
        }

        const actionMatch = url.pathname.match(/^\/v1\/evaluations\/actions\/([a-zA-Z0-9_-]{1,80})$/);

        if (request.method === "DELETE" && actionMatch) {
          const action = actions.get(actionMatch[1]);

          if (action?.session === sessionOwner && action.workspaceId === workspaceId) releaseAction(actionMatch[1]);

          return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        }

        const templateMatch = url.pathname.match(/^\/v1\/evaluations\/templates\/([a-zA-Z0-9_-]+)$/);

        if (request.method === "GET" && templateMatch) {
          const version = url.searchParams.has("version") ? Number(url.searchParams.get("version")) : undefined;
          const template = readStore((store) => store.getTemplate(templateMatch[1], version));

          if (!template) throw new HttpError(404, "template_not_found", "Template field version not found.");

          return Response.json(template, { headers: { "cache-control": "no-store" } });
        }

        if (request.method !== "POST" || url.pathname !== "/v1/evaluations/run")
          throw new HttpError(404, "not_found", "Evaluation route not found.");
        const submissionHeader = request.headers.get("x-evaluation-submission") || "";

        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(submissionHeader)) throw invalid();
        submissionKey = [sessionOwner, workspaceId, submissionHeader].join(":");

        if (submissions.has(submissionKey))
          throw new HttpError(409, "duplicate_submission", "This submission is already in progress.");
        submissions.add(submissionKey);
        ownsSubmission = true;
        const saved = (request.headers.get("content-type") || "").toLowerCase().startsWith("application/json");
        const maxBytes = workspace.max_source_file_bytes ?? maxSourceFileBytes;
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(60000, requestTimeoutMs))]);
        let parsed: JsonValue;
        let mimeType: string;

        if (saved) {
          parsed = await readJson(request, EVALUATION_METADATA_BYTES);
        } else {
          uploading++;
          let upload;

          try {
            upload = await parseLocalMultipartSubmission({
              request: new Request(request, { signal }),
              stateDirectory,
              purpose: "evaluation",
              maxSourceFileBytes: maxBytes,
            });
            path = upload.source.temporaryPath;
            owned.add(path);
          } finally {
            uploading--;
          }

          mimeType = upload.source.mimeType;

          try {
            parsed = parseJson(upload.evaluation!);
          } catch {
            throw invalid();
          }
        }

        const submission = validate(parsed, saved);

        if (submission.id !== submissionHeader) throw invalid();

        if (!authorized() || request.signal.aborted)
          throw new HttpError(403, "workspace_access_denied", "Workspace access is unavailable.");
        let captured: Captured;
        let action: Action | undefined;

        if (submission.actionId) {
          action = actions.get(submission.actionId);

          if (
            !action ||
            action.session !== sessionOwner ||
            action.workspaceId !== workspaceId ||
            action.evaluationId !== submission.evaluationId
          )
            throw new HttpError(409, "action_expired", "This run expired. Run again.");
          captured = action.captured;
        } else {
          const configuration = readStore((store) => store.getModelConfiguration());

          if (!configuration) throw configurationMissing();

          if (submission.revision !== configuration.revision)
            throw new HttpError(
              409,
              "configuration_changed",
              "Workspace model settings changed. Start a fresh Evaluation.",
            );
          captured = capture(configuration, workspaceId);
        }

        // Saved library entries are re-checked for logical deletion throughout.
        const documentId = submission.savedDocumentId;

        // An unreadable library is uncertainty, not proof of deletion; later checks still stop deleted work.
        const deleted = () => {
          if (!documentId) return false;

          try {
            return !libraryDocuments!.exists({ workspaceId, documentId });
          } catch {
            return false;
          }
        };

        if (documentId) {
          if (!libraryDocuments)
            throw new HttpError(503, "source_unavailable", "Saved Evaluation documents are unavailable.");

          if (deleted()) throw new HttpError(404, "document_not_found", "Evaluation document not found.");
          path = join(directory, randomUUID() + ".upload");
          owned.add(path);
          uploading++;
          let copied: Awaited<ReturnType<EvaluationDocumentSourceAccess["copyToTemporary"]>>;

          try {
            copied = await libraryDocuments.copyToTemporary({
              workspaceId,
              documentId,
              destinationPath: path,
              maxBytes,
              signal,
            });
          } catch {
            copied = { ok: false, reason: "unavailable" };
          } finally {
            uploading--;
          }

          if (!copied.ok)
            throw copied.reason === "not_found"
              ? new HttpError(404, "document_not_found", "Evaluation document not found.")
              : copied.reason === "missing"
                ? new HttpError(404, "source_missing", "The saved original is missing.")
                : copied.reason === "too_large"
                  ? new HttpError(
                      413,
                      "document_too_large",
                      "The saved original is larger than this Workspace's file limit.",
                    )
                  : new HttpError(
                      503,
                      "source_unavailable",
                      "The saved original is temporarily unavailable. Try again.",
                    );
          validateSourceFileMetadata(copied.mimeType, copied.size, maxBytes);
          mimeType = copied.mimeType;

          if (!authorized() || request.signal.aborted)
            throw new HttpError(403, "workspace_access_denied", "Workspace access is unavailable.");

          if (deleted()) throw new HttpError(404, "document_not_found", "Evaluation document not found.");
        }

        if (mimeType! === "application/pdf")
          await countPdfSourceFilePages(path!, request.signal);
        const sourcePath = path!;
        const sourceMimeType = mimeType!;
        const owner = randomUUID();
        const deadline = new AbortController();
        // Three gateway attempts, bounded preparation/queue waits, and two backoffs.
        // This expires only a submitted operation, never an idle browser Evaluation.
        const operationMs = Math.max(60000, requestTimeoutMs * 4 + 120000);
        const expiresAt = Date.now() + operationMs;
        let abandoned = false;
        let streamClosed = false;
        let remaining = submission.candidates.length;
        let controller: ReadableStreamDefaultController<Uint8Array>;
        const encoder = new TextEncoder();

        const close = () => {
          if (!streamClosed) {
            streamClosed = true;

            try {
              controller.close();
            } catch {
              /* Disconnected streams and failed deletion are settled independently. */
            }
          }
        };

        const abandon = () => {
          if (abandoned) return;
          abandoned = true;
          queue.discardTransient(owner);
          close();
        };

        const send = (event: JsonObject) => {
          if (abandoned || streamClosed) return;

          if (!authorized()) {
            abandon();

            return;
          }

          const bytes = encoder.encode(
            JSON.stringify({
              submissionId: submission.id,
              document_instance_id: submission.documentInstanceId,
              ...event,
            }) + "\n",
          );

          if (bytes.length > 4 * 1024 * 1024 || (controller.desiredSize ?? 0) < 0) {
            abandon();

            return;
          }

          try {
            controller.enqueue(bytes);
          } catch {
            abandon();
          }
        };

        const finish = async () => {
          let cleaned = false;

          try {
            await remove(sourcePath);
            cleaned = true;
          } catch {
            /* Disconnected streams and failed deletion are settled independently. */
          }

          owned.delete(sourcePath);
          submissions.delete(submissionKey!);
          send({ type: "cleanup", status: cleaned ? "complete" : "pending" });
          clearTimeout(timeout);
          clearInterval(heartbeat);
          clearInterval(deletionPoll);
          request.signal.removeEventListener("abort", abandon);
          abandonments.delete(abandon);
          send({ type: "complete" });
          close();

          if (action) {
            action.open--;
            idleAction(submission.actionId!, action);
          }
        };

        // Library deletion stops queued and retry-delayed work promptly; dispatched calls may still settle.
        let removed = false;

        const removal = () => {
          if (!removed && deleted()) {
            removed = true;
            queue.discardTransient(owner);
          }

          return removed;
        };

        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 2000);
        const deletionPoll = documentId ? setInterval(removal, deletionPollMs) : undefined;

        const timeout = setTimeout(() => {
          send({ type: "interrupted", message: "Evaluation operation timed out. Run again manually." });
          deadline.abort();
          abandon();
        }, operationMs);

        abandonments.add(abandon);
        request.signal.addEventListener("abort", abandon, { once: true });

        const stream = new ReadableStream<Uint8Array>(
          {
            start(c) {
              controller = c;

              for (const candidate of submission.candidates) {
                // Pair ownership spans revisions and disconnected streams until the pair truly settles.
                const key = [
                  sessionOwner,
                  workspaceId,
                  submission.evaluationId,
                  submission.documentInstanceId,
                  candidate.id,
                ].join(":");

                let done = false;
                let ownsKey = false;
                let queueMs = 0;
                let processingMs = 0;

                const terminal = () => {
                  if (done) return;
                  done = true;

                  if (ownsKey) outstanding.delete(key);

                  if (--remaining === 0) void finish();
                };

                const event = (type: string, attempt: number, extra: JsonObject = {}) =>
                  send({ type, candidateId: candidate.id, revision: candidate.revision, attempt, ...extra });

                const deletedFailure = (attempt: number, extra: JsonObject = {}) => {
                  event("failure", attempt, { code: "document_deleted", message: deletedMessage, ...extra });
                  terminal();
                };

                const schedule = (attempt: number, delay = 0) => {
                  if (abandoned || !authorized() || deadline.signal.aborted) {
                    terminal();

                    return;
                  }

                  if (removal()) {
                    deletedFailure(attempt);

                    return;
                  }

                  const queuedAt = Date.now();

                  if (delay > expiresAt - queuedAt) {
                    event("failure", attempt, { message: "Retry delay exceeds this run’s deadline. Try again later." });
                    terminal();

                    return;
                  }

                  const admission = queue.scheduleTransient({
                    kind: "evaluation",
                    owner,
                    job_id: owner + ":" + candidate.id,
                    workspace_id: workspaceId,
                    attempt,
                    enqueued_at: new Date(queuedAt).toISOString(),
                    not_before: new Date(queuedAt + delay).toISOString(),
                    discard: () => {
                      if (removed) deletedFailure(attempt);
                      else {
                        event("failure", attempt, { message: "Run interrupted. Run again manually." });
                        terminal();
                      }
                    },
                    async run() {
                      if (abandoned || !authorized() || deadline.signal.aborted) {
                        terminal();

                        return;
                      }

                      if (removal()) {
                        deletedFailure(attempt);

                        return;
                      }

                      queueMs += Date.now() - queuedAt;
                      event("running", attempt);
                      const startedAt = Date.now();

                      try {
                        let usage: ExtractionUsage | null = null;
                        // Receipts stay in memory: evaluation spend is shown per run, never persisted.
                        const receipts: ModelCallUsage[] = [];

                        const extracted = await extract(
                          {
                            AI_MODEL: candidate.model,
                            MODEL_GATEWAY_URL: captured.gateway_url,
                            LITELLM_KEY: captured.credential,
                            MODEL_GATEWAY_WORKSPACE_ID: workspaceId,
                            MODEL_GATEWAY_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
                            MODEL_GATEWAY_SEQUENTIAL_CALLS: String(captured.sequential_calls),
                            MODEL_SUPPORTS_PDF_INPUT: String(candidate.pdf),
                            MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(candidate.structured),
                            modelCallObserver: {
                              started: () => String(receipts.length),
                              finished: (_, receipt) => receipts.push(receipt),
                            },
                          },
                          candidate.fields,
                          Bun.file(sourcePath),
                          sourceMimeType,
                          deadline.signal,
                          (value) => {
                            usage = value;
                          },
                        );

                        const raw = extracted.flatMap((row) => {
                          if (!candidate.fields.some((field) => field.id === row.field_id)) return [];

                          type EvaluationResult = {
                            field_id: string;
                            status: string;
                            answer: JsonValue | undefined;
                            confidence?: number;
                            evidence?: string;
                          };

                          const result: EvaluationResult = {
                            field_id: row.field_id,
                            status: row.status,
                            answer: row.answer,
                          };

                          if (isNumber(row.confidence)) result.confidence = row.confidence;

                          if (isString(row.evidence)) result.evidence = row.evidence;

                          return [result];
                        });

                        if (JSON.stringify(raw).length > 1024 * 1024) throw new Error("Result limit exceeded");
                        processingMs += Date.now() - startedAt;
                        outcome("success");
                        event("success", attempt, {
                          result: {
                            raw,
                            fields: candidate.fields,
                            values: normalizeModelResults(candidate.fields, raw),
                            model: candidate.model,
                            pdf: candidate.pdf,
                            structured: candidate.structured,
                            queueMs,
                            processingMs,
                            attempts: attempt,
                            usage,
                            cost: receiptCost(receipts),
                          },
                        });
                        terminal();
                      } catch (error) {
                        processingMs += Date.now() - startedAt;
                        outcome(
                          error instanceof RetryableError && error.status === 429
                            ? "throttled"
                            : error instanceof Error && /timed out|timeout/i.test(error.message)
                              ? "timeout"
                              : "failed",
                        );

                        if (removal()) deletedFailure(attempt, { queueMs, processingMs });
                        else if (
                          !abandoned &&
                          authorized() &&
                          !deadline.signal.aborted &&
                          error instanceof RetryableError &&
                          attempt < EXTRACTION_MAX_ATTEMPTS
                        ) {
                          event("retrying", attempt, { queueMs, processingMs });
                          schedule(
                            attempt + 1,
                            extractionRetryDelay(attempt, Math.max(0, retryDelayMs), error.retryAfterMs),
                          );
                        } else {
                          event("failure", attempt, {
                            message: "Extraction failed. Check the model and try again.",
                            queueMs,
                            processingMs,
                          });
                          terminal();
                        }
                      }
                    },
                  });

                  if (admission === "accepted")
                    event(delay ? "retrying" : "queued", attempt, { admission: "accepted" });
                  else {
                    event("failure", attempt, {
                      admission,
                      message: admission === "full" ? "Queue full—try again" : "Run unavailable. Try again.",
                    });
                    terminal();
                  }
                };

                if (outstanding.has(key)) {
                  event("failure", 0, {
                    admission: "duplicate",
                    message: "This candidate already has an outstanding run.",
                  });
                  terminal();
                } else {
                  outstanding.add(key);
                  ownsKey = true;
                  schedule(1);
                }
              }
            },
            cancel: abandon,
          },
          { highWaterMark: 8 * 1024 * 1024, size: (bytes) => bytes?.byteLength ?? 0 },
        );

        transferred = true;

        if (action) {
          action.open++;
          clearTimeout(action.timer);
        }

        if (request.signal.aborted) abandon();

        return new Response(stream, {
          headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" },
        });
      } catch (error) {
        return fail(error);
      } finally {
        if (!transferred && ownsSubmission && submissionKey) submissions.delete(submissionKey);

        if (path && !transferred) {
          await remove(path).catch(() => {});
          owned.delete(path);
        }
      }
    },
  };
}
