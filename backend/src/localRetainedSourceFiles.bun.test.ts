import { readObjectResponse, readJobAdmission } from "./testing/responseFixture";

import type { JsonValue } from "../../shared/json";
import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PDFDocument } from "pdf-lib";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import type { LocalSourceStorageConfiguration } from "./localConfiguration";
import { createLocalExtractionRunner } from "./testing/processingAdapter";
import { createLocalSourceFileRetention } from "./localSourceFileRetention";
import { createLocalSourceFileStore, type LocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createFetchRequest, createSignedInUser } from "./testing/localAuthTestClient";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";

const LOCAL_RETENTION: LocalSourceStorageConfiguration = { provider: "local", originalRetentionEnabled: true };

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Workspace = ReturnType<typeof workspaceFixture>;

async function apiKeyHarness({
  sourceStorage,
  sourceRetentionDisabled = false,
  sourceFileStore,
}: {
  sourceStorage?: LocalSourceStorageConfiguration;
  sourceRetentionDisabled?: boolean;
  sourceFileStore?: (stateDirectory: string) => LocalSourceFileStore;
} = {}) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "retained-source-files-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));

  const workspaces = new Map<string, Workspace>(
    Object.entries({
      "key-a": workspaceFixture({
        id: "workspace_a",
        name: "A",
        max_source_file_bytes: 1024 * 1024,
        source_retention_disabled: sourceRetentionDisabled,
      }),
      "key-b": workspaceFixture({
        id: "workspace_b",
        name: "B",
        max_source_file_bytes: 1024 * 1024,
        source_retention_disabled: false,
      }),
    }),
  );

  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);

  for (const workspace of workspaces.values()) {
    configureTestWorkspace({ stateDirectory, workspaceId: workspace.id });
    const lease = registry.acquire({ workspaceId: workspace.id, mode: "existing" })!;

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
  }

  const sourceFiles = sourceFileStore?.(stateDirectory) ?? createLocalSourceFileStore({ stateDirectory });

  const application = createLocalApplication({
    auth: { handler: async () => new Response(null), getSession: async () => null },
    workspaceControl: workspaceControlFixture({
      authorizeApiKey: ({ apiKey }: { apiKey: string }) => workspaces.get(apiKey) ?? null,
      hasPendingStarterTemplateBootstrap: () => false,
      workspaceExists: () => true,
    }),
    stateDirectory,
    productStoreRegistry: registry,
    sourceFileStore: sourceFiles,
    sourceStorage,
    scheduleQueuedJob: async () => {},
  });

  const call = (path: string, init: RequestInit & { key?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${init.key ?? "key-a"}`);

    return application(new Request(`http://localhost/v1${path}`, { ...init, headers }));
  };

  const submit = async (bytes: Uint8Array, name = "Invoice März.pdf") => {
    const body = new FormData();
    body.set("document", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
    body.set("template_id", "tpl_invoice");
    const response = await call("/extract", { method: "POST", body });
    expect(response.status).toBe(202);

    return (await readJobAdmission(response)).job_id;
  };

  return { application, call, registry, sourceFiles, stateDirectory, submit };
}

async function pdfBytes(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();

  return pdf.save();
}

test("a retained original is streamed back byte-for-byte with safe download headers", async () => {
  const harness = await apiKeyHarness({ sourceStorage: LOCAL_RETENTION });
  const original = await pdfBytes();
  const jobId = await harness.submit(original);

  const detail = await readObjectResponse(await harness.call(`/jobs/${jobId}`));
  expect(detail.source_retained).toBe(true);

  const response = await harness.call(`/jobs/${jobId}/source`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-length")).toBe(String(original.byteLength));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="Invoice M_rz.pdf"; filename*=UTF-8''${encodeURIComponent("Invoice März.pdf")}`,
  );
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(original));

  const head = await harness.call(`/jobs/${jobId}/source`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(original.byteLength));
  expect(await head.text()).toBe("");
});

test("originals are not retained without installation storage or when the Workspace opts out", async () => {
  for (const options of [
    {},
    { sourceStorage: LOCAL_RETENTION, sourceRetentionDisabled: true },
    { sourceStorage: { provider: "local", originalRetentionEnabled: false } as const },
  ]) {
    const harness = await apiKeyHarness(options);
    const jobId = await harness.submit(await pdfBytes());
    const detail = await readObjectResponse(await harness.call(`/jobs/${jobId}`));
    expect(detail.source_retained).toBe(false);
    const response = await harness.call(`/jobs/${jobId}/source`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "source_not_retained" } });
  }
});

test("retrieval distinguishes missing and unavailable originals and never crosses Workspaces", async () => {
  let failOpen = false;

  const harness = await apiKeyHarness({
    sourceStorage: LOCAL_RETENTION,
    sourceFileStore: (stateDirectory) => {
      const store = createLocalSourceFileStore({ stateDirectory });

      return {
        ...store,
        open: async (key) => {
          if (failOpen) throw new Error("disk offline");

          return store.open!(key);
        },
      };
    },
  });

  const jobId = await harness.submit(await pdfBytes());

  const otherWorkspace = await harness.call(`/jobs/${jobId}/source`, { key: "key-b" });
  expect(otherWorkspace.status).toBe(404);
  expect(await otherWorkspace.json()).toMatchObject({ error: { code: "not_found" } });
  expect((await harness.call(`/jobs/${jobId}/source`, { key: "unknown" })).status).toBe(403);

  failOpen = true;
  const unavailable = await harness.call(`/jobs/${jobId}/source`);
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get("retry-after")).toBe("5");
  expect(await unavailable.json()).toMatchObject({ error: { code: "source_unavailable" } });

  failOpen = false;
  const lease = harness.registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;
  const key = lease.store.getRetainedSourceFile(jobId)!.source_file_key;
  lease.release();
  await harness.sourceFiles.delete(key);
  const missing = await harness.call(`/jobs/${jobId}/source`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "source_missing" } });
});

