import { readJobAdmission } from "./testing/responseFixture";

import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PDFDocument } from "pdf-lib";

import { isJsonObject, isString, parseJson, type JsonObject } from "../../shared/json";
import { createLocalApplication } from "./localApplication";
import type { LocalSourceStorageConfiguration, S3SourceStorageConfiguration } from "./localConfiguration";
import { createLocalRetainedSourceObjects } from "./localRetainedSourceObjectRouting";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalSourceObjectCleanup } from "./localSourceObjectCleanup";
import { createLocalSourceObjectManifest, INSTALLATION_DESTINATION_ID } from "./localSourceObjectManifest";
import { createLocalSourceStorageDestinations } from "./localSourceStorageDestinations";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import type { LocalWorkspace } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createS3SourceObjectStore, probeS3SourceStorage, SourceObjectUnavailableError } from "./s3SourceObjectStore";
import { startFakeS3Server } from "./testing/fakeS3Server";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import { createWorkspaceSourceStorageHttp, isBlockedAddress } from "./workspaceSourceStorageHttp";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const LATER = 60 * 60_000;

const WORKSPACE_ID = "workspace_a";

function fakeBucket() {
  const s3 = startFakeS3Server();
  cleanups.push(s3.stop);

  return s3;
}

async function harness({
  installationBucket = true,
  overridesEnabled = true,
  role = "owner",
  resolveAddresses = async () => ["10.0.0.5"],
  probe = probeS3SourceStorage,
}: {
  installationBucket?: boolean;
  overridesEnabled?: boolean;
  role?: LocalWorkspace["role"];
  resolveAddresses?: (hostname: string) => Promise<string[]>;
  probe?: (configuration: S3SourceStorageConfiguration) => Promise<void>;
} = {}) {
  const installationS3 = fakeBucket();
  const stateDirectory = await mkdtemp(join(tmpdir(), "workspace-source-storage-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));

  const workspace = workspaceFixture({
    id: WORKSPACE_ID,
    max_source_file_bytes: 1024 * 1024,
    role,
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
  const manifest = createLocalSourceObjectManifest(controlDatabase);

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

  const sourceStorage: LocalSourceStorageConfiguration = installationBucket
    ? { provider: "s3", originalRetentionEnabled: true, workspaceOverridesEnabled: overridesEnabled, s3: installation }
    : { provider: "none", originalRetentionEnabled: true, workspaceOverridesEnabled: overridesEnabled };

  const createdStores: string[] = [];

  const sourceObjects = createLocalRetainedSourceObjects({
    manifest,
    destinations,
    installation: installationBucket ? installation : undefined,
    namespace: manifest.namespace(),
    overridesEnabled,
    createStore: (configuration) => {
      createdStores.push(`${configuration.bucket}:${configuration.accessKeyId}`);

      return createS3SourceObjectStore(configuration, { writeDeadlineMs: 2_000, readDeadlineMs: 2_000 });
    },
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
      overridesEnabled,
      resolveAddresses,
      probe,
    }),
    sourceObjects,
    scheduleQueuedJob: async () => {},
  });

  const settings = (path = "", init: RequestInit = {}) =>
    application(new Request(`http://localhost/v1/workspaces/${WORKSPACE_ID}/source-storage${path}`, init));

  const save = (body: JsonObject, precondition: Record<string, string>) =>
    settings("", {
      method: "PUT",
      headers: { "content-type": "application/json", ...precondition },
      body: JSON.stringify({ confirm_unversioned_bucket: true, ...body }),
    });

  const submit = async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const body = new FormData();
    body.set("document", new File([new Uint8Array(await pdf.save())], "invoice.pdf", { type: "application/pdf" }));
    body.set("template_id", "tpl_invoice");

    const response = await application(
      new Request("http://localhost/v1/extract", { method: "POST", body, headers: { authorization: "Bearer key-a" } }),
    );

    expect(response.status).toBe(202);

    return (await readJobAdmission(response)).job_id;
  };

  const api = (path: string, init: RequestInit = {}) =>
    application(
      new Request(`http://localhost/v1${path}`, {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: "Bearer key-a" },
      }),
    );

  const retainedKey = (jobId: string) => {
    const current = registry.acquire({ workspaceId: WORKSPACE_ID, mode: "existing" })!;

    try {
      return current.store.getRetainedSourceFile(jobId)!.retained_object_key!;
    } finally {
      current.release();
    }
  };

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
    createdStores,
    destinations,
    installationS3,
    manifest,
    registry,
    retainedKey,
    save,
    settings,
    sourceFiles,
    sourceObjects,
    stateDirectory,
    submit,
    workspace,
    setWorkspaceExists: (value: boolean) => {
      workspaceExists = value;
    },
  };
}

