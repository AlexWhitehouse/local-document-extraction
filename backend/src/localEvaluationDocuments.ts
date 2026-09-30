import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { parseExpectedAnswerSet, referenceFields, type ExpectedAnswerSet } from "./lib/evaluationReference";
import { HttpError } from "./lib/http";
import { newId, nowIso } from "./lib/ids";
import { boundLocalApiBody } from "./localApiBodyLimit";
import { attachmentDisposition, countLocalSourceFilePages, releaseWhenDone } from "./localApplication";
import type { LocalAuth } from "./localAuth";
import type { LocalSourceStorageConfiguration } from "./localConfiguration";
import type { EvaluationDocumentSourceAccess } from "./localEvaluations";
import type { LocalLiveUpdateHub } from "./localLiveUpdateHub";
import { LOCAL_EVALUATION_DOCUMENT_METADATA_BYTES, parseLocalMultipartSubmission } from "./localMultipartSubmission";
import { localRequestOriginFailure } from "./localRequestOrigin";
import type { LocalSourceFileStore } from "./localSourceFileStore";
import { listLocalWorkspaceIds } from "./localSourceFileRetention";
import type { LocalSourceObjectManifest } from "./localSourceObjectManifest";
import { ensurePrivateStateDirectory } from "./localStatePaths";
import type { LocalWorkspace, LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductDataAccess, LocalWorkspaceProductDataAccessError } from "./localWorkspaceProductDataAccess";
import type { LocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import type {
  LocalEvaluationDocumentDeletionIntent,
  LocalEvaluationDocumentSaveReceipt,
  LocalEvaluationDocumentSummary,
} from "./localWorkspaceProductStore";
import type { LocalWorkspaceProductStoreHandle, LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { SourceObjectMissingError, type SourceObjectStore } from "./s3SourceObjectStore";

/** Remote library originals: the object store, the installation manifest and the library key scheme. */
export type LocalEvaluationDocumentObjects = {
  store: SourceObjectStore;
  manifest: Pick<LocalSourceObjectManifest, "prepare" | "link" | "markDeleting" | "markOwnerDeleting">;
  keyFor(input: { workspaceId: string; documentId: string; mimeType: string }): string;
  maxConcurrentReads?: number;
};

export type LocalEvaluationDocumentsSnapshot = {
  deletionsCompleted: number;
  failures: number;
  orphansReclaimed: number;
  lastCompletedAt: string | null;
};

type SaveUnavailableReason = "storage_unconfigured" | "retention_disabled" | "workspace_opted_out";

/** Longer than any save can take, so an in-flight save's original is never treated as abandoned. */
const ORPHAN_GRACE_MS = 15 * 60_000;
const SWEEP_BATCH_SIZE = 500;
const ORPHAN_BATCH_SIZE = 1_000;
const DEFAULT_PAGE_SIZE = 50;
const NO_STORE = { "cache-control": "private, no-store" };
const OWNER_KIND = "evaluation_document";

class SourceUnavailableError extends Error {}

/**
 * The Workspace-shared Evaluation document library: session-only routes, a complete-save protocol
 * with idempotent receipts, conditional updates, logical deletion with background source cleanup,
 * and saved-original access for the temporary Evaluation runner.
 */
export function createLocalEvaluationDocuments({
  auth,
  workspaceControl,
  productStoreRegistry,
  operations,
  sourceFileStore,
  sourceStorage,
  sourceObjects,
  stateDirectory,
  liveUpdateHub,
  maxSourceFileBytes,
  now = Date.now,
}: {
  auth: LocalAuth;
  workspaceControl: Pick<LocalWorkspaceControl, "getAcceptedWorkspaceContext" | "workspaceExists">;
  productStoreRegistry: LocalWorkspaceProductStoreRegistry;
  operations: LocalWorkspaceProductOperations;
  sourceFileStore: LocalSourceFileStore;
  sourceStorage: LocalSourceStorageConfiguration;
  sourceObjects?: LocalEvaluationDocumentObjects;
  stateDirectory: string;
  liveUpdateHub?: Pick<LocalLiveUpdateHub, "broadcastEvaluationDocument">;
  maxSourceFileBytes: number;
  now?: () => number;
}) {
  const access = createLocalWorkspaceProductDataAccess({ registry: productStoreRegistry, operations });
  const uploadDirectory = join(stateDirectory, "temporary", "evaluation-documents");
  const evaluationDirectory = resolve(stateDirectory, "temporary", "evaluations");
  const ownedUploads = new Set<string>();
  const activeReads = { count: 0 };
  let uploading = 0;
  let activeSweep: Promise<void> | null = null;
  let orphanCursor: string | null = null;
  const snapshot: LocalEvaluationDocumentsSnapshot = { deletionsCompleted: 0, failures: 0, orphansReclaimed: 0, lastCompletedAt: null };
  const ready = (async () => {
    await ensurePrivateStateDirectory(stateDirectory, { recursive: true });
    await ensurePrivateStateDirectory(join(stateDirectory, "temporary"), { recursive: true });
    await ensurePrivateStateDirectory(uploadDirectory);
  })();

  const broadcast = (workspaceId: string, documentId: string, revision: number | null) => {
    try {
      liveUpdateHub?.broadcastEvaluationDocument(workspaceId, { documentId, revision, deleted: revision === null, occurredAt: nowIso() });
    } catch (error) {
      console.warn("Evaluation document live update failed", error);
    }
  };

  /** Hands a deleted entry's original to cleanup; the intent stays for the sweep until both succeed. */
  const releaseDeletedSource = async (workspaceId: string, store: LocalWorkspaceProductStoreHandle, intent: LocalEvaluationDocumentDeletionIntent) => {
    if (intent.retained_object_key) {
      if (!sourceObjects) throw new Error("A remote library original cannot be released without object cleanup");
      sourceObjects.manifest.markOwnerDeleting({ workspaceId, ownerKind: OWNER_KIND, ownerId: intent.document_id });
    }
    if (intent.source_file_key) await sourceFileStore.delete(intent.source_file_key);
    store.completeEvaluationDocumentDeletionIntent(intent.document_id);
    snapshot.deletionsCompleted += 1;
  };

  const readSource = async (source: { source_file_key: string | null; retained_object_key: string | null }) => {
    type Read = { ok: true; size: number; stream(): ReadableStream<Uint8Array>; release(): void } | { ok: false; reason: "missing" | "unavailable" };
    if (source.retained_object_key) {
      if (!sourceObjects || activeReads.count >= (sourceObjects.maxConcurrentReads ?? 8)) return { ok: false, reason: "unavailable" } as Read;
      activeReads.count += 1;
      let released = false;
      const release = () => { if (!released) { released = true; activeReads.count -= 1; } };
      try {
        const object = await sourceObjects.store.open(source.retained_object_key);
        return { ok: true, size: object.size, stream: () => object.stream(), release } as Read;
      } catch (error) {
        release();
        if (error instanceof SourceObjectMissingError) return { ok: false, reason: "missing" } as Read;
        console.warn("Evaluation document original could not be read from object storage", error);
        return { ok: false, reason: "unavailable" } as Read;
      }
    }
    try {
      if (!sourceFileStore.open) throw new Error("Source file store cannot open library originals");
      const file = await sourceFileStore.open(source.source_file_key!);
      return (file ? { ok: true, size: file.size, stream: () => file.stream(), release: () => {} } : { ok: false, reason: "missing" }) as Read;
    } catch (error) {
      console.warn("Evaluation document original could not be opened", error);
      return { ok: false, reason: "unavailable" } as Read;
    }
  };

  const sources: EvaluationDocumentSourceAccess = {
    exists: ({ workspaceId, documentId }) => {
      const lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });
      if (!lease) return false;
      try { return Boolean(lease.store.getEvaluationDocumentSource(documentId)); } finally { lease.release(); }
    },
    copyToTemporary: async ({ workspaceId, documentId, destinationPath, maxBytes, signal }) => {
      const path = relative(evaluationDirectory, resolve(destinationPath));
      if (!path || path.startsWith("..")) throw new Error("Evaluation working copies must stay in temporary Evaluation storage");
      const lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });
      let source;
      try { source = lease?.store.getEvaluationDocumentSource(documentId) ?? null; } finally { lease?.release(); }
      if (!source) return { ok: false, reason: "not_found" };
      if (source.source_byte_size > maxBytes) return { ok: false, reason: "too_large" };
      const read = await readSource(source);
      if (!read.ok) return read;
      try {
        const size = await writeBounded(read.stream(), destinationPath, maxBytes, signal);
        return { ok: true, mimeType: source.source_mime_type, size, name: source.source_name };
      } catch (error) {
        await rm(destinationPath, { force: true }).catch(() => {});
        if (signal.aborted) throw error;
        console.warn("Evaluation document original could not be copied for processing", error);
        return { ok: false, reason: "unavailable" };
      } finally {
        read.release();
      }
    },
  };

  const save = (request: Request, workspace: LocalWorkspace, current: () => LocalWorkspace | null, author: { userId: string; name: string }) => {
    // Captured once, when the server begins accepting the save; later setting changes apply to later saves.
    const status = saveStatus(sourceStorage, workspace);
    const workspaceId = workspace.id;
    return access.run({ workspaceId, mode: "create" }, async ({ store, signal: workspaceSignal }) => {
      const signal = AbortSignal.any([request.signal, workspaceSignal]);
      let temporaryPath: string | null = null;
      try {
        uploading += 1;
        let upload;
        try {
          upload = await parseLocalMultipartSubmission({
            request: new Request(request, { signal }), stateDirectory, purpose: "evaluation-document",
            maxSourceFileBytes: workspace.max_source_file_bytes ?? maxSourceFileBytes,
          });
          temporaryPath = upload.source.temporaryPath;
          ownedUploads.add(temporaryPath);
        } finally { uploading -= 1; }
        const metadata = parseSaveMetadata(upload.metadata!);
        const bytes = await Bun.file(temporaryPath).arrayBuffer();
        const sourceName = upload.source.name.trim() || null;
        const mimeType = upload.source.mimeType;
        const digest = createHash("sha256").update(JSON.stringify([
          "evaluation-document-v1", metadata.name, metadata.referenceJson, sourceName, mimeType, bytes.byteLength,
          createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
        ])).digest("hex");
        // A retry after a lost response recovers the original operation even if saving is now unavailable.
        const receipt = store.getEvaluationDocumentSaveReceipt(metadata.operationId);
        if (receipt) return replay(store, receipt, digest);
        if (!status.save_available) {
          return failure(403, "save_unavailable", "New library saves need retained original storage for this Workspace.", { reason: status.reason });
        }
        const pageCount = await countLocalSourceFilePages(mimeType, bytes, signal);
        signal.throwIfAborted();

        const documentId = newId("evd");
        let sourceFileKey: string | null = null;
        let objectKey: string | null = null;
        const release = async () => {
          if (objectKey) sourceObjects?.manifest.markDeleting({ objectKey });
          // A leftover directory is reclaimed by the orphan sweep.
          if (sourceFileKey) await sourceFileStore.deleteEvaluationDocumentDirectory?.({ workspaceId, documentId }).catch(() => {});
        };
        if (sourceStorage.provider === "s3") {
          objectKey = await publishOriginal({ objects: sourceObjects, workspaceId, documentId, mimeType, path: temporaryPath, signal });
        } else {
          if (!sourceFileStore.promoteEvaluationDocument) throw new SourceUnavailableError("Local library storage is unavailable");
          try {
            sourceFileKey = await sourceFileStore.promoteEvaluationDocument({ workspaceId, documentId, mimeType, temporaryPath });
          } catch (error) {
            console.warn("Evaluation document original could not be saved", error);
            throw new SourceUnavailableError("The original could not be saved");
          }
          ownedUploads.delete(temporaryPath);
          temporaryPath = null;
        }
        if (!current() || signal.aborted) {
          await release();
          signal.throwIfAborted();
          return failure(403, "workspace_access_denied", "Workspace access is unavailable.");
        }

        const reference = JSON.parse(metadata.referenceJson) as ExpectedAnswerSet;
        let committed;
        try {
          committed = store.insertEvaluationDocument({
            document: {
              id: documentId, name: metadata.name, source_name: sourceName, source_mime_type: mimeType, source_byte_size: bytes.byteLength,
              source_page_count: pageCount, source_file_key: sourceFileKey, retained_object_key: objectKey,
              reference_json: metadata.referenceJson, reference_fields_json: JSON.stringify(referenceFields(reference)), created_at: nowIso(),
            },
            author, operationId: metadata.operationId, digest,
          });
        } catch (error) {
          // Only an uncommitted entry may release its original; a committed one owns it.
          if (!store.getEvaluationDocumentSource(documentId)) await release();
          throw error;
        }
        if (!committed.inserted) {
          await release();
          return replay(store, committed.receipt, digest);
        }
        // The entry transaction is the durable save. Linking only records it for recovery, which links stale entries itself.
        if (objectKey) {
          try { sourceObjects!.manifest.link({ objectKey }); } catch (error) { console.warn("Library object manifest link failed; recovery will link it", error); }
        }
        broadcast(workspaceId, documentId, committed.document.revision);
        return respond({ document: summary(committed.document), reference }, 201);
      } catch (error) {
        if (error instanceof SourceUnavailableError) {
          return failure(503, "source_unavailable", "The original document couldn't be saved. Nothing was added to the library.", undefined, { "retry-after": "5" });
        }
        if (signal.aborted) return failure(499, "evaluation_document_save_cancelled", "Saving was cancelled.");
        if (error instanceof HttpError) return failure(error.status, error.code, error.message);
        throw error;
      } finally {
        if (temporaryPath) {
          await rm(temporaryPath, { force: true }).catch(() => {});
          ownedUploads.delete(temporaryPath);
        }
      }
    });
  };

  const update = async (request: Request, workspaceId: string, documentId: string, author: { userId: string; name: string }) => {
    let input: { expectedRevision: number; name?: string; reference?: ExpectedAnswerSet };
    try {
      const bounded = await boundLocalApiBody(request, LOCAL_EVALUATION_DOCUMENT_METADATA_BYTES);
      input = parseUpdate(await bounded.text());
    } catch (error) {
      if (error instanceof HttpError) return failure(error.status, error.code, error.message);
      return failure(400, "invalid_evaluation_document", "The update could not be read.");
    }
    return access.run({ workspaceId, mode: "existing" }, ({ store }) => {
      if (!store) return notFound();
      const result = store.updateEvaluationDocument({
        documentId, expectedRevision: input.expectedRevision, name: input.name, author, updatedAt: nowIso(),
        reference: input.reference && { json: JSON.stringify(input.reference), fieldsJson: JSON.stringify(referenceFields(input.reference)) },
      });
      if (result.status === "not_found") return notFound();
      const body = { document: summary(result.document), reference: JSON.parse(result.document.reference_json) };
      if (result.status === "conflict") {
        return respond({ error: { code: "revision_conflict", message: "Someone changed this saved document after you loaded it." }, current: body }, 409);
      }
      broadcast(workspaceId, documentId, result.document.revision);
      return respond(body);
    });
  };

  const remove = (workspaceId: string, documentId: string) => access.run({ workspaceId, mode: "existing" }, async ({ store }) => {
    if (!store) return notFound();
    const intent = store.deleteEvaluationDocument({ documentId, deletedAt: nowIso() });
    if (!intent) return notFound();
    broadcast(workspaceId, documentId, null);
    // Logical deletion is complete; physical cleanup that fails here is retried by the sweep.
    try { await releaseDeletedSource(workspaceId, store, intent); } catch (error) { console.warn("Library original cleanup deferred", error); }
    return new Response(null, { status: 204, headers: NO_STORE });
  });

  const download = (request: Request, workspaceId: string, documentId: string) => access.run({ workspaceId, mode: "existing" }, async ({ store }) => {
    const source = store?.getEvaluationDocumentSource(documentId);
    if (!source) return notFound();
    const read = await readSource(source);
    if (!read.ok) {
      return read.reason === "missing"
        ? failure(404, "source_missing", "The original document is missing from storage.")
        : failure(503, "source_unavailable", "The original document is temporarily unavailable.", undefined, { "retry-after": "5" });
    }
    const headers = new Headers({
      ...NO_STORE,
      "content-type": source.source_mime_type,
      "content-disposition": attachmentDisposition(source.source_name, source.source_mime_type),
      "content-length": String(read.size),
      "x-content-type-options": "nosniff",
    });
    if (request.method === "HEAD") { read.release(); return new Response(null, { headers }); }
    return new Response(releaseWhenDone(read.stream(), read.release), { headers });
  });

  const list = (url: URL, workspaceId: string) => {
    const search = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 200);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return failure(400, "invalid_limit", "limit must be between 1 and 100");
    const cursor = decodeCursor(url.searchParams.get("cursor"), search);
    if (cursor === false) return failure(400, "invalid_cursor", "The library cursor is invalid or does not match this search.");
    return access.run({ workspaceId, mode: "existing" }, ({ store }) => {
      const candidates = store?.listEvaluationDocuments({ cursor, search, limit: limit + 1 }) ?? [];
      const documents = candidates.slice(0, limit);
      const last = documents.at(-1);
      return respond({
        documents: documents.map(summary),
        next_cursor: candidates.length > limit && last ? encodeCursor(last.updated_at, last.id, search) : null,
      });
    });
  };

  const read = (workspaceId: string, documentId: string) => access.run({ workspaceId, mode: "existing" }, ({ store }) => {
    const document = store?.getEvaluationDocument(documentId);
    return document ? respond({ document: summary(document), reference: JSON.parse(document.reference_json) }) : notFound();
  });

  const removeAbandonedUploads = async () => {
    await ready;
    // A parse in progress has not reported its file yet, so no upload is abandoned while one runs.
    if (uploading) return;
    for (const entry of await readdir(uploadDirectory, { withFileTypes: true }).catch(() => [])) {
      // A save that started during the listing has not registered its file yet.
      if (uploading) return;
      const path = join(uploadDirectory, entry.name);
      if (entry.isFile() && /^[a-f0-9-]{36}\.upload$/.test(entry.name) && !ownedUploads.has(path)) await rm(path, { force: true }).catch(() => {});
    }
  };

  const retryDeletions = async () => {
    for (const workspaceId of await listLocalWorkspaceIds(stateDirectory)) {
      if (!workspaceControl.workspaceExists({ workspaceId })) continue;
      let lease;
      try {
        lease = productStoreRegistry.acquire({ workspaceId, mode: "existing" });
      } catch (error) {
        snapshot.failures += 1;
        console.warn("Library cleanup could not read Workspace product data", error);
        continue;
      }
      if (!lease) continue;
      try {
        for (const intent of lease.store.listEvaluationDocumentDeletionIntents({ limit: SWEEP_BATCH_SIZE })) {
          try { await releaseDeletedSource(workspaceId, lease.store, intent); } catch (error) {
            snapshot.failures += 1;
            console.warn("Library original cleanup failed; it will be retried", error);
          }
        }
      } catch (error) {
        snapshot.failures += 1;
        console.warn("Library cleanup could not read Workspace product data", error);
      } finally {
        lease.release();
      }
    }
  };

  /** Reclaims local originals no committed entry references. Unreadable product data is uncertainty, not proof. */
  const reclaimOrphans = async () => {
    const before = now() - ORPHAN_GRACE_MS;
    const directories = await sourceFileStore.listEvaluationDocumentDirectories?.({ limit: ORPHAN_BATCH_SIZE, after: orphanCursor }) ?? [];
    // Each sweep resumes where the last stopped, so large libraries are eventually covered.
    orphanCursor = directories.length < ORPHAN_BATCH_SIZE ? null : `${directories.at(-1)!.workspaceId}/${directories.at(-1)!.documentId}`;
    for (const directory of directories) {
      if (directory.modifiedAtMs > before) continue;
      // Workspace erasure removes a deleted Workspace's files.
      if (!workspaceControl.workspaceExists({ workspaceId: directory.workspaceId })) continue;
      let committed: boolean;
      try {
        const lease = productStoreRegistry.acquire({ workspaceId: directory.workspaceId, mode: "existing" });
        try { committed = Boolean(lease?.store.getEvaluationDocumentSource(directory.documentId)); } finally { lease?.release(); }
      } catch (error) {
        snapshot.failures += 1;
        console.warn("Library orphan recovery could not read Workspace product data", error);
        continue;
      }
      if (committed) continue;
      try {
        await sourceFileStore.deleteEvaluationDocumentDirectory!({ workspaceId: directory.workspaceId, documentId: directory.documentId });
        snapshot.orphansReclaimed += 1;
      } catch (error) {
        snapshot.failures += 1;
        console.warn("Library orphan cleanup failed; it will be retried", error);
      }
    }
  };

  // The code is repeated in a header because HEAD responses carry no body.
  const failure = (status: number, code: string, message: string, extra?: Record<string, unknown>, headers?: Record<string, string>) =>
    respond({ error: { code, message, ...extra } }, status, { "x-error-code": code, ...headers });
  const notFound = () => failure(404, "document_not_found", "This saved Evaluation document was not found.");

  return {
    sources,
    snapshot: () => ({ ...snapshot }),
    /** Background recovery: abandoned uploads, unfinished deletion cleanup and uncommitted local originals. */
    sweep: () => {
      activeSweep ??= (async () => {
        await removeAbandonedUploads();
        await retryDeletions();
        await reclaimOrphans();
        snapshot.lastCompletedAt = new Date(now()).toISOString();
      })().finally(() => { activeSweep = null; });
      return activeSweep;
    },
    async handle(request: Request): Promise<Response> {
      await ready;
      const url = new URL(request.url);
      const match = url.pathname.match(/^\/v1\/evaluations\/documents(?:\/([A-Za-z0-9_-]{1,80})(\/source)?)?$/);
      if (!match) return failure(404, "not_found", "Evaluation library route not found.");
      const [, documentId = "", source] = match;
      const { method } = request;
      if (request.headers.has("authorization")) return failure(403, "session_required", "The Evaluation library requires a browser session.");
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const rejection = localRequestOriginFailure(request, auth);
        if (rejection) return failure(403, "untrusted_origin", "Request origin is not trusted.");
      }
      const session = await auth.getSession(request);
      const workspaceId = request.headers.get("x-workspace-id")?.trim() || "";
      // Membership is re-read on every request and again before a save commits.
      const current = () => {
        try {
          if (!session || !(session.isActive?.() ?? true) || !workspaceId) return null;
          return workspaceControl.getAcceptedWorkspaceContext({ workspaceId, userId: session.id });
        } catch { return null; }
      };
      const workspace = current();
      if (!workspace) return failure(403, "workspace_access_denied", "Workspace access is unavailable.");
      const author = { userId: session!.id, name: session!.name || session!.email };
      try {
        if (source) return method === "GET" || method === "HEAD" ? await download(request, workspaceId, documentId) : routeNotFound();
        if (documentId === "status") return method === "GET" ? respond(saveStatus(sourceStorage, workspace)) : routeNotFound();
        if (!documentId) {
          if (method === "GET") return await list(url, workspaceId);
          if (method === "POST") return await save(request, workspace, current, author);
          return routeNotFound();
        }
        if (method === "GET") return await read(workspaceId, documentId);
        if (method === "PATCH") return await update(request, workspaceId, documentId, author);
        if (method === "DELETE") return await remove(workspaceId, documentId);
        return routeNotFound();
      } catch (error) {
        if (error instanceof LocalWorkspaceProductDataAccessError) {
          if (error.code === "workspace_deleting" || error.code === "workspace_invalidated") return failure(409, "workspace_deleting", "Workspace deletion is in progress");
          if (error.code === "capacity_exhausted" || error.code === "store_unavailable") {
            return failure(503, "local_product_store_unavailable", "Local Workspace product storage is temporarily unavailable.", undefined, { "retry-after": "1" });
          }
        }
        console.error("Evaluation library request failed", error);
        return failure(500, "internal_error", "Unexpected server error");
      }
    },
  };

  function routeNotFound() { return failure(404, "not_found", "Evaluation library route not found."); }

  function replay(store: LocalWorkspaceProductStoreHandle, receipt: LocalEvaluationDocumentSaveReceipt, digest: string): Response {
    if (receipt.digest !== digest) {
      return failure(409, "operation_conflict", "This save operation was already used for a different document or answers.");
    }
    const document = receipt.outcome === "saved" ? store.getEvaluationDocument(receipt.document_id) : null;
    if (!document) return failure(410, "document_deleted", "This saved document was deleted from the Evaluation library.");
    return respond({ document: summary(document), reference: JSON.parse(document.reference_json) });
  }
}

