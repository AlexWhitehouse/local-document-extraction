import { type JsonValue, isNumber } from "../../shared/json";

import { readObjectResponse, jsonTextFields } from "./testing/responseFixture";
import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";

import type { LocalSourceStorageConfiguration, S3SourceStorageConfiguration } from "./localConfiguration";
import { createLocalEvaluationDocuments } from "./localEvaluationDocuments";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceObjectCleanup } from "./localSourceObjectCleanup";
import { createLocalSourceObjectManifest, type LocalSourceObjectManifest } from "./localSourceObjectManifest";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";

import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import {
  createLocalWorkspaceProductStoreRegistry,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";
import { createS3SourceObjectStore, evaluationDocumentObjectKey, retainedObjectKey } from "./s3SourceObjectStore";
import { startFakeS3Server } from "./testing/fakeS3Server";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";

function evaluationDocument(value: JsonValue | undefined) {
  const document = jsonTextFields(value, "id", "name");

  if (!isNumber(document.revision) || !Number.isSafeInteger(document.revision) || document.revision < 1)
    throw new Error("Expected a positive document revision");

  return { ...document, revision: document.revision };
}

async function readDocumentResponse(response: Response) {
  const payload = await readObjectResponse(response);

  return { ...payload, document: evaluationDocument(payload.document) };
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const LATER = 60 * 60_000;

const WORKSPACE_ID = "workspace_a";

const reference = {
  version: 1,
  definitions: { "total:number": { name: "Total", data_type: "number" } },
  references: { "total:number": { verified: true, value: 0 } },
};

async function harness({
  provider = "s3",
  manifestOverride = {},
  sourceFileOverride = {},
}: {
  provider?: "s3" | "local";
  manifestOverride?: Partial<LocalSourceObjectManifest>;
  sourceFileOverride?: Partial<LocalSourceFileStore>;
} = {}) {
  const s3 = startFakeS3Server();
  cleanups.push(s3.stop);
  const stateDirectory = await mkdtemp(join(tmpdir(), "evaluation-document-recovery-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));

  const workspace = workspaceFixture({
    id: WORKSPACE_ID,
    name: "A",
    max_source_file_bytes: 1024 * 1024,
    source_retention_disabled: false,
    role: "member",
  });

  let workspaceExists = true;
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  configureTestWorkspace({ stateDirectory, workspaceId: WORKSPACE_ID });
  const lease = registry.acquire({ workspaceId: WORKSPACE_ID, mode: "existing" })!;

  try {
    lease.store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: null,
      fields: [{ id: "total", name: "Total", data_type: "number", description: "Invoice total" }],
      createdAt: new Date().toISOString(),
    });
  } finally {
    lease.release();
  }

  const controlDatabase = new Database(":memory:");
  cleanups.push(() => controlDatabase.close());
  const realManifest = createLocalSourceObjectManifest(controlDatabase);
  const manifest = { ...realManifest, ...manifestOverride };

  const configuration: S3SourceStorageConfiguration = {
    bucket: "documents",
    region: "us-east-1",
    endpoint: s3.endpoint,
    forcePathStyle: true,
    prefix: "document-extraction/",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
  };

  const store = createS3SourceObjectStore(configuration, { writeDeadlineMs: 2_000, readDeadlineMs: 2_000 });
  const namespace = manifest.namespace();
  const sourceFiles = { ...createLocalSourceFileStore({ stateDirectory }), ...sourceFileOverride };

  const sourceStorage: LocalSourceStorageConfiguration =
    provider === "s3"
      ? { provider: "s3", originalRetentionEnabled: true, s3: configuration }
      : { provider: "local", originalRetentionEnabled: true };

  const workspaceControl = workspaceControlFixture({
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => (apiKey === "key-a" ? workspace : null),
    getAcceptedWorkspaceContext: ({ workspaceId }: { workspaceId: string }) =>
      workspaceExists && workspaceId === WORKSPACE_ID ? workspace : null,
    hasPendingStarterTemplateBootstrap: () => false,
    workspaceExists: () => workspaceExists,
  });

  const auth = {
    handler: async () => new Response(null),
    getSession: async () => ({ id: "user_a", email: "ada@example.com", name: "Ada" }),
  };

  const operations = createLocalWorkspaceProductOperations();

  const library = ({
    now = Date.now,
    productStoreRegistry = registry,
  }: { now?: () => number; productStoreRegistry?: LocalWorkspaceProductStoreRegistry } = {}) =>
    createLocalEvaluationDocuments({
      auth,
      workspaceControl,
      productStoreRegistry,
      operations,
      sourceFileStore: sourceFiles,
      sourceStorage,
      stateDirectory,
      maxSourceFileBytes: 1024 * 1024,
      now,
      sourceObjects:
        provider === "s3"
          ? {
              store,
              manifest,
              keyFor: (input) => evaluationDocumentObjectKey({ prefix: configuration.prefix, namespace, ...input }),
            }
          : undefined,
    });

  const service = library();

  const application = createLocalApplication({
    auth,
    workspaceControl,
    stateDirectory,
    productStoreRegistry: registry,
    sourceFileStore: sourceFiles,
    sourceStorage,
    workspaceProductOperations: operations,
    evaluationDocuments: service,
    scheduleQueuedJob: async () => {},
    sourceObjects:
      provider === "s3"
        ? {
            store,
            manifest,
            keyFor: (input) => retainedObjectKey({ prefix: configuration.prefix, namespace, ...input }),
          }
        : undefined,
  });

  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-workspace-id", WORKSPACE_ID);

    return application(new Request(`http://localhost/v1/evaluations/documents${path}`, { ...init, headers }));
  };

  const save = (operationId: string = crypto.randomUUID(), bytes = new Uint8Array([137, 80, 78, 71])) => {
    const form = new FormData();
    form.set("document", new File([bytes], "invoice.png", { type: "image/png" }));
    form.set("metadata", JSON.stringify({ operation_id: operationId, name: "Invoice", reference }));

    return call("", { method: "POST", body: form });
  };

  const saved = async () => {
    const response = await save();
    expect(response.status).toBe(201);

    return (await readDocumentResponse(response)).document.id;
  };

  const submitJob = () => {
    const body = new FormData();
    body.set("document", new File([new Uint8Array([137, 80, 78, 71])], "invoice.png", { type: "image/png" }));
    body.set("template_id", "tpl_invoice");

    return application(
      new Request("http://localhost/v1/extract", { method: "POST", body, headers: { authorization: "Bearer key-a" } }),
    );
  };

  const product = <T>(read: (store: NonNullable<ReturnType<typeof registry.acquire>>["store"]) => T) => {
    const current = registry.acquire({ workspaceId: WORKSPACE_ID, mode: "existing" })!;

    try {
      return read(current.store);
    } finally {
      current.release();
    }
  };

  const cleanupAt = (at: number) =>
    createLocalSourceObjectCleanup({
      manifest: realManifest,
      objectStore: store,
      productStoreRegistry: registry,
      workspaceControl,
      now: () => at,
      random: () => 0.5,
    });

  const libraryFiles = async () =>
    (await readdir(join(stateDirectory, "source-files"), { recursive: true }).catch(() => new Array<string>()))
      .map(String)
      .filter((name) => name.includes("evaluation-documents/"));

  const uploads = () => readdir(join(stateDirectory, "temporary", "evaluation-documents"));

  return {
    s3,
    manifest: realManifest,
    store,
    registry,
    stateDirectory,
    sourceFiles,
    namespace,
    service,
    library,
    call,
    save,
    saved,
    submitJob,
    product,
    cleanupAt,
    libraryFiles,
    uploads,
    setWorkspaceExists: (value: boolean) => {
      workspaceExists = value;
    },
  };
}

test("an S3 library save puts one object in the library namespace before commit and deletion hands it to background cleanup", async () => {
  const h = await harness();
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2]);
  const response = await h.save(undefined, bytes);
  expect(response.status).toBe(201);
  const { document } = await readDocumentResponse(response);
  const key = h.product((store) => store.getEvaluationDocumentSource(document.id))!.retained_object_key!;
  expect(key).toMatch(
    new RegExp(
      `^document-extraction/${h.namespace}/workspaces/${WORKSPACE_ID}/evaluation-documents/${document.id}/[0-9a-f-]{36}\\.png$`,
    ),
  );
  expect(h.s3.objects.get(key)?.bytes).toEqual(bytes);
  expect(h.s3.state.multipartRequests).toBe(0);
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 1, deleting: 0 });
  // No local copy is kept, and the save's own upload is gone.
  expect(await h.libraryFiles()).toEqual([]);
  expect(await h.uploads()).toEqual([]);
  expect(new Uint8Array(await (await h.call(`/${document.id}/source`)).arrayBuffer())).toEqual(bytes);

  h.s3.state.down = true;
  const unavailable = await h.call(`/${document.id}/source`);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ error: { code: "source_unavailable" } });
  // Deletion is logical at once and never waits on object storage.
  expect((await h.call(`/${document.id}`, { method: "DELETE" })).status).toBe(204);
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 1 });
  expect(h.product((store) => store.listEvaluationDocumentDeletionIntents({ limit: 10 }))).toEqual([]);
  await h.cleanupAt(Date.now() + LATER).run();
  expect(h.s3.objects.has(key)).toBe(true);
  h.s3.state.down = false;
  await h.cleanupAt(Date.now() + 2 * LATER).run();
  expect(h.s3.objects.has(key)).toBe(false);
  expect(h.manifest.counts().deleting).toBe(0);
});

