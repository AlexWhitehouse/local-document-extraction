import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PDFDocument } from "pdf-lib";

import { createLocalApplication } from "./localApplication";
import type { LocalAuth } from "./localAuth";
import type { S3SourceStorageConfiguration } from "./localConfiguration";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceObjectCleanup } from "./localSourceObjectCleanup";
import { createLocalSourceObjectManifest } from "./localSourceObjectManifest";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createS3SourceObjectStore, retainedObjectKey } from "./s3SourceObjectStore";
import { startFakeS3Server } from "./testing/fakeS3Server";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const LATER = 60 * 60_000;

async function s3Harness({ failLink = false } = {}) {
  const s3 = startFakeS3Server();
  cleanups.push(s3.stop);
  const stateDirectory = await mkdtemp(join(tmpdir(), "retained-source-objects-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const workspace = { id: "workspace_a", name: "A", max_source_file_bytes: 1024 * 1024, source_retention_disabled: false };
  let workspaceExists = true;
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
  const lease = registry.acquire({ workspaceId: workspace.id, mode: "existing" })!;
  try {
    lease.store.createTemplate({
      templateId: "tpl_invoice", name: "Invoice", description: null,
      fields: [{ id: "total", name: "Total", data_type: "number", description: "Invoice total" }],
      createdAt: new Date().toISOString(),
    });
  } finally { lease.release(); }
  const controlDatabase = new Database(":memory:");
  cleanups.push(() => controlDatabase.close());
  const manifest = createLocalSourceObjectManifest(controlDatabase);
  const configuration: S3SourceStorageConfiguration = {
    bucket: "documents", region: "us-east-1", endpoint: s3.endpoint, forcePathStyle: true, prefix: "document-extraction/",
    accessKeyId: "test-access", secretAccessKey: "test-secret",
  };
  const store = createS3SourceObjectStore(configuration, { writeDeadlineMs: 2_000, readDeadlineMs: 2_000 });
  const namespace = manifest.namespace();
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const workspaceControl = {
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => apiKey === "key-a" ? workspace : null,
    hasPendingStarterTemplateBootstrap: () => false,
    workspaceExists: () => workspaceExists,
  } as unknown as LocalWorkspaceControl;
  const application = createLocalApplication({
    auth: { handler: async () => new Response(null), getSession: async () => null } as unknown as LocalAuth,
    workspaceControl,
    stateDirectory,
    productStoreRegistry: registry,
    sourceFileStore: sourceFiles,
    sourceStorage: { provider: "s3", originalRetentionEnabled: true, s3: configuration },
    sourceObjects: {
      store,
      manifest: failLink ? { ...manifest, link: () => { throw new Error("control database I/O error"); } } : manifest,
      keyFor: (input) => retainedObjectKey({ prefix: configuration.prefix, namespace, ...input }),
    },
    scheduleQueuedJob: async () => {},
  });
  const call = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer key-a");
    return application(new Request(`http://localhost/v1${path}`, { ...init, headers }));
  };
  const submit = async (bytes: Uint8Array) => {
    const body = new FormData();
    body.set("document", new File([new Uint8Array(bytes)], "invoice.pdf", { type: "application/pdf" }));
    body.set("template_id", "tpl_invoice");
    return call("/extract", { method: "POST", body });
  };
  const cleanupAt = (at: number) => createLocalSourceObjectCleanup({
    manifest, objectStore: store, productStoreRegistry: registry, workspaceControl, now: () => at, random: () => 0.5,
  });
  const retained = (jobId: string) => {
    const current = registry.acquire({ workspaceId: workspace.id, mode: "existing" })!;
    try { return current.store.getRetainedSourceFile(jobId); } finally { current.release(); }
  };
  const workingFiles = async () => (await readdir(join(stateDirectory, "source-files"), { recursive: true }).catch(() => [] as string[]))
    .filter((name) => /source\.[a-z]+$/.test(String(name)));
  return {
    s3, manifest, store, registry, sourceFiles, stateDirectory, workspace, call, submit, cleanupAt, retained, workingFiles,
    setWorkspaceExists: (value: boolean) => { workspaceExists = value; },
  };
}

async function pdfBytes(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}

test("an S3-retained original is saved with a single PUT before acceptance and survives working-copy cleanup", async () => {
  const harness = await s3Harness();
  const original = await pdfBytes();
  const response = await harness.submit(original);
  expect(response.status).toBe(202);
  const { job_id: jobId } = await response.json() as { job_id: string };

  const retained = harness.retained(jobId)!;
  expect(retained.retained_object_key).toMatch(new RegExp(`^document-extraction/${harness.manifest.namespace()}/workspaces/workspace_a/jobs/${jobId}/[0-9a-f-]{36}\\.pdf$`));
  expect(harness.s3.objects.get(retained.retained_object_key!)?.bytes).toEqual(new Uint8Array(original));
  expect(harness.s3.objects.get(retained.retained_object_key!)?.type).toBe("application/pdf");
  expect(harness.s3.state.multipartRequests).toBe(0);
  expect(harness.manifest.counts()).toEqual({ preparing: 0, linked: 1, deleting: 0 });

  await createLocalExtractionRunner({
    extract: async () => [{ field_id: "total", status: "ok", answer: 1, confidence: 0.9, evidence: "Total" }],
    productStoreRegistry: harness.registry, sourceFileStore: harness.sourceFiles, stateDirectory: harness.stateDirectory,
  }).run({ job_id: jobId, workspace_id: "workspace_a", template_id: "tpl_invoice", template_version: 1, enqueued_at: new Date().toISOString() });
  expect(await harness.workingFiles()).toEqual([]);

  const detail = await (await harness.call(`/jobs/${jobId}`)).json() as { status: string; source_retained: boolean };
  expect(detail).toMatchObject({ status: "completed", source_retained: true });
  const download = await harness.call(`/jobs/${jobId}/source`);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-length")).toBe(String(original.byteLength));
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(new Uint8Array(original));
});

test("failed extraction releases its S3 working copy through the sweep while keeping the original", async () => {
  const harness = await s3Harness();
  const { job_id: jobId } = await (await harness.submit(await pdfBytes())).json() as { job_id: string };
  const lease = harness.registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;
  lease.store.failQueuedExtractionJob({ jobId, failedAt: new Date().toISOString(), errorCode: "test_failure", errorMessage: "Test failure" });
  lease.release();
  await createLocalSourceFileRetention({ productStoreRegistry: harness.registry, sourceFileStore: harness.sourceFiles, stateDirectory: harness.stateDirectory }).run();
  expect(await harness.workingFiles()).toEqual([]);
  expect((await harness.call(`/jobs/${jobId}/source`)).status).toBe(200);
});

test("a storage outage rejects the upload without accepting a job and leaves only recoverable cleanup", async () => {
  const harness = await s3Harness();
  harness.s3.state.down = true;
  const response = await harness.submit(await pdfBytes());
  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("5");
  expect(await response.json()).toMatchObject({ error: { code: "source_storage_unavailable" } });
  const lease = harness.registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;
  expect(lease.store.listExtractionJobs({ limit: 10 })).toEqual([]);
  lease.release();
  expect(await harness.workingFiles()).toEqual([]);
  expect(harness.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 1 });

  // Cleanup waits out the late-write window, then confirms absence and forgets the attempt.
  harness.s3.state.down = false;
  await harness.cleanupAt(Date.now()).run();
  expect(harness.manifest.counts().deleting).toBe(1);
  await harness.cleanupAt(Date.now() + LATER).run();
  expect(harness.manifest.counts().deleting).toBe(0);
});

