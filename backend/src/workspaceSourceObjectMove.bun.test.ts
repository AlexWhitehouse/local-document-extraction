import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PDFDocument } from "pdf-lib";

import { isJsonObject, isString, parseJson, type JsonObject } from "../../shared/json";
import { createLocalApplication } from "./localApplication";
import type { LocalSourceStorageConfiguration, S3SourceStorageConfiguration } from "./localConfiguration";
import { createLocalRetainedSourceObjects } from "./localRetainedSourceObjectRouting";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceObjectCleanup } from "./localSourceObjectCleanup";
import { createLocalSourceObjectManifest, INSTALLATION_DESTINATION_ID } from "./localSourceObjectManifest";
import { createLocalSourceObjectMover, readBody } from "./localSourceObjectMover";
import { createLocalSourceObjectMoves } from "./localSourceObjectMoves";
import { createLocalSourceStorageDestinations } from "./localSourceStorageDestinations";
import type { LocalWorkspace } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createS3SourceObjectStore, SourceObjectUnavailableError, type SourceObjectStore } from "./s3SourceObjectStore";
import { startFakeS3Server } from "./testing/fakeS3Server";
import { readJobAdmission } from "./testing/responseFixture";
import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import { createWorkspaceSourceObjectMoveHttp } from "./workspaceSourceObjectMoveHttp";
import { createWorkspaceSourceStorageHttp } from "./workspaceSourceStorageHttp";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const WORKSPACE_ID = "workspace_a";

const HOUR = 60 * 60_000;

function fakeBucket() {
  const s3 = startFakeS3Server();
  cleanups.push(s3.stop);

  return s3;
}

