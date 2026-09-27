import { extractionRetryDelay, EXTRACTION_MAX_ATTEMPTS } from "./extractionRetryPolicy";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runExtraction, RetryableError, type ExtractionUsage } from "./consumer/modelGateway";
import { normalizeModelResults } from "./consumer/modelResultNormalizer";
import { HttpError } from "./lib/http";
import { validateTemplatePayload } from "./lib/validation";
import type { FieldDefinition } from "./lib/types";
import { countPdfSourceFilePages } from "./lib/sourceFilePageCount";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import type { LocalExtractionQueue } from "./localExtractionQueue";
import { parseLocalMultipartSubmission } from "./localMultipartSubmission";
import { localRequestOriginFailure } from "./localRequestOrigin";
import { ensurePrivateStateDirectory } from "./localStatePaths";
import { configurationMissing, createWorkspaceCredentialVault } from "./workspaceModelConfiguration";

export const EVALUATION_METADATA_BYTES = 1024 * 1024 + 8192;
type Candidate = { id: string; revision: number; model: string; pdf: boolean; structured: boolean; fields: FieldDefinition[] };
type Submission = { id: string; evaluationId: string; revision: number; mode: "models" | "templates"; candidates: Candidate[] };
const invalid = () => new HttpError(400, "invalid_evaluation", "Provide one to eight valid Evaluation candidates.");
function validate(value: unknown): Submission {
  if (!value || typeof value !== "object") throw invalid();
  const input = value as Submission;
  const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
  if (!id(input.id) || !id(input.evaluationId) || !Number.isSafeInteger(input.revision) || !["models", "templates"].includes(input.mode) || !Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 8) throw invalid();
  const seen = new Set<string>();
  const candidates = input.candidates.map(candidate => {
    if (!candidate || !id(candidate.id) || seen.has(candidate.id) || !Number.isSafeInteger(candidate.revision) || typeof candidate.model !== "string" || !candidate.model.trim() || candidate.model.length > 256 || /[\r\n\0]/.test(candidate.model) || typeof candidate.pdf !== "boolean" || typeof candidate.structured !== "boolean") throw invalid();
    seen.add(candidate.id);
    const fields = validateTemplatePayload({ name: "Evaluation", fields: candidate.fields }).fields!;
    return { id: candidate.id, revision: candidate.revision, model: candidate.model.trim(), pdf: candidate.pdf, structured: candidate.structured, fields };
  });
  const first = candidates[0];
  if (candidates.some(c => input.mode === "models" ? JSON.stringify(c.fields) !== JSON.stringify(first.fields) : c.model !== first.model || c.pdf !== first.pdf || c.structured !== first.structured)) throw invalid();
  return { id: input.id, evaluationId: input.evaluationId, revision: input.revision, mode: input.mode, candidates };
}