function respond(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function summary(document: LocalEvaluationDocumentSummary) {
  return {
    id: document.id,
    name: document.name,
    source_name: document.source_name,
    mime_type: document.source_mime_type,
    byte_size: document.source_byte_size,
    page_count: document.source_page_count,
    revision: document.revision,
    created_at: document.created_at,
    updated_at: document.updated_at,
    updated_by_name: document.updated_by_name,
    fields: JSON.parse(document.reference_fields_json),
  };
}

function saveStatus(sourceStorage: LocalSourceStorageConfiguration, workspace: Pick<LocalWorkspace, "source_retention_disabled">): { save_available: boolean; reason: SaveUnavailableReason | null } {
  const reason: SaveUnavailableReason | null = sourceStorage.provider === "none" ? "storage_unconfigured"
    : !sourceStorage.originalRetentionEnabled ? "retention_disabled"
      : workspace.source_retention_disabled ? "workspace_opted_out" : null;
  return { save_available: reason === null, reason };
}

/**
 * Uploads a library original before its entry commits. The manifest entry is recorded first so a crash
 * or late write can always be found; recovery links it only if the committed entry references it.
 */
async function publishOriginal({ objects, workspaceId, documentId, mimeType, path, signal }: {
  objects?: LocalEvaluationDocumentObjects; workspaceId: string; documentId: string; mimeType: string; path: string; signal: AbortSignal;
}): Promise<string> {
  if (!objects) throw new SourceUnavailableError("Object storage is not available for library originals");
  const objectKey = objects.keyFor({ workspaceId, documentId, mimeType });
  try {
    objects.manifest.prepare({ objectKey, workspaceId, ownerKind: OWNER_KIND, ownerId: documentId });
  } catch (error) {
    console.warn("Library object manifest entry could not be recorded", error);
    throw new SourceUnavailableError("The original could not be saved");
  }
  try {
    await objects.store.put({ key: objectKey, file: Bun.file(path), mimeType });
    signal.throwIfAborted();
  } catch (error) {
    objects.manifest.markDeleting({ objectKey });
    if (signal.aborted) throw error;
    console.warn("Library original could not be saved to object storage", error);
    throw new SourceUnavailableError("The original could not be saved");
  }
  return objectKey;
}

async function writeBounded(stream: ReadableStream<Uint8Array>, path: string, maxBytes: number, signal: AbortSignal): Promise<number> {
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      callback(size > maxBytes ? new Error("Library original exceeds the processing limit") : null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(stream as never), limit, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
  return size;
}

const invalidDocument = (message: string) => new HttpError(400, "invalid_evaluation_document", message);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 200) throw invalidDocument("name must be 1 to 200 characters");
  return name;
}