async function harness({
  installationProvider = "s3",
  role = "owner",
}: { installationProvider?: "s3" | "local"; role?: LocalWorkspace["role"] } = {}) {
  const installationS3 = fakeBucket();
  const stateDirectory = await mkdtemp(join(tmpdir(), "workspace-source-move-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const workspace = workspaceFixture({ id: WORKSPACE_ID, max_source_file_bytes: 1024 * 1024, role });
  let workspaceExists = true;
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  configureTestWorkspace({ stateDirectory, workspaceId: WORKSPACE_ID });

  withStore(registry, (store) =>
    store.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: null,
      fields: [{ id: "total", name: "Total", data_type: "number", description: "Invoice total" }],
      createdAt: new Date().toISOString(),
    }),
  );

  const controlDatabase = new Database(":memory:");
  cleanups.push(() => controlDatabase.close());
  const manifest = createLocalSourceObjectManifest(controlDatabase);
  const moves = createLocalSourceObjectMoves({ database: controlDatabase, manifest });

  const destinations = createLocalSourceStorageDestinations({
    database: controlDatabase,
    vault: createWorkspaceCredentialVault(stateDirectory, {
      purpose: "source-storage-credential",
      unavailable: () => new SourceObjectUnavailableError("Workspace storage credentials are unavailable"),
    }),
  });

  const installation: S3SourceStorageConfiguration = {
    bucket: "installation",
    region: "us-east-1",
    endpoint: installationS3.endpoint,
    forcePathStyle: true,
    prefix: "document-extraction/",
    accessKeyId: "installation-access",
    secretAccessKey: "installation-secret",
  };

  const installationBucket = installationProvider === "s3" ? installation : undefined;

  const sourceStorage: LocalSourceStorageConfiguration = {
    provider: installationProvider,
    originalRetentionEnabled: true,
    workspaceOverridesEnabled: true,
  };

  if (installationBucket) sourceStorage.s3 = installationBucket;

  const sourceObjects = createLocalRetainedSourceObjects({
    manifest,
    destinations,
    installation: installationBucket,
    namespace: manifest.namespace(),
    createStore: (configuration) =>
      createS3SourceObjectStore(configuration, { writeDeadlineMs: 2_000, readDeadlineMs: 2_000 }),
  });

  const sourceFiles = createLocalSourceFileStore({ stateDirectory });

  const workspaceControl = workspaceControlFixture({
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => (apiKey === "key-a" ? workspace : null),
    getAcceptedWorkspaceContext: ({ workspaceId }) => (workspaceExists && workspaceId === WORKSPACE_ID ? workspace : null),
    hasPendingStarterTemplateBootstrap: () => false,
    workspaceExists: () => workspaceExists,
  });

  const application = createLocalApplication({
    auth: {
      handler: async () => new Response(null),
      getSession: async () => ({ id: "user_a", email: "ada@example.com", name: "Ada" }),
    },
    workspaceControl,
    stateDirectory,
    productStoreRegistry: registry,
    sourceFileStore: sourceFiles,
    sourceStorage,
    sourceStorageDestinations: destinations,
    sourceStorageControl: createWorkspaceSourceStorageHttp({
      workspaceControl,
      destinations,
      manifest,
      installationProvider: sourceStorage.provider,
      overridesEnabled: true,
      resolveAddresses: async () => ["10.0.0.5"],
      moves: createWorkspaceSourceObjectMoveHttp({
        moves,
        manifest,
        destinations,
        sourceObjects,
        installation: installationBucket,
        productStoreRegistry: registry,
      }),
    }),
    sourceObjects,
    scheduleQueuedJob: async () => {},
  });

  const storage = (path = "", init: RequestInit = {}) =>
    application(new Request(`http://localhost/v1/workspaces/${WORKSPACE_ID}/source-storage${path}`, init));

  const api = (path: string, init: RequestInit = {}) =>
    application(
      new Request(`http://localhost/v1${path}`, {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: "Bearer key-a" },
      }),
    );

  let revision = 0;

  const useBucket = async (bucket: ReturnType<typeof fakeBucket>, prefix = "tenant/") => {
    const saved = await storage("", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(revision ? { "if-match": `"source-storage-${revision}"` } : { "if-none-match": "*" }),
      },
      body: JSON.stringify({
        endpoint: bucket.endpoint,
        region: "eu-west-2",
        bucket: "tenant-documents",
        prefix,
        access_key_id: "tenant-access-key",
        secret_access_key: "tenant-secret-key",
        confirm_unversioned_bucket: true,
      }),
    });

    expect(saved.status).toBe(200);
    revision += 1;
  };

  /** Submits a Document and fails it, so it is settled and its original can move. */
  const submit = async ({ settle = true } = {}) => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const form = new FormData();
    form.set("document", new File([new Uint8Array(await pdf.save())], "invoice.pdf", { type: "application/pdf" }));
    form.set("template_id", "tpl_invoice");
    const response = await api("/extract", { method: "POST", body: form });
    expect(response.status).toBe(202);
    const jobId = (await readJobAdmission(response)).job_id;

    if (settle) fail(jobId);

    return jobId;
  };

  const fail = (jobId: string) =>
    withStore(registry, (store) =>
      store.failQueuedExtractionJob({
        jobId,
        failedAt: new Date().toISOString(),
        errorCode: "test",
        errorMessage: "settled for the move",
      }),
    );

  const original = (ownerKind: "job" | "packet" | "evaluation_document", ownerId: string) =>
    withStore(registry, (store) => store.getRetainedOriginal({ ownerKind, ownerId }));

  const mover = (options: { now?: () => number; sourceObjects?: typeof sourceObjects } = {}) =>
    createLocalSourceObjectMover({
      manifest,
      moves,
      sourceObjects: options.sourceObjects ?? sourceObjects,
      sourceFileStore: sourceFiles,
      productStoreRegistry: registry,
      workspaceControl,
      now: options.now,
    });

  /** Runs the mover until the move ends, letting time pass so paused moves and later passes come due. */
  const runMove = async (options: Parameters<typeof mover>[0] = {}) => {
    let at = Date.now();
    const instance = mover({ now: () => at, ...options });

    for (let round = 0; round < 40; round++) {
      await instance.run();

      if (moves.latest(WORKSPACE_ID)?.status !== "running") break;
      at += 2 * HOUR;
    }

    return summary();
  };

  const summary = async () => body(await storage("/move"));

  const cleanupAt = (at: number) =>
    createLocalSourceObjectCleanup({
      manifest,
      storeFor: sourceObjects.storeFor,
      destinations,
      productStoreRegistry: registry,
      workspaceControl,
      now: () => at,
      random: () => 0.5,
    });

  return {
    api,
    cleanupAt,
    destinations,
    fail,
    installationS3,
    manifest,
    mover,
    moves,
    original,
    registry,
    runMove,
    sourceFiles,
    sourceObjects,
    stateDirectory,
    storage,
    submit,
    summary,
    useBucket,
    setWorkspaceExists: (value: boolean) => {
      workspaceExists = value;
    },
  };
}