/** Request-owned computation only: no jobs, results, references or replay records are persisted. */
export function createLocalEvaluations({ auth, workspaceControl, productStoreRegistry, stateDirectory, queue,
  maxSourceFileBytes, requestTimeoutMs = 300000, retryDelayMs = 1000, extract = runExtraction,
  remove = (path: string) => rm(path, { force: true }), onGatewayOutcome,
}: {
  auth: LocalAuth; workspaceControl: LocalWorkspaceControl; productStoreRegistry: LocalWorkspaceProductStoreRegistry;
  stateDirectory: string; queue: LocalExtractionQueue; maxSourceFileBytes: number; requestTimeoutMs?: number; retryDelayMs?: number;
  extract?: typeof runExtraction; remove?: (path: string) => Promise<void>;
  onGatewayOutcome?: (outcome: "failed" | "success" | "throttled" | "timeout") => void;
}) {
  const directory = join(stateDirectory, "temporary", "evaluations");
  const owned = new Set<string>();
  const outstanding = new Set<string>();
  const submissions = new Set<string>();
  const abandonments = new Set<() => void>();
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
      const path = join(directory, entry.name);
      if (entry.isFile() && /^[a-f0-9-]{36}\.upload$/.test(entry.name) && !owned.has(path)) await remove(path).catch(() => {});
    }
  };
  const ready = sweep();
  const timer = setInterval(() => { void sweep().catch(() => {}); }, 30000);
  timer.unref();
  const outcome = (value: "failed" | "success" | "throttled" | "timeout") => {
    try { onGatewayOutcome?.(value); } catch { /* Resource observers cannot change extraction outcomes. */ }
  };
  const fail = (error: unknown) => error instanceof HttpError
    ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    : Response.json({ error: { code: "evaluation_failed", message: "Evaluation could not be started. Check the document and try again." } }, { status: 400 });
  return {
    sweep,
    close() { closed = true; clearInterval(timer); for (const abandon of abandonments) abandon(); },
    async handle(request: Request): Promise<Response> {
      let path: string | undefined;
      let transferred = false;
      let submissionKey: string | undefined;
      let ownsSubmission = false;
      try {
        await ready;
        if (closed) throw new HttpError(503, "unavailable", "Evaluations are unavailable.");
        if (request.headers.has("authorization")) throw new HttpError(403, "session_required", "Evaluations require a browser session.");
        const origin = localRequestOriginFailure(request, auth);
        if (origin) return origin;
        const session = await auth.getSession(request);
        const workspaceId = request.headers.get("x-workspace-id") || "";
        const authorized = () => {
          try { return Boolean(session && (session.isActive?.() ?? true) && workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id })); }
          catch { return false; }
        };
        if (!authorized()) throw new HttpError(403, "workspace_access_denied", "Workspace access is unavailable.");
        const workspace = workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session!.id })!;
        const readStore = <T>(read: (store: NonNullable<ReturnType<typeof productStoreRegistry.acquire>>["store"]) => T) => {
          const lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });
          if (!lease) throw configurationMissing();
          try { return read(lease.store); } finally { lease.release(); }
        };
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/v1/evaluations/setup") {
          const configuration = readStore(store => store.getModelConfiguration());
          return Response.json(configuration ? { configured: true, revision: configuration.revision, model: configuration.model_name, pdf: configuration.supports_pdf_input, structured: configuration.supports_structured_output, sequential: configuration.sequential_calls } : { configured: false }, { headers: { "cache-control": "no-store" } });
        }
        const templateMatch = url.pathname.match(/^\/v1\/evaluations\/templates\/([a-zA-Z0-9_-]+)$/);
        if (request.method === "GET" && templateMatch) {
          const version = url.searchParams.has("version") ? Number(url.searchParams.get("version")) : undefined;
          const template = readStore(store => store.getTemplate(templateMatch[1], version));
          if (!template) throw new HttpError(404, "template_not_found", "Template field version not found.");
          return Response.json(template, { headers: { "cache-control": "no-store" } });
        }
        if (request.method !== "POST" || url.pathname !== "/v1/evaluations/run") throw new HttpError(404, "not_found", "Evaluation route not found.");
        const submissionHeader = request.headers.get("x-evaluation-submission") || "";
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(submissionHeader)) throw invalid();
        submissionKey = [session!.id, workspaceId, submissionHeader].join(":");
        if (submissions.has(submissionKey)) throw new HttpError(409, "duplicate_submission", "This submission is already in progress.");
        submissions.add(submissionKey);
        ownsSubmission = true;
        uploading++;
        let upload;
        try {
          upload = await parseLocalMultipartSubmission({ request: new Request(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(60000, requestTimeoutMs))]) }), stateDirectory, purpose: "evaluation", maxSourceFileBytes: workspace.max_source_file_bytes ?? maxSourceFileBytes });
          path = upload.source.temporaryPath;
          owned.add(path);
        } finally { uploading--; }
        let parsed: unknown;
        try { parsed = JSON.parse(upload.evaluation!); } catch { throw invalid(); }
        const submission = validate(parsed);
        if (submission.id !== submissionHeader) throw invalid();
        if (!authorized() || request.signal.aborted) throw new HttpError(403, "workspace_access_denied", "Workspace access is unavailable.");
        const configuration = readStore(store => store.getModelConfiguration());
        if (!configuration) throw configurationMissing();
        if (submission.revision !== configuration.revision) throw new HttpError(409, "configuration_changed", "Workspace model settings changed. Start a fresh Evaluation.");
        const credential = createWorkspaceCredentialVault(stateDirectory).decrypt(workspaceId, configuration.credential_ciphertext);
        if (upload.source.mimeType === "application/pdf") await countPdfSourceFilePages(await Bun.file(path).arrayBuffer(), request.signal);
        const sourcePath = path;
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
        const close = () => { if (!streamClosed) { streamClosed = true; try { controller.close(); } catch { /* Disconnected streams and failed deletion are settled independently. */ } } };
        const abandon = () => { if (abandoned) return; abandoned = true; queue.discardTransient(owner); close(); };
        const send = (event: Record<string, unknown>) => {
          if (abandoned || streamClosed) return;
          if (!authorized()) { abandon(); return; }
          const bytes = encoder.encode(JSON.stringify({ submissionId: submission.id, ...event }) + "\n");
          if (bytes.length > 4 * 1024 * 1024 || (controller.desiredSize ?? 0) < 0) { abandon(); return; }
          try { controller.enqueue(bytes); } catch { abandon(); }
        };
        const finish = async () => {
          let cleaned = false;
          try { await remove(sourcePath); cleaned = true; } catch { /* Disconnected streams and failed deletion are settled independently. */ }
          owned.delete(sourcePath);
          submissions.delete(submissionKey!);
          send({ type: "cleanup", status: cleaned ? "complete" : "pending" });
          clearTimeout(timeout); clearInterval(heartbeat);
          request.signal.removeEventListener("abort", abandon);
          abandonments.delete(abandon);
          send({ type: "complete" }); close();
        };
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 2000);
        const timeout = setTimeout(() => { send({ type: "interrupted", message: "Evaluation operation timed out. Run again manually." }); deadline.abort(); abandon(); }, operationMs);
        abandonments.add(abandon);
        request.signal.addEventListener("abort", abandon, { once: true });
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c;
            for (const candidate of submission.candidates) {
              const key = [session!.id, workspaceId, submission.evaluationId, candidate.id].join(":");
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
              const event = (type: string, attempt: number, extra: Record<string, unknown> = {}) => send({ type, candidateId: candidate.id, revision: candidate.revision, attempt, ...extra });
              const schedule = (attempt: number, delay = 0) => {
                if (abandoned || !authorized() || deadline.signal.aborted) { terminal(); return; }
                const queuedAt = Date.now();
                if (delay > expiresAt - queuedAt) {
                  event("failure", attempt, { message: "Retry delay exceeds this run’s deadline. Try again later." }); terminal(); return;
                }
                const admission = queue.scheduleTransient({
                  kind: "evaluation", owner, job_id: owner + ":" + candidate.id, workspace_id: workspaceId,
                  attempt, enqueued_at: new Date(queuedAt).toISOString(), not_before: new Date(queuedAt + delay).toISOString(),
                  discard: () => { event("failure", attempt, { message: "Run interrupted. Run again manually." }); terminal(); },
                  async run() {
                    if (abandoned || !authorized() || deadline.signal.aborted) { terminal(); return; }
                    queueMs += Date.now() - queuedAt;
                    event("running", attempt);
                    const startedAt = Date.now();
                    try {
                      let usage: ExtractionUsage | null = null;
                      const extracted = await extract({ AI_MODEL: candidate.model, MODEL_GATEWAY_URL: configuration.gateway_url, LITELLM_KEY: credential,
                        MODEL_GATEWAY_WORKSPACE_ID: workspaceId, MODEL_GATEWAY_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
                        MODEL_GATEWAY_SEQUENTIAL_CALLS: String(configuration.sequential_calls), MODEL_SUPPORTS_PDF_INPUT: String(candidate.pdf), MODEL_SUPPORTS_STRUCTURED_OUTPUT: String(candidate.structured),
                      }, candidate.fields, Bun.file(sourcePath), upload.source.mimeType, deadline.signal, value => { usage = value; });
                      const raw = extracted.filter(row => candidate.fields.some(f => f.id === row.field_id)).map(row => ({
                        field_id: row.field_id, status: row.status, answer: row.answer,
                        ...(typeof row.confidence === "number" ? { confidence: row.confidence } : {}),
                        ...(typeof row.evidence === "string" ? { evidence: row.evidence } : {}),
                      }));
                      if (JSON.stringify(raw).length > 1024 * 1024) throw new Error("Result limit exceeded");
                      processingMs += Date.now() - startedAt;
                      outcome("success");
                      event("success", attempt, { result: { raw, fields: candidate.fields, values: normalizeModelResults(candidate.fields, raw), model: candidate.model, pdf: candidate.pdf, structured: candidate.structured, queueMs, processingMs, attempts: attempt, usage } });
                      terminal();
                    } catch (error) {
                      processingMs += Date.now() - startedAt;
                      outcome(error instanceof RetryableError && error.status === 429 ? "throttled" : error instanceof Error && /timed out|timeout/i.test(error.message) ? "timeout" : "failed");
                      if (!abandoned && authorized() && !deadline.signal.aborted && error instanceof RetryableError && attempt < EXTRACTION_MAX_ATTEMPTS) {
                        event("retrying", attempt, { queueMs, processingMs });
                        schedule(attempt + 1, extractionRetryDelay(attempt, Math.max(0, retryDelayMs), error.retryAfterMs));
                      } else { event("failure", attempt, { message: "Extraction failed. Check the model and try again.", queueMs, processingMs }); terminal(); }
                    }
                  },
                });
                if (admission === "accepted") event(delay ? "retrying" : "queued", attempt, { admission: "accepted" });
                else { event("failure", attempt, { admission, message: admission === "full" ? "Queue full—try again" : "Run unavailable. Try again." }); terminal(); }
              };
              if (outstanding.has(key)) { event("failure", 0, { admission: "duplicate", message: "This candidate already has an outstanding run." }); terminal(); }
              else { outstanding.add(key); ownsKey = true; schedule(1); }
            }
          }, cancel: abandon,
        }, { highWaterMark: 8 * 1024 * 1024, size: bytes => bytes?.byteLength ?? 0 });
        transferred = true;
        if (request.signal.aborted) abandon();
        return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" } });
      } catch (error) { return fail(error); }
      finally {
        if (!transferred && ownsSubmission && submissionKey) submissions.delete(submissionKey);
        if (path && !transferred) { await remove(path).catch(() => {}); owned.delete(path); }
      }
    },
  };
}