test("a missing S3 library object is reported separately from an outage", async () => {
  const h = await harness();
  const id = await h.saved();
  h.s3.objects.clear();
  const missing = await h.call(`/${id}/source`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "source_missing" } });
  expect((await h.call(`/${id}`)).status).toBe(200);
});

test("a storage outage during save keeps nothing selectable and leaves only recoverable cleanup", async () => {
  const h = await harness();
  h.s3.state.down = true;
  const response = await h.save("op_outage");
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("5");
  expect(await response.json()).toMatchObject({ error: { code: "source_unavailable" } });
  expect(await (await h.call("")).json()).toEqual({ documents: [], next_cursor: null });
  expect(h.product((store) => store.getEvaluationDocumentSaveReceipt("op_outage"))).toBeNull();
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 1 });
  expect(await h.uploads()).toEqual([]);
  // The same operation succeeds once storage returns, because nothing was committed for it.
  h.s3.state.down = false;
  expect((await h.save("op_outage")).status).toBe(201);
});

test("recovery links a committed library object whose link was lost and releases uploads no entry references", async () => {
  let failLink = true;

  const h = await harness({
    manifestOverride: {
      link: (input) => {
        if (failLink) throw new Error("control database I/O error");

        return realLink(input);
      },
    },
  });

  const realLink = h.manifest.link;
  const id = await h.saved();
  failLink = false;
  expect(h.manifest.counts()).toEqual({ preparing: 1, linked: 0, deleting: 0 });

  // A crash after the object upload but before the entry committed.
  const orphanKey = evaluationDocumentObjectKey({
    prefix: "document-extraction/",
    namespace: h.namespace,
    workspaceId: WORKSPACE_ID,
    documentId: "evd_never_committed",
    mimeType: "image/png",
  });

  h.manifest.prepare({
    objectKey: orphanKey,
    workspaceId: WORKSPACE_ID,
    ownerKind: "evaluation_document",
    ownerId: "evd_never_committed",
  });
  await h.store.put({ key: orphanKey, file: new Blob([new Uint8Array([1])]), mimeType: "image/png" });

  await h.cleanupAt(Date.now()).run();
  expect(h.manifest.counts()).toEqual({ preparing: 2, linked: 0, deleting: 0 });

  // Unreadable product data is uncertainty: neither entry is settled.
  const unreadable = createLocalSourceObjectCleanup({
    manifest: h.manifest,
    objectStore: h.store,
    workspaceControl: { workspaceExists: () => true },
    now: () => Date.now() + LATER,
    productStoreRegistry: {
      ...h.registry,
      acquire: () => {
        throw new Error("database is locked");
      },
    },
  });

  await unreadable.run();
  expect(h.manifest.counts()).toEqual({ preparing: 2, linked: 0, deleting: 0 });

  // The committed entry's object is linked; the orphan is released and, past the late-write window, removed.
  await h.cleanupAt(Date.now() + LATER).run();
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 1, deleting: 0 });
  expect(h.s3.objects.has(orphanKey)).toBe(false);
  expect((await h.call(`/${id}/source`)).status).toBe(200);
});