function withStore<T>(
  registry: ReturnType<typeof createLocalWorkspaceProductStoreRegistry>,
  work: (store: NonNullable<ReturnType<typeof registry.acquire>>["store"]) => T,
): T {
  const lease = registry.acquire({ workspaceId: WORKSPACE_ID, mode: "existing" })!;

  try {
    return work(lease.store);
  } finally {
    lease.release();
  }
}

async function body(response: Response): Promise<JsonObject> {
  const value = parseJson(await response.text());

  if (!isJsonObject(value)) throw new Error("Expected a JSON object");

  return value;
}

/** The object at `key` (or at `index` within the array there). */
function objectAt(value: JsonObject, key: string, index?: number): JsonObject {
  const found = value[key];
  const item = index === undefined ? found : Array.isArray(found) ? found[index] : undefined;

  if (!isJsonObject(item)) throw new Error(`Expected an object at ${key}`);

  return item;
}

async function errorCode(response: Response): Promise<string | undefined> {
  const error = (await body(response)).error;

  return isJsonObject(error) && isString(error.code) ? error.code : undefined;
}

const start = (h: Awaited<ReturnType<typeof harness>>) =>
  h.storage("/move", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

function productDatabase(stateDirectory: string) {
  const database = new Database(join(stateDirectory, "data", "workspaces", `${WORKSPACE_ID}.sqlite`));
  cleanups.push(() => database.close());

  return database;
}

test("owners see where originals are and move them all into the Workspace's current bucket", async () => {
  const h = await harness();
  const first = fakeBucket();
  const second = fakeBucket();

  const installationJob = await h.submit();
  await h.useBucket(first);
  const firstJob = await h.submit();
  await h.useBucket(second, "current/");
  const oldKeys = [installationJob, firstJob].map((jobId) => h.original("job", jobId)!.retained_object_key!);

  const before = await h.summary();
  expect(before).toMatchObject({ target: { kind: "workspace_bucket", prefix: "current/" }, unavailable_reason: null, movable: 2, move: null });
  expect(before.locations).toMatchObject([
    { kind: "workspace_bucket", is_target: true, retired: false, originals: 0 },
    { kind: "workspace_bucket", is_target: false, retired: true, prefix: "tenant/", originals: 1, unknown_size: 0 },
    { kind: "installation_bucket", is_target: false, originals: 1 },
  ]);
  expect(objectAt(before, "locations", 1).bytes).toBeGreaterThan(0);

  const started = await start(h);
  expect(started.status).toBe(202);
  expect((await body(started)).move).toMatchObject({ status: "running", total: 2, moved: 0 });
  expect(await errorCode(await start(h))).toBe("source_storage_move_running");

  const after = await h.runMove();
  expect(after.move).toMatchObject({ status: "completed", moved: 2, failed: 0, waiting: 0, failures: [] });
  expect(after.movable).toBe(0);
  // Neither the summaries nor the move keep an upload hold, so emptied buckets can still be forgotten.
  expect(h.sourceObjects.heldDestinations().size).toBe(0);

  for (const jobId of [installationJob, firstJob]) {
    const key = h.original("job", jobId)!.retained_object_key!;
    expect(key).toStartWith(`current/${h.manifest.namespace()}/workspaces/${WORKSPACE_ID}/jobs/${jobId}/`);
    expect(second.objects.has(key)).toBe(true);
    const download = await h.api(`/jobs/${jobId}/source`);
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }

  // Old copies stay for in-flight reads, then cleanup deletes them and forgets the emptied bucket.
  await h.cleanupAt(Date.now()).run();
  expect(first.objects.has(oldKeys[1]!)).toBe(true);
  await h.cleanupAt(Date.now() + HOUR).run();
  expect(h.installationS3.objects.has(oldKeys[0]!)).toBe(false);
  expect(first.objects.has(oldKeys[1]!)).toBe(false);
  expect(h.manifest.countsByDestination().get(INSTALLATION_DESTINATION_ID)).toBeUndefined();
  expect(await body(await h.storage())).toMatchObject({ previous_locations_pending: 0 });
  expect((await h.summary()).locations).toMatchObject([{ is_target: true, originals: 2 }]);

  // Nothing depends on the installation bucket any more, so the operator may change it.
  expect(() => h.manifest.assertDestination(null)).not.toThrow();
  expect(await errorCode(await start(h))).toBe("source_storage_move_nothing_to_move");
});

test("members cannot see or start moves, and a move needs a bucket to move into", async () => {
  const member = await harness({ role: "member" });
  expect(await errorCode(await member.summary().then(() => member.storage("/move")))).toBe("insufficient_workspace_role");
  expect(await errorCode(await start(member))).toBe("insufficient_workspace_role");

  const local = await harness({ installationProvider: "local" });
  await local.submit();
  expect(await local.summary()).toMatchObject({
    target: null,
    unavailable_reason: "no_remote_storage",
    movable: 1,
    locations: [{ kind: "local", originals: 1 }],
  });
  expect(await errorCode(await start(local))).toBe("source_storage_move_unavailable");
});

test("local originals move into the Workspace bucket; retention cleanup then removes the local copy", async () => {
  const h = await harness({ installationProvider: "local" });
  const bucket = fakeBucket();
  const jobId = await h.submit();
  const localKey = h.original("job", jobId)!.source_file_key!;

  // A library entry kept in the data folder.
  const documentKey = `workspaces/${WORKSPACE_ID}/evaluation-documents/edoc_local/source.pdf`;
  const documentPath = join(h.stateDirectory, "source-files", documentKey);
  await mkdir(dirname(documentPath), { recursive: true });
  await writeFile(documentPath, "%PDF-1.4 library original");
  withStore(h.registry, (store) =>
    store.insertEvaluationDocument({
      document: {
        id: "edoc_local",
        name: "Library invoice",
        source_name: "library.pdf",
        source_mime_type: "application/pdf",
        source_byte_size: 25,
        source_page_count: 1,
        source_file_key: documentKey,
        retained_object_key: null,
        reference_json: "{}",
        reference_fields_json: "[]",
        created_at: new Date().toISOString(),
      },
      author: { userId: "user_a", name: "Ada" },
      operationId: "op_local",
      digest: "digest",
    }),
  );

  await h.useBucket(bucket);
  expect(await h.summary()).toMatchObject({ movable: 2, locations: [{ is_target: true }, { kind: "local", originals: 2 }] });
  expect((await start(h)).status).toBe(202);
  expect((await h.runMove()).move).toMatchObject({ status: "completed", moved: 2 });

  const job = h.original("job", jobId)!;
  expect(bucket.objects.has(job.retained_object_key!)).toBe(true);
  const entry = h.original("evaluation_document", "edoc_local")!;
  expect(entry.source_file_key).toBeNull();
  expect(new TextDecoder().decode(bucket.objects.get(entry.retained_object_key!)!.bytes)).toBe("%PDF-1.4 library original");
  // The library's local file stays for reads that opened it before the swap, then goes.
  expect(await Bun.file(documentPath).exists()).toBe(true);
  expect(h.manifest.entry(entry.retained_object_key!)?.phase).toBe("linked");
  await h.mover({ now: () => Date.now() + HOUR }).run();
  expect(await Bun.file(documentPath).exists()).toBe(false);
  expect(h.moves.listItems(10)).toEqual([]);

  await createLocalSourceFileRetention({
    productStoreRegistry: h.registry,
    sourceFileStore: h.sourceFiles,
    stateDirectory: h.stateDirectory,
  }).run();
  expect(await Bun.file(join(h.stateDirectory, "source-files", localKey)).exists()).toBe(false);
  expect((await h.api(`/jobs/${jobId}/source`)).status).toBe(200);
});

test("Documents still processing wait for a later pass instead of moving under the processor", async () => {
  const h = await harness();
  const bucket = fakeBucket();
  const busy = await h.submit({ settle: false });
  await h.useBucket(bucket);
  expect((await start(h)).status).toBe(202);

  let at = Date.now();
  const mover = h.mover({ now: () => at });
  await mover.run();
  expect((await h.summary()).move).toMatchObject({ status: "running", moved: 0 });
  expect(h.moves.latest(WORKSPACE_ID)).toMatchObject({ pass: 2, waiting: 0 });
  expect(h.original("job", busy)!.retained_object_key).not.toStartWith("tenant/");

  h.fail(busy);
  at += HOUR;
  await mover.run();
  expect((await h.summary()).move).toMatchObject({ status: "completed", moved: 1 });
  expect(h.original("job", busy)!.retained_object_key).toStartWith("tenant/");
});

test("a restart settles each interrupted original from what its owner references", async () => {
  const h = await harness();
  const bucket = fakeBucket();
  const swapped = await h.submit();
  const unswapped = await h.submit();
  await h.useBucket(bucket);
  expect((await start(h)).status).toBe(202);
  const move = h.moves.latest(WORKSPACE_ID)!;
  const target = h.sourceObjects.destinationFor(WORKSPACE_ID)!;

  const interrupt = async (jobId: string, swap: boolean) => {
    const old = h.original("job", jobId)!;
    const newKey = target.keyFor({ workspaceId: WORKSPACE_ID, jobId, mimeType: "application/pdf" });
    h.moves.beginItem({
      new_key: newKey,
      move_id: move.id,
      workspace_id: WORKSPACE_ID,
      owner_kind: "job",
      owner_id: jobId,
      old_key: old.retained_object_key,
      old_local_key: null,
      created_at: new Date().toISOString(),
      destinationId: target.id,
      byteSize: 4,
    });
    await target.store.put({ key: newKey, file: new Blob(["copy"]), mimeType: "application/pdf" });

    if (swap)
      withStore(h.registry, (store) =>
        store.replaceRetainedOriginal({
          ownerKind: "job",
          ownerId: jobId,
          from: { objectKey: old.retained_object_key, sourceFileKey: old.source_file_key },
          objectKey: newKey,
        }),
      );

    return { oldKey: old.retained_object_key!, newKey };
  };

  const afterSwap = await interrupt(swapped, true);
  const beforeSwap = await interrupt(unswapped, false);

  // Stale-upload recovery leaves copies an unfinished move owns alone, even hours later.
  await h.cleanupAt(Date.now() + 2 * HOUR).run();
  expect(h.manifest.entry(afterSwap.newKey)?.phase).toBe("preparing");
  expect(h.manifest.entry(beforeSwap.newKey)?.phase).toBe("preparing");

  h.moves.cancel(WORKSPACE_ID);
  await h.mover().run();

  expect(h.moves.listItems(10)).toEqual([]);
  expect(h.manifest.entry(afterSwap.newKey)?.phase).toBe("linked");
  expect(h.manifest.entry(afterSwap.oldKey)?.phase).toBe("deleting");
  expect(h.manifest.entry(beforeSwap.newKey)?.phase).toBe("deleting");
  expect(h.manifest.entry(beforeSwap.oldKey)?.phase).toBe("linked");

  await h.cleanupAt(Date.now() + 2 * HOUR).run();
  expect(bucket.objects.has(afterSwap.newKey)).toBe(true);
  expect(h.installationS3.objects.has(afterSwap.oldKey)).toBe(false);
  expect(bucket.objects.has(beforeSwap.newKey)).toBe(false);
  expect(h.installationS3.objects.has(beforeSwap.oldKey)).toBe(true);
});

test("deleting a Document, packet or library entry mid-move leaves no orphaned copy and no dangling reference", async () => {
  const h = await harness();
  const bucket = fakeBucket();
  const jobId = await h.submit();
  const child = await h.submit();
  const jobKey = h.original("job", jobId)!.retained_object_key!;
  const childKey = h.original("job", child)!.retained_object_key!;

  // A completed packet whose original is in the installation bucket, with the Document above as its child.
  const packetKey = `document-extraction/${h.manifest.namespace()}/workspaces/${WORKSPACE_ID}/packets/pkt_a/original.pdf`;
  h.manifest.prepare({ objectKey: packetKey, destinationId: INSTALLATION_DESTINATION_ID, workspaceId: WORKSPACE_ID, ownerKind: "packet", ownerId: "pkt_a" });
  h.manifest.link({ objectKey: packetKey });
  await h.sourceObjects.storeFor(INSTALLATION_DESTINATION_ID).put({ key: packetKey, file: new Blob(["packet"]), mimeType: "application/pdf" });
  const product = productDatabase(h.stateDirectory);
  const at = new Date().toISOString();
  product
    .query(
      `INSERT INTO document_packets (id, status, source_file_key, source_mime_type, source_name, source_file_page_count, template_tags, selected_pages, processing_policy, created_at, updated_at)
       VALUES ('pkt_a', 'completed', ?, 'application/pdf', 'packet.pdf', 2, '[]', '[]', '{}', ?, ?)`,
    )
    .run(`workspaces/${WORKSPACE_ID}/jobs/pkt_a/source.pdf`, at, at);
  product
    .query(
      "INSERT INTO source_files (key, job_id, mime_type, name, page_count, created_at, deleted_at, retained, retained_key) VALUES (?, 'pkt_a', 'application/pdf', 'packet.pdf', 2, ?, ?, 1, ?)",
    )
    .run(`workspaces/${WORKSPACE_ID}/jobs/pkt_a/source.pdf`, at, at, packetKey);
  product
    .query("INSERT INTO document_packet_children (packet_id, job_id, position, pages, state, source_file_key, retained_object_key) VALUES ('pkt_a', ?, 0, '[1]', 'materialized', 'x', ?)")
    .run(child, childKey);

  await h.useBucket(bucket);
  expect(await h.summary()).toMatchObject({ movable: 3 });
  expect((await start(h)).status).toBe(202);

  // Delete the plain Document while its copy is being written; the swap then finds nothing to update.
  const store = h.sourceObjects.storeFor(h.sourceObjects.destinationFor(WORKSPACE_ID)!.id);

  const racing = {
    ...h.sourceObjects,
    storeFor: (id: string): SourceObjectStore => {
      const real = h.sourceObjects.storeFor(id);

      return id !== h.sourceObjects.destinationFor(WORKSPACE_ID)!.id
        ? real
        : {
            ...real,
            put: async (input) => {
              if (input.key.includes(`/jobs/${jobId}/`))
                expect((await h.api(`/jobs/${jobId}`, { method: "DELETE" })).status).toBe(200);

              return store.put(input);
            },
          };
    },
  };

  const result = await h.runMove({ sourceObjects: racing });
  expect(result.move).toMatchObject({ status: "completed", moved: 2, failed: 0, waiting: 0 });
  // The deleted Document has nothing left to move, so it doesn't hold the move open for more passes.
  expect(h.moves.latest(WORKSPACE_ID)).toMatchObject({ pass: 1 });

  // The packet and its child each moved on their own; the child slot follows the child.
  const newPacketKey = h.original("packet", "pkt_a")!.retained_object_key!;
  const newChildKey = h.original("job", child)!.retained_object_key!;
  expect(newPacketKey).toStartWith(`tenant/${h.manifest.namespace()}/workspaces/${WORKSPACE_ID}/packets/pkt_a/`);
  expect(product.query("SELECT retained_object_key FROM document_packet_children WHERE job_id = ?").get(child)).toEqual({
    retained_object_key: newChildKey,
  });

  // Then delete the packet (and its child) after the move.
  expect((await h.api("/packets/pkt_a", { method: "DELETE" })).status).toBe(200);
  await h.cleanupAt(Date.now() + 2 * HOUR).run();

  for (const key of [jobKey, childKey, packetKey]) expect(h.installationS3.objects.has(key)).toBe(false);
  expect(bucket.objects.size).toBe(0);
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 0 });
});