test("retrieval reports a confirmed missing object separately from an unreachable store", async () => {
  const harness = await s3Harness();
  const { job_id: jobId } = await (await harness.submit(await pdfBytes())).json() as { job_id: string };
  harness.s3.state.down = true;
  const unavailable = await harness.call(`/jobs/${jobId}/source`);
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ error: { code: "source_unavailable" } });
  harness.s3.state.down = false;
  harness.s3.objects.clear();
  const missing = await harness.call(`/jobs/${jobId}/source`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "source_missing" } });
  expect((await harness.call(`/jobs/${jobId}`)).status).toBe(200);
});

test("Document deletion hands the S3 original to background cleanup that retries until removal is confirmed", async () => {
  const harness = await s3Harness();
  const { job_id: jobId } = await (await harness.submit(await pdfBytes())).json() as { job_id: string };
  const key = harness.retained(jobId)!.retained_object_key!;
  harness.s3.state.down = true;
  expect((await harness.call(`/jobs/${jobId}`, { method: "DELETE" })).status).toBe(200);
  expect(harness.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 1 });
  expect((await harness.call(`/jobs/${jobId}/source`)).status).toBe(404);

  await harness.cleanupAt(Date.now() + LATER).run();
  expect(harness.manifest.counts().deleting).toBe(1);
  expect(harness.s3.objects.has(key)).toBe(true);

  harness.s3.state.down = false;
  await harness.cleanupAt(Date.now() + 2 * LATER).run();
  expect(harness.s3.objects.has(key)).toBe(false);
  expect(harness.manifest.counts().deleting).toBe(0);
});