test("local crash windows reclaim abandoned uploads and uncommitted originals but keep committed ones and uncertain reads", async () => {
  const h = await harness({ provider: "local" });
  const committed = await h.saved();

  const orphanDirectory = join(
    h.stateDirectory,
    "source-files",
    "workspaces",
    WORKSPACE_ID,
    "evaluation-documents",
    "evd_crashed",
  );

  await mkdir(orphanDirectory, { recursive: true });
  await Bun.write(join(orphanDirectory, "source.png"), new Uint8Array([1]));
  // Interrupted before the original moved into place.
  await mkdir(join(h.stateDirectory, "source-files", "workspaces", WORKSPACE_ID, "evaluation-documents", "evd_empty"), {
    recursive: true,
  });
  const abandonedUpload = join(h.stateDirectory, "temporary", "evaluation-documents", `${crypto.randomUUID()}.upload`);
  await Bun.write(abandonedUpload, new Uint8Array([1]));

  // Within the grace period an in-flight save's original is never taken.
  await h.library().sweep();
  expect(await Bun.file(abandonedUpload).exists()).toBe(false);
  expect((await h.libraryFiles()).filter((name) => name.endsWith("source.png"))).toHaveLength(2);

  const later = () => Date.now() + LATER;
  await h
    .library({
      now: later,
      productStoreRegistry: {
        ...h.registry,
        acquire: () => {
          throw new Error("database is locked");
        },
      },
    })
    .sweep();
  expect((await h.libraryFiles()).filter((name) => name.endsWith("source.png"))).toHaveLength(2);

  const recovery = h.library({ now: later });
  await recovery.sweep();
  expect(await h.libraryFiles()).toEqual([
    `workspaces/${WORKSPACE_ID}/evaluation-documents/${committed}`,
    `workspaces/${WORKSPACE_ID}/evaluation-documents/${committed}/source.png`,
  ]);
  expect(recovery.snapshot()).toMatchObject({ orphansReclaimed: 2, failures: 0 });
  expect((await h.call(`/${committed}/source`)).status).toBe(200);
});