test("an unreachable source bucket only holds back its own originals; an unreachable target pauses the move", async () => {
  const h = await harness();
  const first = fakeBucket();
  const second = fakeBucket();
  const installationJob = await h.submit();
  await h.useBucket(first);
  const firstJob = await h.submit();
  await h.useBucket(second, "current/");
  expect((await start(h)).status).toBe(202);

  first.state.down = true;
  let at = Date.now();
  const mover = h.mover({ now: () => at });
  await mover.run();
  expect(h.original("job", installationJob)!.retained_object_key).toStartWith("current/");
  expect(h.original("job", firstJob)!.retained_object_key).toStartWith("tenant/");
  expect(h.moves.latest(WORKSPACE_ID)).toMatchObject({ status: "running", moved: 1, pass: 2 });

  // The next pass reads the source again but can't write the copy: the move pauses with a time to try again.
  first.state.down = false;
  second.state.down = true;
  at += HOUR;
  await mover.run();
  const paused = await h.summary();
  expect(paused.move).toMatchObject({ status: "running", moved: 1 });
  expect(objectAt(paused, "move").next_attempt_at).toBeString();
  expect(objectAt(paused, "move").message).toContain("couldn't be reached");
  expect(h.moves.listItems(10)).toEqual([]);

  second.state.down = false;
  at += 2 * HOUR;
  await mover.run();
  expect((await h.summary()).move).toMatchObject({ status: "completed", moved: 2, next_attempt_at: null, message: null });
  expect(h.original("job", firstJob)!.retained_object_key).toStartWith("current/");
});