function parseSaveMetadata(raw: string): { operationId: string; name: string; referenceJson: string } {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw invalidDocument("metadata must be JSON"); }
  if (!isObject(input) || Object.keys(input).some((key) => !["operation_id", "name", "reference"].includes(key))) {
    throw invalidDocument("metadata needs operation_id, name and reference only");
  }
  if (typeof input.operation_id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.operation_id)) {
    throw invalidDocument("operation_id must be 1 to 80 letters, digits, underscores or hyphens");
  }
  const name = parseName(input.name);
  return { operationId: input.operation_id, name, referenceJson: JSON.stringify(parseExpectedAnswerSet(input.reference)) };
}

function parseUpdate(raw: string): { expectedRevision: number; name?: string; reference?: ExpectedAnswerSet } {
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw invalidDocument("The update must be JSON"); }
  if (!isObject(input) || Object.keys(input).some((key) => !["expected_revision", "name", "reference"].includes(key))) {
    throw invalidDocument("The update accepts expected_revision, name and reference only");
  }
  const revision = input.expected_revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) throw invalidDocument("expected_revision must be a positive integer");
  if (input.name === undefined && input.reference === undefined) throw invalidDocument("Provide a name or reference to update");
  return {
    expectedRevision: revision,
    ...(input.name !== undefined ? { name: parseName(input.name) } : {}),
    ...(input.reference !== undefined ? { reference: parseExpectedAnswerSet(input.reference) } : {}),
  };
}

function encodeCursor(updatedAt: string, documentId: string, search: string): string {
  return Buffer.from(JSON.stringify([updatedAt, documentId, search]), "utf8").toString("base64url");
}

/** Cursors are bound to the search they were issued for; false means invalid. */
function decodeCursor(cursor: string | null, search: string): { updatedAt: string; documentId: string } | null | false {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3 || parsed.some((value) => typeof value !== "string") || parsed[2] !== search) return false;
    return { updatedAt: parsed[0], documentId: parsed[1] };
  } catch {
    return false;
  }
}