test("a failed entry commit releases the saved original and exposes no entry", async () => {
  for (const provider of ["local", "s3"] as const) {
    const h = await harness({ provider });

    const failing = {
      ...h.registry,
      acquire: (input: Parameters<typeof h.registry.acquire>[0]) => {
        const lease = h.registry.acquire(input);

        return (
          lease && {
            ...lease,
            store: {
              ...lease.store,
              insertEvaluationDocument: () => {
                throw new Error("disk I/O error");
              },
            },
          }
        );
      },
    };

    const service = h.library({ productStoreRegistry: failing });
    const form = new FormData();
    form.set("document", new File([new Uint8Array([137, 80, 78, 71])], "invoice.png", { type: "image/png" }));
    form.set("metadata", JSON.stringify({ operation_id: "op_commit", name: "Invoice", reference }));

    const response = await service.handle(
      new Request("http://localhost/v1/evaluations/documents", {
        method: "POST",
        body: form,
        headers: { "x-workspace-id": WORKSPACE_ID },
      }),
    );

    expect(response.status).toBe(500);
    expect(await (await h.call("")).json()).toEqual({ documents: [], next_cursor: null });
    expect(await h.libraryFiles()).toEqual([]);
    expect(await h.uploads()).toEqual([]);
    expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: provider === "s3" ? 1 : 0 });
    // Retrying the operation is a fresh save, since nothing was committed.
    expect((await h.save("op_commit")).status).toBe(201);
  }
});