function bucketSettings(endpoint: string, overrides: JsonObject = {}): JsonObject {
  return {
    endpoint,
    region: "eu-west-2",
    bucket: "tenant-documents",
    prefix: "tenant/",
    access_key_id: "tenant-access-key",
    secret_access_key: "tenant-secret-key",
    ...overrides,
  };
}

async function body(response: Response): Promise<JsonObject> {
  const value = parseJson(await response.text());

  if (!isJsonObject(value)) throw new Error("Expected a JSON object");

  return value;
}

async function errorCode(response: Response): Promise<string | undefined> {
  const error = (await body(response)).error;

  return isJsonObject(error) && isString(error.code) ? error.code : undefined;
}

test("owners save a tested Workspace bucket; secrets never come back and preconditions guard every change", async () => {
  const h = await harness();
  const tenant = fakeBucket();

  const empty = await h.settings();
  expect(empty.status).toBe(200);
  expect(empty.headers.get("etag")).toBeNull();
  expect(await body(empty)).toEqual({
    workspace_id: WORKSPACE_ID,
    overrides_enabled: true,
    installation_provider: "s3",
    override: null,
    previous_locations_pending: 0,
  });

  expect((await h.save(bucketSettings(tenant.endpoint), {})).status).toBe(428);
  expect((await h.save(bucketSettings(tenant.endpoint), { "if-match": '"source-storage-1"' })).status).toBe(412);
  expect(await errorCode(await h.save({ ...bucketSettings(tenant.endpoint), confirm_unversioned_bucket: false }, { "if-none-match": "*" }))).toBe(
    "source_storage_confirmation_required",
  );
  expect(await errorCode(await h.save(bucketSettings(tenant.endpoint, { access_key_id: null }), { "if-none-match": "*" }))).toBe(
    "invalid_source_storage",
  );
  expect(await errorCode(await h.save(bucketSettings(tenant.endpoint, { bucket: "Bad_Bucket" }), { "if-none-match": "*" }))).toBe(
    "invalid_source_storage",
  );

  const saved = await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" });
  expect(saved.status).toBe(200);
  expect(saved.headers.get("etag")).toBe('"source-storage-1"');
  const representation = await body(saved);
  expect(representation.override).toMatchObject({
    endpoint: tenant.endpoint,
    region: "eu-west-2",
    bucket: "tenant-documents",
    prefix: "tenant/",
    force_path_style: true,
    access_key_id_hint: "…-key",
    credential_status: "configured",
    revision: 1,
  });
  expect(JSON.stringify(representation)).not.toMatch(/tenant-secret|tenant-access/);
  // The save tested the bucket with a synthetic object and left nothing behind.
  expect(tenant.state.puts).toBe(1);
  expect(tenant.objects.size).toBe(0);

  expect((await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" })).status).toBe(412);
  expect((await h.settings("", { method: "DELETE", headers: { "if-match": '"source-storage-9"' } })).status).toBe(412);
  expect((await h.settings("", { method: "DELETE", headers: { "if-match": '"source-storage-1"' } })).status).toBe(204);
  expect((await body(await h.settings())).override).toBeNull();
});

test("members cannot read or change storage settings, and the retention summary reports where originals go", async () => {
  const member = await harness({ role: "member" });
  expect(await errorCode(await member.settings())).toBe("insufficient_workspace_role");

  const owner = await harness();
  const tenant = fakeBucket();
  const retention = async () => body(await owner.api(`/workspaces/${WORKSPACE_ID}/source-retention`));
  expect(await retention()).toMatchObject({ storage_configured: true, storage_location: "installation" });
  expect((await owner.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" })).status).toBe(200);
  expect(await retention()).toMatchObject({ storage_configured: true, storage_location: "workspace" });
});

test("a member removed or demoted while the bucket test runs cannot save it", async () => {
  let duringProbe = () => {};

  const h = await harness({
    probe: async () => {
      duringProbe();
    },
  });

  duringProbe = () => {
    h.workspace.role = "member";
  };

  const saved = await h.save(bucketSettings("http://storage.internal:9000"), { "if-none-match": "*" });
  expect(await errorCode(saved)).toBe("insufficient_workspace_role");
  expect(h.destinations.current(WORKSPACE_ID)).toBeNull();
});

test("a failed bucket test saves nothing and names the stage that failed", async () => {
  const h = await harness();
  const tenant = fakeBucket();
  tenant.state.down = true;

  const tested = await h.settings("/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bucketSettings(tenant.endpoint)),
  });

  expect(tested.status).toBe(422);
  expect(await body(tested)).toMatchObject({ error: { code: "source_storage_test_failed", stage: "write" } });

  const saved = await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" });
  expect(saved.status).toBe(422);
  expect(h.destinations.current(WORKSPACE_ID)).toBeNull();

  tenant.state.down = false;

  const passed = await h.settings("/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bucketSettings(tenant.endpoint)),
  });

  expect(await body(passed)).toEqual({ ok: true });
});

test("link-local and cloud metadata endpoints are refused before any request is signed", async () => {
  const h = await harness({ resolveAddresses: async () => ["169.254.169.254"] });

  for (const endpoint of [
    "http://storage.example.test:9000",
    "http://169.254.169.254",
    "http://metadata.google.internal",
    "http://[fe80::1]:9000",
    "http://[::ffff:169.254.169.254]",
  ]) {
    expect(await errorCode(await h.save(bucketSettings(endpoint), { "if-none-match": "*" }))).toBe(
      "source_storage_endpoint_blocked",
    );
  }

  expect(isBlockedAddress("::ffff:169.254.10.1")).toBe(true);
  // URL rewrites embedded IPv4 as hex, so every IPv4-in-IPv6 spelling must be decoded.
  expect(new URL("http://[::ffff:169.254.169.254]").hostname).toBe("[::ffff:a9fe:a9fe]");
  expect(isBlockedAddress("::ffff:a9fe:a9fe")).toBe(true);
  expect(isBlockedAddress("0:0:0:0:0:ffff:a9fe:a9fe")).toBe(true);
  expect(isBlockedAddress("::ffff:0:a9fe:a9fe")).toBe(true);
  expect(isBlockedAddress("::a9fe:a9fe")).toBe(true);
  expect(isBlockedAddress("::ffff:6464:64c8")).toBe(true);
  expect(isBlockedAddress("::ffff:a00:5")).toBe(false);
  expect(isBlockedAddress("::1")).toBe(false);
  expect(isBlockedAddress("2001:db8::a9fe:a9fe")).toBe(false);
  expect(isBlockedAddress("fd00:ec2::254")).toBe(true);
  expect(isBlockedAddress("100.100.100.200")).toBe(true);
  // Private networks stay allowed, as for the model gateway.
  expect(isBlockedAddress("10.0.0.5")).toBe(false);
  expect(isBlockedAddress("127.0.0.1")).toBe(false);
  expect(isBlockedAddress("192.168.1.20")).toBe(false);
});

test("new originals go to the Workspace bucket, and a new location leaves earlier originals readable where they are", async () => {
  const h = await harness();
  const first = fakeBucket();
  const second = fakeBucket();

  const installationJob = await h.submit();
  expect(h.installationS3.objects.has(h.retainedKey(installationJob))).toBe(true);

  expect((await h.save(bucketSettings(first.endpoint), { "if-none-match": "*" })).status).toBe(200);
  const firstJob = await h.submit();
  const firstKey = h.retainedKey(firstJob);
  expect(firstKey).toStartWith(`tenant/${h.manifest.namespace()}/workspaces/${WORKSPACE_ID}/jobs/${firstJob}/`);
  expect(first.objects.has(firstKey)).toBe(true);
  expect(h.installationS3.objects.has(firstKey)).toBe(false);

  const moved = await h.save(bucketSettings(second.endpoint, { access_key_id: null, secret_access_key: null }), {
    "if-match": '"source-storage-1"',
  });

  expect(moved.status).toBe(200);
  expect(moved.headers.get("etag")).toBe('"source-storage-2"');
  expect(await body(moved)).toMatchObject({ previous_locations_pending: 1 });
  const secondJob = await h.submit();
  expect(second.objects.has(h.retainedKey(secondJob))).toBe(true);

  // Every original is still served from the bucket it was written to.
  for (const jobId of [installationJob, firstJob, secondJob]) {
    const response = await h.api(`/jobs/${jobId}/source`);
    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  }

  // Deleting the earlier Document cleans up in its own, retired bucket.
  expect((await h.api(`/jobs/${firstJob}`, { method: "DELETE" })).status).toBe(200);
  await h.cleanupAt(Date.now() + LATER).run();
  expect(first.objects.has(firstKey)).toBe(false);
  expect(await body(await h.settings())).toMatchObject({ previous_locations_pending: 0 });
});

test("rotating credentials keeps the location and rebuilds its client; unreadable credentials need new keys", async () => {
  const h = await harness();
  const tenant = fakeBucket();
  expect((await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" })).status).toBe(200);
  const destinationId = h.destinations.current(WORKSPACE_ID)!.id;
  const jobId = await h.submit();

  const rotated = await h.save(bucketSettings(tenant.endpoint, { access_key_id: "rotated-access-key" }), {
    "if-match": '"source-storage-1"',
  });

  expect(rotated.status).toBe(200);
  expect(h.destinations.current(WORKSPACE_ID)).toMatchObject({ id: destinationId, revision: 2, accessKeyIdHint: "…-key" });

  // The region only signs requests, so correcting it keeps the destination and its objects.
  const corrected = await h.save(bucketSettings(tenant.endpoint, { region: "us-west-1", access_key_id: "rotated-access-key" }), {
    "if-match": '"source-storage-2"',
  });

  expect(await body(corrected)).toMatchObject({ override: { region: "us-west-1", revision: 3 } });
  expect(h.destinations.current(WORKSPACE_ID)).toMatchObject({ id: destinationId, location: { region: "us-west-1" } });
  expect((await h.api(`/jobs/${jobId}/source`)).status).toBe(200);
  expect(h.createdStores.filter((store) => store.startsWith("tenant-documents:"))).toEqual([
    "tenant-documents:tenant-access-key",
    "tenant-documents:rotated-access-key",
  ]);

  // Without the machine key, the saved credentials cannot be read: reads are unavailable and a save needs new keys.
  await rm(join(h.stateDirectory, "secrets", "model-gateway.key"));
  expect(await body(await h.settings())).toMatchObject({ override: { credential_status: "unavailable" } });
  expect(
    await errorCode(
      await h.save(bucketSettings(tenant.endpoint, { access_key_id: null, secret_access_key: null }), {
        "if-match": '"source-storage-3"',
      }),
    ),
  ).toBe("source_storage_credentials_unavailable");
});

test("an unreachable Workspace bucket does not hold up cleanup or reads for the installation bucket", async () => {
  const h = await harness();
  const tenant = fakeBucket();
  const installationJob = await h.submit();
  const installationKey = h.retainedKey(installationJob);
  expect((await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" })).status).toBe(200);
  const tenantJobs = [await h.submit(), await h.submit()];
  tenant.state.down = true;

  for (const jobId of [installationJob, ...tenantJobs])
    expect((await h.api(`/jobs/${jobId}`, { method: "DELETE" })).status).toBe(200);

  await h.cleanupAt(Date.now() + LATER).run();
  expect(h.installationS3.objects.has(installationKey)).toBe(false);
  // The failing bucket stops at its first failure in a sweep; both entries stay queued for retry.
  expect(h.manifest.counts().deleting).toBe(2);

  // Read slots are per bucket: a saturated Workspace bucket leaves the installation's untouched.
  h.manifest.prepare({
    objectKey: "tenant/held.pdf",
    destinationId: h.destinations.current(WORKSPACE_ID)!.id,
    workspaceId: WORKSPACE_ID,
    ownerKind: "job",
    ownerId: "job_held",
  });
  const tenantReads = Array.from({ length: 8 }, () => h.sourceObjects.acquireRead("tenant/held.pdf"));
  expect(tenantReads.every(Boolean)).toBe(true);
  expect(h.sourceObjects.acquireRead("tenant/held.pdf")).toBeNull();
  const installationRead = h.sourceObjects.acquireRead(installationKey);
  expect(installationRead).not.toBeNull();
  installationRead?.();
  tenantReads[0]?.();
  expect(h.sourceObjects.acquireRead("tenant/held.pdf")).not.toBeNull();
});

test("Workspace erasure retires its buckets, cleanup still empties them, and their credentials are then forgotten", async () => {
  const h = await harness({ installationBucket: false });
  const tenant = fakeBucket();
  expect((await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" })).status).toBe(200);
  const destinationId = h.destinations.current(WORKSPACE_ID)!.id;
  await h.submit();
  await h.submit();
  expect(tenant.objects.size).toBe(2);
  tenant.state.down = true;

  const deletion = createLocalWorkspaceDeletion({
    sourceFileStore: h.sourceFiles,
    stateDirectory: h.stateDirectory,
    productStoreRegistry: h.registry,
    sourceObjectManifest: h.manifest,
    sourceStorageDestinations: h.destinations,
    workspaceControl: workspaceControlFixture({
      assertWorkspaceDeletion: () => {},
      recordWorkspaceDeletionIntent: () => {},
      deleteWorkspace: () => {},
      completeWorkspaceDeletionIntent: () => {},
    }),
  });

  await deletion.deleteWorkspace({ workspaceId: WORKSPACE_ID, userId: "user_a" });
  h.setWorkspaceExists(false);
  expect(h.destinations.current(WORKSPACE_ID)).toBeNull();
  expect(h.destinations.get(destinationId)?.retiredAt).not.toBeNull();

  await h.cleanupAt(Date.now() + LATER).run();
  expect(tenant.objects.size).toBe(2);
  expect(h.destinations.get(destinationId)).not.toBeNull();

  tenant.state.down = false;
  await h.cleanupAt(Date.now() + 4 * LATER).run();
  await h.cleanupAt(Date.now() + 8 * LATER).run();
  expect(tenant.objects.size).toBe(0);
  expect(h.manifest.counts()).toEqual({ preparing: 0, linked: 0, deleting: 0 });
  expect(h.destinations.get(destinationId)).toBeNull();
});

test("with Workspace storage turned off, saved buckets serve existing originals but take no new ones", async () => {
  const h = await harness();
  const tenant = fakeBucket();
  expect((await h.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" })).status).toBe(200);
  const tenantJob = await h.submit();

  const off = await harness({ overridesEnabled: false });
  expect(await errorCode(await off.save(bucketSettings(tenant.endpoint), { "if-none-match": "*" }))).toBe(
    "source_storage_overrides_disabled",
  );

  // Same control data, operator switch off: routing ignores the saved bucket for new uploads only.
  const disabled = createLocalRetainedSourceObjects({
    manifest: h.manifest,
    destinations: h.destinations,
    installation: {
      bucket: "installation",
      region: "us-east-1",
      endpoint: h.installationS3.endpoint,
      forcePathStyle: true,
      prefix: "document-extraction/",
      accessKeyId: "installation-access",
      secretAccessKey: "installation-secret",
    },
    namespace: h.manifest.namespace(),
    overridesEnabled: false,
  });

  expect(disabled.destinationFor(WORKSPACE_ID)?.id).toBe(INSTALLATION_DESTINATION_ID);
  const original = await disabled.store.open(h.retainedKey(tenantJob));
  expect(original.size).toBeGreaterThan(0);
});