test("recovery links stale uploads an accepted job references and releases unreferenced ones", async () => {
  const harness = await s3Harness();
  const { job_id: jobId } = await (await harness.submit(await pdfBytes())).json() as { job_id: string };
  const key = harness.retained(jobId)!.retained_object_key!;
  // Simulate a crash between the job commit and the manifest link, plus an orphaned attempt.
  const database = new Database(":memory:");
  cleanups.push(() => database.close());
  const crashed = createLocalSourceObjectManifest(database);
  crashed.prepare({ objectKey: key, workspaceId: "workspace_a", ownerKind: "job", ownerId: jobId });
  crashed.prepare({ objectKey: `${key}.orphan`, workspaceId: "workspace_a", ownerKind: "job", ownerId: "job_never_accepted" });
  const recovery = (at: number) => createLocalSourceObjectCleanup({
    manifest: crashed, objectStore: harness.store, productStoreRegistry: harness.registry,
    workspaceControl: { workspaceExists: () => true }, now: () => at,
  });
  await recovery(Date.now()).run();
  expect(crashed.counts()).toEqual({ preparing: 2, linked: 0, deleting: 0 });
  // The referenced upload is linked and kept; the orphan is released and, once absent, forgotten.
  await recovery(Date.now() + LATER).run();
  expect(crashed.counts()).toEqual({ preparing: 0, linked: 1, deleting: 0 });
  expect(harness.s3.objects.has(key)).toBe(true);
});

test("Workspace deletion releases every remote original without waiting on object storage", async () => {
  const harness = await s3Harness();
  for (let index = 0; index < 2; index += 1) expect((await harness.submit(await pdfBytes())).status).toBe(202);
  harness.s3.state.down = true;
  let revoked = false;
  const deletion = createLocalWorkspaceDeletion({
    sourceFileStore: harness.sourceFiles,
    stateDirectory: harness.stateDirectory,
    productStoreRegistry: harness.registry,
    sourceObjectManifest: harness.manifest,
    workspaceControl: {
      assertWorkspaceDeletion: () => {},
      recordWorkspaceDeletionIntent: () => {},
      deleteWorkspace: () => { revoked = true; },
      completeWorkspaceDeletionIntent: () => {},
    } as unknown as LocalWorkspaceControl,
  });
  await deletion.deleteWorkspace({ workspaceId: "workspace_a", userId: "owner" });
  expect(revoked).toBe(true);
  expect(harness.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 2 });

  harness.s3.state.down = false;
  harness.setWorkspaceExists(false);
  await harness.cleanupAt(Date.now() + LATER).run();
  expect(harness.s3.objects.size).toBe(0);
  expect(harness.manifest.counts().deleting).toBe(0);
});

test("the S3 destination is recorded and cannot change while objects or cleanup depend on it", () => {
  const database = new Database(":memory:");
  cleanups.push(() => database.close());
  const manifest = createLocalSourceObjectManifest(database);
  manifest.assertDestination(null);
  expect(manifest.recordedDestination()).toBeNull();
  manifest.assertDestination("s3|http://rustfs:9000|documents|app/|path");
  const namespace = manifest.namespace();
  // Nothing depends on it yet, so a different destination may replace it.
  manifest.assertDestination("s3|aws|documents|app/|virtual-hosted");
  expect(manifest.recordedDestination()).toBe("s3|aws|documents|app/|virtual-hosted");

  manifest.prepare({ objectKey: "app/key.pdf", workspaceId: "workspace_a", ownerKind: "job", ownerId: "job_a" });
  expect(() => manifest.assertDestination("s3|aws|other-bucket|app/|virtual-hosted")).toThrow("1 retained original(s)");
  expect(() => manifest.assertDestination(null)).toThrow("still depend on the previous destination");
  manifest.assertDestination("s3|aws|documents|app/|virtual-hosted");

  manifest.markDeleting({ objectKey: "app/key.pdf" });
  expect(() => manifest.assertDestination("s3|aws|other-bucket|app/|virtual-hosted")).toThrow("unfinished deletion");
  manifest.remove({ objectKey: "app/key.pdf" });
  manifest.assertDestination("s3|aws|other-bucket|app/|virtual-hosted");
  expect(manifest.namespace()).toBe(namespace);
});

test("a bookkeeping failure after the job commits keeps the accepted job and its working copy", async () => {
  const harness = await s3Harness({ failLink: true });
  const response = await harness.submit(await pdfBytes());
  expect(response.status).toBe(202);
  const { job_id: jobId } = await response.json() as { job_id: string };
  expect(await harness.workingFiles()).toHaveLength(1);
  expect(harness.s3.objects.has(harness.retained(jobId)!.retained_object_key!)).toBe(true);
  // Recovery later links the stale entry because the accepted job references it.
  expect(harness.manifest.counts()).toEqual({ preparing: 1, linked: 0, deleting: 0 });
  await harness.cleanupAt(Date.now() + LATER).run();
  expect(harness.manifest.counts()).toEqual({ preparing: 0, linked: 1, deleting: 0 });
});