test("deletion cleanup that fails is recorded durably and finished by the sweep after a restart", async () => {
  let failDelete = true;

  const h = await harness({
    provider: "local",
    sourceFileOverride: {
      delete: async (key) => {
        if (failDelete) throw new Error("EBUSY");
        await realDelete(key);
      },
    },
  });

  const realDelete = createLocalSourceFileStore({ stateDirectory: h.stateDirectory }).delete;
  const id = await h.saved();
  expect((await h.call(`/${id}`, { method: "DELETE" })).status).toBe(204);
  expect((await h.call(`/${id}`)).status).toBe(404);
  expect((await h.call(`/${id}/source`)).status).toBe(404);
  expect(h.product((store) => store.listEvaluationDocumentDeletionIntents({ limit: 10 }))).toEqual([
    {
      document_id: id,
      source_file_key: `workspaces/${WORKSPACE_ID}/evaluation-documents/${id}/source.png`,
      retained_object_key: null,
    },
  ]);
  await h.library().sweep();
  expect(await h.libraryFiles()).toHaveLength(2);

  failDelete = false;
  await h.registry.closeAll();
  const restarted = h.library();
  await restarted.sweep();
  expect(await h.libraryFiles()).toEqual([]);
  expect(h.product((store) => store.listEvaluationDocumentDeletionIntents({ limit: 10 }))).toEqual([]);
  expect(restarted.snapshot()).toMatchObject({ deletionsCompleted: 1 });
});

test("a remote release that fails at deletion is marked for cleanup by the next sweep", async () => {
  let failRelease = true;

  const h = await harness({
    manifestOverride: {
      markOwnerDeleting: (input) => {
        if (failRelease) throw new Error("control database I/O error");
        realRelease(input);
      },
    },
  });

  const realRelease = h.manifest.markOwnerDeleting;
  const id = await h.saved();
  expect((await h.call(`/${id}`, { method: "DELETE" })).status).toBe(204);
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 1, deleting: 0 });
  failRelease = false;
  await h.library().sweep();
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 1 });
  expect(h.product((store) => store.listEvaluationDocumentDeletionIntents({ limit: 10 }))).toEqual([]);
});

test("existing job manifest rows migrate to explicit job ownership without changing keys, phases or attempts", () => {
  const database = new Database(":memory:");
  cleanups.push(() => database.close());
  database.exec(`
    CREATE TABLE source_storage_installation (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), namespace TEXT NOT NULL, created_at TEXT NOT NULL, destination TEXT);
    INSERT INTO source_storage_installation VALUES (1, 'ns1', '2026-01-01T00:00:00.000Z', 's3|aws|documents|app/|path');
    CREATE TABLE source_object_manifest (object_key TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('preparing', 'linked', 'deleting')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT);
    CREATE INDEX idx_source_object_manifest_owner ON source_object_manifest(workspace_id, job_id);
    INSERT INTO source_object_manifest VALUES
      ('app/ns1/workspaces/w/jobs/job_a/1.pdf', 'w', 'job_a', 'linked', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0, NULL),
      ('app/ns1/workspaces/w/jobs/job_b/2.pdf', 'w', 'job_b', 'preparing', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0, NULL),
      ('app/ns1/workspaces/w/jobs/job_c/3.pdf', 'w', 'job_c', 'deleting', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 4, '2026-01-03T00:00:00.000Z');
  `);

  const rows = () =>
    database
      .query(
        "SELECT object_key, workspace_id, owner_kind, owner_id, phase, attempts, next_attempt_at FROM source_object_manifest ORDER BY object_key",
      )
      .all();

  const manifest = createLocalSourceObjectManifest(database);
  const migrated = rows();
  expect(migrated).toEqual([
    {
      object_key: "app/ns1/workspaces/w/jobs/job_a/1.pdf",
      workspace_id: "w",
      owner_kind: "job",
      owner_id: "job_a",
      phase: "linked",
      attempts: 0,
      next_attempt_at: null,
    },
    {
      object_key: "app/ns1/workspaces/w/jobs/job_b/2.pdf",
      workspace_id: "w",
      owner_kind: "job",
      owner_id: "job_b",
      phase: "preparing",
      attempts: 0,
      next_attempt_at: null,
    },
    {
      object_key: "app/ns1/workspaces/w/jobs/job_c/3.pdf",
      workspace_id: "w",
      owner_kind: "job",
      owner_id: "job_c",
      phase: "deleting",
      attempts: 4,
      next_attempt_at: "2026-01-03T00:00:00.000Z",
    },
  ]);
  // Reopening is idempotent, and the recorded destination and namespace still guard the objects.
  createLocalSourceObjectManifest(database);
  expect(rows()).toEqual(migrated);
  expect(manifest.namespace()).toBe("ns1");
  expect(() => manifest.assertDestination("s3|aws|other|app/|path")).toThrow("3 retained original(s)");
  expect(manifest.listDueDeletions({ now: "2026-01-04T00:00:00.000Z", limit: 10 })).toMatchObject([
    { owner_kind: "job", owner_id: "job_c", attempts: 4 },
  ]);

  // Job-scoped release never touches a library owner that happens to share the ID.
  manifest.prepare({
    objectKey: "app/ns1/workspaces/w/evaluation-documents/job_a/4.pdf",
    workspaceId: "w",
    ownerKind: "evaluation_document",
    ownerId: "job_a",
  });
  manifest.markJobDeleting({ workspaceId: "w", jobId: "job_a" });
  expect(manifest.counts()).toEqual({ preparing: 2, linked: 0, deleting: 2 });
  manifest.markOwnerDeleting({ workspaceId: "w", ownerKind: "evaluation_document", ownerId: "job_a" });
  expect(manifest.counts()).toEqual({ preparing: 1, linked: 0, deleting: 3 });
});