test("one original that can't be read holds back only itself, then fails on the last pass", async () => {
  const h = await harness();
  const bucket = fakeBucket();
  const jobs = [await h.submit(), await h.submit(), await h.submit(), await h.submit()].sort();
  const unreadable = h.original("job", jobs[0]!)!.retained_object_key!;
  await h.useBucket(bucket);
  expect((await start(h)).status).toBe(202);

  const flaky = {
    ...h.sourceObjects,
    storeFor: (id: string): SourceObjectStore => {
      const real = h.sourceObjects.storeFor(id);

      return {
        ...real,
        open: async (key) => {
          if (key === unreadable) throw new SourceObjectUnavailableError("Access denied for this object");

          return real.open(key);
        },
      };
    },
  };

  const finished = await h.runMove({ sourceObjects: flaky });
  expect(finished.move).toMatchObject({
    status: "completed",
    moved: 3,
    failed: 1,
    failures: [{ id: jobs[0], message: "The original couldn't be read where it's stored, so it stayed there." }],
  });

  for (const jobId of jobs.slice(1)) expect(h.original("job", jobId)!.retained_object_key).toStartWith("tenant/");
  expect(h.original("job", jobs[0]!)!.retained_object_key).toBe(unreadable);
});

test("a missing original fails on its own; cancelling stops the move; a location change stops it", async () => {
  const h = await harness();
  const bucket = fakeBucket();
  const missing = await h.submit();
  const kept = await h.submit();
  h.installationS3.objects.delete(h.original("job", missing)!.retained_object_key!);
  await h.useBucket(bucket);

  expect((await start(h)).status).toBe(202);
  const finished = await h.runMove();
  expect(finished.move).toMatchObject({
    status: "completed",
    moved: 1,
    failed: 1,
    failures: [{ kind: "document", id: missing, name: "invoice.pdf", message: "The original is missing from its bucket." }],
  });
  expect(h.original("job", kept)!.retained_object_key).toStartWith("tenant/");

  const another = await h.submit();
  const third = fakeBucket();
  await h.useBucket(third, "third/");
  expect((await start(h)).status).toBe(202);
  const cancelled = await h.storage("/move", { method: "DELETE" });
  expect(cancelled.status).toBe(200);
  expect((await body(cancelled)).move).toMatchObject({ status: "cancelled", moved: 0 });
  expect(await errorCode(await h.storage("/move", { method: "DELETE" }))).toBe("source_storage_move_not_running");
  await h.mover().run();
  expect(h.original("job", another)!.retained_object_key).toStartWith("tenant/");

  expect((await start(h)).status).toBe(202);
  await h.useBucket(fakeBucket(), "fourth/");
  expect((await h.runMove()).move).toMatchObject({ status: "stopped", moved: 0 });
  expect(objectAt(await h.summary(), "move").message).toContain("storage location changed");
});