test("processing completion and the terminal sweep keep retained originals; Document deletion removes them", async () => {
  const harness = await apiKeyHarness({ sourceStorage: LOCAL_RETENTION });
  const retainedJob = await harness.submit(await pdfBytes());

  const runner = createLocalExtractionRunner({
    extract: async () => [{ field_id: "total", status: "ok", answer: 1, confidence: 0.9, evidence: "Total" }],
    productStoreRegistry: harness.registry,
    sourceFileStore: harness.sourceFiles,
    stateDirectory: harness.stateDirectory,
  });

  await runner.run({
    job_id: retainedJob,
    workspace_id: "workspace_a",
    template_id: "tpl_invoice",
    template_version: 1,
    enqueued_at: new Date().toISOString(),
  });
  const lease = harness.registry.acquire({ workspaceId: "workspace_a", mode: "existing" })!;
  const key = lease.store.getRetainedSourceFile(retainedJob)!.source_file_key;
  expect(lease.store.getExtractionJob(retainedJob)).toMatchObject({ status: "completed", source_retained: true });
  lease.release();
  expect(await harness.sourceFiles.read(key)).not.toBeNull();

  await createLocalSourceFileRetention({
    failedSourceRetentionMs: 0,
    productStoreRegistry: harness.registry,
    sourceFileStore: harness.sourceFiles,
    stateDirectory: harness.stateDirectory,
  }).run();
  expect(await harness.sourceFiles.read(key)).not.toBeNull();

  const deleted = await harness.call(`/jobs/${retainedJob}`, { method: "DELETE" });
  expect(deleted.status).toBe(200);
  expect(await harness.sourceFiles.read(key)).toBeNull();
  expect((await harness.call(`/jobs/${retainedJob}/source`)).status).toBe(404);
});

test("Workspace owners and admins control source retention through the session-only settings route", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "retained-source-settings-"));
  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const database = new Database(":memory:");
  cleanups.push(() => database.close());
  const verificationLinks: string[] = [];

  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        const link = message.text.match(/https?:\/\/\S+/)?.[0];

        if (link) verificationLinks.push(link);
      },
    },
    secret: "01234567890123456789012345678901",
  });

  const workspaceControl = createLocalWorkspaceControl(database);

  const build = (sourceStorage?: LocalSourceStorageConfiguration) =>
    createLocalApplication({
      auth,
      sourceStorage,
      stateDirectory,
      workspaceControl,
      sourceFileStore: createLocalSourceFileStore({ stateDirectory }),
    });

  const application = build(LOCAL_RETENTION);

  const owner = await createSignedInUser({
    application,
    auth,
    email: "ada@example.com",
    name: "Ada",
    verificationLinks,
  });

  const member = await createSignedInUser({
    application,
    auth,
    email: "grace@example.com",
    name: "Grace",
    verificationLinks,
  });

  const workspace = workspaceControl.listAcceptedWorkspaces({ userId: owner.session.id, userName: "Ada" })[0]!;

  const invitation = workspaceControl.createInvitation({
    workspaceId: workspace.id,
    inviterUserId: owner.session.id,
    email: "grace@example.com",
  });

  workspaceControl.acceptInvitation({
    invitationId: invitation.id,
    userId: member.session.id,
    userEmail: "grace@example.com",
  });
  const path = `/workspaces/${workspace.id}/source-retention`;
  const ownerRequest = createFetchRequest(application, owner.cookie);

  const get = (request: typeof ownerRequest) => request(path);

  const put = (request: typeof ownerRequest, disabled: JsonValue) =>
    request(path, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:8787" },
      body: JSON.stringify({ disabled }),
    });

  await expect(get(ownerRequest)).resolves.toEqual({
    workspace_id: workspace.id,
    storage_configured: true,
    installation_retains_originals: true,
    source_retention_disabled: false,
    retains_new_originals: true,
  });
  await expect(put(ownerRequest, true)).resolves.toMatchObject({
    source_retention_disabled: true,
    retains_new_originals: false,
  });
  expect(
    workspaceControl.getAcceptedWorkspaceContext({ workspaceId: workspace.id, userId: owner.session.id })
      ?.source_retention_disabled,
  ).toBe(true);
  await expect(put(createFetchRequest(application, member.cookie), false)).rejects.toMatchObject({ status: 403 });
  await expect(put(ownerRequest, "no")).rejects.toMatchObject({ status: 400, code: "invalid_source_retention" });
  await expect(put(ownerRequest, false)).resolves.toMatchObject({
    source_retention_disabled: false,
    retains_new_originals: true,
  });

  const withoutStorage = createFetchRequest(build(), owner.cookie);
  await expect(get(withoutStorage)).resolves.toMatchObject({ storage_configured: false, retains_new_originals: false });
  await expect(put(withoutStorage, false)).rejects.toMatchObject({
    status: 409,
    code: "source_storage_not_configured",
  });
});