test("Workspace erasure releases library and job originals and removes local library files", async () => {
  for (const provider of ["s3", "local"] as const) {
    const h = await harness({ provider });
    expect((await h.submitJob()).status).toBe(202);
    await h.saved();
    expect(h.manifest.counts().linked).toBe(provider === "s3" ? 2 : 0);

    if (provider === "local") expect(await h.libraryFiles()).toHaveLength(2);
    h.s3.state.down = true;

    const deletion = createLocalWorkspaceDeletion({
      sourceFileStore: h.sourceFiles,
      stateDirectory: h.stateDirectory,
      productStoreRegistry: h.registry,
      sourceObjectManifest: h.manifest,
      workspaceControl: workspaceControlFixture({
        assertWorkspaceDeletion: () => {},
        recordWorkspaceDeletionIntent: () => {},
        deleteWorkspace: () => {},
        completeWorkspaceDeletionIntent: () => {},
      }),
    });

    await deletion.deleteWorkspace({ workspaceId: WORKSPACE_ID, userId: "owner" });
    expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: provider === "s3" ? 2 : 0 });
    expect(await h.libraryFiles()).toEqual([]);
    expect(await Bun.file(join(h.stateDirectory, "data", "workspaces", `${WORKSPACE_ID}.sqlite`)).exists()).toBe(false);

    h.s3.state.down = false;
    h.setWorkspaceExists(false);
    await h.cleanupAt(Date.now() + LATER).run();
    expect(h.s3.objects.size).toBe(0);
    expect(h.manifest.counts().deleting).toBe(0);
  }
});

test("the S3 destination cannot change while library objects or their cleanup depend on it", async () => {
  const h = await harness();
  h.manifest.assertDestination("s3|fake|documents|document-extraction/|path");
  const id = await h.saved();
  expect(() => h.manifest.assertDestination("s3|fake|other|document-extraction/|path")).toThrow(
    "1 retained original(s)",
  );
  expect((await h.call(`/${id}`, { method: "DELETE" })).status).toBe(204);
  expect(() => h.manifest.assertDestination("s3|fake|other|document-extraction/|path")).toThrow("unfinished deletion");
  await h.cleanupAt(Date.now() + LATER).run();
  h.manifest.assertDestination("s3|fake|other|document-extraction/|path");
});