test("Workspace deletion mid-move stops it and releases every copy", async () => {
  const h = await harness();
  const bucket = fakeBucket();
  await h.submit();
  await h.useBucket(bucket);
  expect((await start(h)).status).toBe(202);
  h.setWorkspaceExists(false);
  h.manifest.markWorkspaceDeleting({ workspaceId: WORKSPACE_ID });
  await h.mover().run();
  expect(h.moves.latest(WORKSPACE_ID)).toMatchObject({ status: "stopped", message: "The Workspace was deleted." });
  await h.cleanupAt(Date.now() + 2 * HOUR).run();
  expect(h.installationS3.objects.size).toBe(0);
  expect(bucket.objects.size).toBe(0);
});

test("body reads are cancelled at the deadline and never accept a short or oversized body", async () => {
  let cancelled = false;

  const stalled = new ReadableStream<Uint8Array>({
    start: (controller) => controller.enqueue(new Uint8Array([1, 2])),
    cancel: () => {
      cancelled = true;
    },
  });

  await expect(readBody(stalled, { expectedSize: 4, deadlineMs: 20 })).rejects.toThrow("timed out");
  expect(cancelled).toBe(true);

  const bytes = (...chunks: number[][]) =>
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
        controller.close();
      },
    });

  await expect(readBody(bytes([1, 2], [3]), { expectedSize: 4 })).rejects.toThrow("ended before");
  await expect(readBody(bytes([1, 2], [3, 4, 5]), { expectedSize: 4 })).rejects.toThrow("larger than");
  expect([...(await readBody(bytes([1, 2], [3, 4]), { expectedSize: 4 }))]).toEqual([1, 2, 3, 4]);
});
