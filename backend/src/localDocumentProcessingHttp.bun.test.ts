import { jsonText } from "./testing/jsonFixture";
import { readTextFieldsResponse, readObjectResponse, readJobAdmission } from "./testing/responseFixture";

import { fixtureRequestInit } from "./testing/requestFixture";
import type { JsonValue } from "../../shared/json";
import { workspaceControlFixture, workspaceFixture, isWorkspaceRole } from "./testing/workspaceControlFixture";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { createLocalApplication } from "./localApplication";
import { createConfiguredTestProductStore } from "./testing/workspaceModelFixture";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";

import type { LocalAuth } from "./localAuth";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const time = "2026-10-02T18:00:00.000Z";

async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "processing-api-")),
    workspaceId = "workspace_a";

  cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
  const store = createConfiguredTestProductStore({ stateDirectory, workspaceId });
  cleanups.push(() => store.close());
  store.createTemplate({
    templateId: "tpl_invoice",
    name: "Invoice",
    description: "Invoices",
    fields: [{ id: "total", name: "Total", description: "PRIVATE", data_type: "number" }],
    tags: ["invoice"],
    createdAt: time,
  });
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);

  const sourceFileStore = createLocalSourceFileStore({ stateDirectory }),
    scheduled: LocalQueuedExtractionJob[] = [];

  const workspace = workspaceFixture({
    id: workspaceId,
    name: "Workspace",
    role: "owner",
    max_source_file_bytes: null,
    source_retention_disabled: true,
  });

  const workspaceControl = workspaceControlFixture({
    authorizeApiKey: ({ apiKey }: { apiKey: string }) =>
      apiKey === "secret"
        ? workspace
        : apiKey === "other"
          ? workspaceFixture({ ...workspace, id: "workspace_b" })
          : null,
    getAcceptedWorkspaceContext: ({
      workspaceId: selectedWorkspaceId,
      userId,
    }: {
      workspaceId: string;
      userId: string;
    }) => (selectedWorkspaceId === workspaceId && isWorkspaceRole(userId) ? { ...workspace, role: userId } : null),
    hasPendingStarterTemplateBootstrap: () => false,
    workspaceExists: () => true,
  });

  const auth: LocalAuth = {
    getSession: async (request) => {
      const id = request.headers.get("cookie");

      return id ? { id, email: `${id}@example.com`, name: id } : null;
    },
    handler: async () => new Response(null),
  };

  const app = createLocalApplication({
    auth,
    stateDirectory,
    workspaceControl,
    productStoreRegistry: registry,
    sourceFileStore,
    scheduleQueuedJob: (job) => {
      scheduled.push(job);
    },
  });

  const send = (path: string, method = "GET", body?: JsonValue | FormData, headers: Record<string, string> = {}) =>
    app(new Request(`http://localhost/v1${path}`, fixtureRequestInit(method, body, headers)));

  const request = (path: string, method = "GET", body?: JsonValue | FormData, key = "secret") =>
    send(path, method, body, { authorization: `Bearer ${key}` });

  const sessionRequest = (path: string, method = "GET", body?: JsonValue | FormData) =>
    send(path, method, body, { cookie: "owner", "x-workspace-id": workspaceId });

  const submit = async (
    fields: Record<string, string | undefined> = { template_tags: '[" INVOICE ","invoice"]' },
    pdf = false,
    pdfPageCount = 3,
  ) => {
    const form = new FormData();

    if (pdf) {
      const doc = await PDFDocument.create();

      for (let n = 1; n <= pdfPageCount; n++) doc.addPage([100 + n, 100]);
      form.set("document", new File([Uint8Array.from(await doc.save())], "packet.pdf", { type: "application/pdf" }));
    } else form.set("document", new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }));

    for (const [name, value] of Object.entries(fields)) if (value !== undefined) form.set(name, value);

    return request("/extract", "POST", form);
  };

  const runner = createLocalExtractionRunner({
    stateDirectory,
    productStoreRegistry: registry,
    sourceFileStore,
    workspaceControl,
    scheduleJob: (job) => {
      scheduled.push(job);
    },
    classify: async () => ({ status: "no_match", template_id: null, reason: "No invoice present", evidence: [] }),
    splitDocument: async () => ({
      status: "uncertain",
      groups: [],
      exclusions: [],
      reason: "Boundaries unclear",
      evidence: [],
    }),
    extract: async () => [],
  });

  return { store, request, sessionRequest, send, submit, scheduled, sourceFileStore, runner };
}

test("admission requires ID or tags, normalizes scope, rejects overrides and never falls back from an explicit invalid ID", async () => {
  const f = await fixture();

  for (const fields of [
    {},
    { template_tags: "[]" },
    { template_id: " ", template_tags: '["invoice"]' },
    { template_id: "tpl_invoice", template_tags: "null" },
    { template_tags: '["invoice"]', enable_smart_splitting: "true" },
    { template_tags: '["invoice"]', options: '{"exclude_blank_pages":true}' },
  ] satisfies Record<string, string>[])
    expect((await f.submit(fields)).status).toBe(400);
  expect((await f.submit({ template_id: "missing", template_tags: '["invoice"]' })).status).toBe(404);
  expect(f.scheduled).toHaveLength(0);
  expect(f.store.countExtractionJobs()).toBe(0);
  const response = await f.submit();
  expect(response.status).toBe(202);

  const job = await readJobAdmission(response);

  const details = await (await f.request(`/jobs/${job.job_id}`)).json();
  expect(details).toMatchObject({
    template_id: null,
    template_version: null,
    template_tags: ["invoice"],
    routing_status: "pending",
    selection_mode: "automatic",
  });
  expect((await f.request(`/jobs/${job.job_id}`, "GET", undefined, "other")).status).toBe(404);
});

test("manual routing holds preserve preview source and resolve the same job with CAS and a new ETag", async () => {
  const f = await fixture();

  const admission = await readJobAdmission(await f.submit());

  await f.runner.run(f.scheduled[0]!);
  const before = await f.request(`/jobs/${admission.job_id}`);
  const oldTag = before.headers.get("etag");
  expect(await before.json()).toMatchObject({ status: "awaiting_template", template_id: null });
  expect((await f.request(`/jobs/${admission.job_id}/source`)).status).toBe(200);
  expect(await (await f.request("/jobs/counts")).json()).toMatchObject({
    total: 1,
    status_counts: { awaiting_template: 1 },
  });
  const resolved = await f.sessionRequest(`/jobs/${admission.job_id}/template`, "POST", { template_id: "tpl_invoice" });
  expect(resolved.status).toBe(200);
  expect(await resolved.json()).toMatchObject({
    job_id: admission.job_id,
    status: "queued",
    template_id: "tpl_invoice",
    template_version: 1,
    selection_mode: "manual",
  });
  expect(
    (await f.sessionRequest(`/jobs/${admission.job_id}/template`, "POST", { template_id: "tpl_invoice" })).status,
  ).toBe(409);
  expect((await f.request(`/jobs/${admission.job_id}`)).headers.get("etag")).not.toBe(oldTag);
});

test("page selection validates before acceptance and creates the real subset with splitting disabled", async () => {
  const f = await fixture();
  f.store.putDocumentProcessingSettings({ enable_smart_splitting: false, exclude_blank_pages: true });

  for (const pages of ["[]", "[1,1]", "[0]", "[4]", "[1.5]"])
    expect((await f.submit({ template_id: "tpl_invoice", pages }, true)).status).toBe(400);
  expect((await f.submit({ template_id: "tpl_invoice", pages: "[1]" })).status).toBe(400);
  const admitted = await f.submit({ template_id: "tpl_invoice", pages: "[3,1]" }, true);
  expect(admitted.status).toBe(202);

  const { job_id } = await readJobAdmission(admitted);

  const job = f.store.getExtractionJobSummary(job_id)!;
  expect(job).toMatchObject({ source_file_page_count: 2, source_pages: [1, 3], template_id: "tpl_invoice" });
  const bytes = await f.sourceFileStore.read(f.store.getProcessingSource(job_id)!.source_file_key);
  const pdf = await PDFDocument.load(bytes!);
  expect(pdf.getPages().map((page) => page.getWidth())).toEqual([101, 103]);
  expect(f.store.listDocumentPackets()).toEqual([]);
});

test.each([false, true])(
  "one-page PDF uploads extract directly with smart splitting enabled and blank exclusion %s",
  async (excludeBlankPages) => {
    const f = await fixture();
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: excludeBlankPages });
    // The fixture contains a blank page, which must still be submitted for extraction.
    const admitted = await f.submit({ template_id: "tpl_invoice" }, true, 1);
    expect(admitted.status).toBe(202);
    const { job_id } = await readJobAdmission(admitted);
    expect(admitted.headers.get("location")).toBe(`/v1/jobs/${job_id}`);
    expect(f.store.getExtractionJobSummary(job_id)).toMatchObject({
      status: "queued",
      source_file_page_count: 1,
      template_id: "tpl_invoice",
      template_version: 1,
    });
    expect(f.store.listDocumentPackets()).toEqual([]);
    await f.runner.run(f.scheduled[0]!);
    expect(f.store.getExtractionJobSummary(job_id)?.status).toBe("completed");
  },
);

test.each([false, true])(
  "one-page PDF uploads preserve automatic template selection with blank exclusion %s",
  async (excludeBlankPages) => {
    const f = await fixture();
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: excludeBlankPages });
    const admitted = await f.submit({ template_tags: '["invoice"]', pages: "[1]" }, true, 1);
    expect(admitted.status).toBe(202);
    const { job_id } = await readJobAdmission(admitted);
    expect(f.store.getExtractionJobSummary(job_id)).toMatchObject({
      source_file_page_count: 1,
      source_pages: [1],
      template_id: null,
      template_tags: ["invoice"],
      selection_mode: "automatic",
    });
    expect(f.store.listDocumentPackets()).toEqual([]);
    await f.runner.run(f.scheduled[0]!);
    expect(f.store.getExtractionJobSummary(job_id)).toMatchObject({
      status: "awaiting_template",
      selection_reason: "No invoice present",
    });
    expect((await f.request(`/jobs/${job_id}/source`)).status).toBe(200);
  },
);

test("multi-page PDF uploads retain split assessment and blank exclusion when only one page is selected", async () => {
  const f = await fixture();
  f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: true });
  const admitted = await f.submit({ template_id: "tpl_invoice", pages: "[2]" }, true);
  expect(admitted.status).toBe(202);
  const packet = await readTextFieldsResponse(admitted, "packet_id");
  expect(admitted.headers.get("location")).toBe(`/v1/packets/${packet.packet_id}`);
  expect(packet).toMatchObject({
    source_file_page_count: 3,
    selected_pages: [2],
    processing_policy: { enable_smart_splitting: true, exclude_blank_pages: true },
    children: [],
  });
  await f.runner.run(f.scheduled[0]!);
  expect(f.store.getDocumentPacket(packet.packet_id)?.status).toBe("awaiting_review");

  const response = await f.sessionRequest(`/packets/${packet.packet_id}/plan`, "POST", {
    revision: 1,
    groups: [],
    exclusions: [{ page: 2, reason: "Blank", verified_blank: false }],
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "completed", outcome: "no_documents", children: [] });
  expect(f.store.countExtractionJobs()).toBe(0);
});

test("smart splitting captures workspace policy, holds without children, previews, and commits one revision", async () => {
  const f = await fixture();
  f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: false });
  const admitted = await f.submit({ template_tags: '["invoice"]', pages: "[1,3]" }, true);
  expect(admitted.status).toBe(202);
  const packet = await readTextFieldsResponse(admitted, "packet_id");
  expect(packet).toMatchObject({
    status: "queued",
    selected_pages: [1, 3],
    processing_policy: { enable_smart_splitting: true, exclude_blank_pages: false },
    children: [],
  });
  expect(packet).not.toHaveProperty("source_file_key");
  expect(f.store.countExtractionJobs()).toBe(0);
  f.store.putDocumentProcessingSettings({ enable_smart_splitting: false, exclude_blank_pages: true });
  await f.runner.run(f.scheduled[0]!);
  expect(f.store.getDocumentPacket(packet.packet_id)?.status).toBe("awaiting_review");
  expect((await f.request(`/packets/${packet.packet_id}/pages/1/preview`)).headers.get("content-type")).toBe(
    "image/png",
  );
  expect((await f.request(`/packets/${packet.packet_id}/pages/2/preview`)).status).toBe(400);
  expect(
    (
      await f.sessionRequest(`/packets/${packet.packet_id}/plan`, "POST", {
        revision: 1,
        groups: [{ pages: [1] }],
        exclusions: [],
      })
    ).status,
  ).toBe(400);

  const reviewed = await f.sessionRequest(`/packets/${packet.packet_id}/plan`, "POST", {
    revision: 1,
    groups: [{ pages: [1] }, { pages: [3] }],
    exclusions: [],
  });

  expect(reviewed.status).toBe(200);
  expect(
    (
      await f.sessionRequest(`/packets/${packet.packet_id}/plan`, "POST", {
        revision: 1,
        groups: [{ pages: [1, 3] }],
        exclusions: [],
      })
    ).status,
  ).toBe(409);
  await f.runner.run(f.scheduled.at(-1)!);
  expect(f.store.getDocumentPacket(packet.packet_id)?.children).toHaveLength(2);
  const slots = f.store.getDocumentPacket(packet.packet_id)!.child_slots;
  expect(f.store.countExtractionJobs()).toBe(2);
  expect((await f.request(`/packets/${packet.packet_id}`, "DELETE")).status).toBe(200);
  expect(f.store.countExtractionJobs()).toBe(0);

  for (const slot of slots) expect(await f.sourceFileStore.read(slot.source_file_key!)).toBeNull();
  expect((await f.request(`/packets/${packet.packet_id}`)).status).toBe(404);
});

test("manual zero-child completion independently verifies every page and excludes parents from job totals", async () => {
  const f = await fixture();
  f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: true });
  const packet = await readTextFieldsResponse(await f.submit({ template_id: "tpl_invoice" }, true), "packet_id");
  await f.runner.run(f.scheduled[0]!);

  const response = await f.sessionRequest(`/packets/${packet.packet_id}/plan`, "POST", {
    revision: 1,
    groups: [],
    exclusions: [1, 2, 3].map((page) => ({ page, reason: "Blank", verified_blank: false })),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "completed", outcome: "no_documents", children: [] });
  expect(f.store.countExtractionJobs()).toBe(0);
  expect((await f.request("/packets")).status).toBe(200);
});

test.each(["job", "packet"] as const)(
  "manual %s resolution requires a workspace session and never mutates holds for API keys",
  async (kind) => {
    const f = await fixture();
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: kind === "packet", exclude_blank_pages: false });
    // Uploads and polling remain available to API clients, including when processing is held.
    const admitted = await f.submit({ template_tags: '["invoice"]' }, kind === "packet");
    expect(admitted.status).toBe(202);
    const admission = await readObjectResponse(admitted);
    const id = jsonText(kind === "packet" ? admission.packet_id : admission.job_id);
    await f.runner.run(f.scheduled[0]!);
    const resource = kind === "packet" ? `/packets/${id}` : `/jobs/${id}`;
    const path = `${resource}/${kind === "packet" ? "plan" : "template"}`;

    const body =
      kind === "packet"
        ? { revision: 1, groups: [{ pages: [1, 2, 3] }], exclusions: [] }
        : { template_id: "tpl_invoice" };

    const heldState = () => (kind === "packet" ? f.store.getDocumentPacket(id) : f.store.getExtractionJob(id));
    const before = heldState();
    const scheduledBefore = f.scheduled.length;

    const assertUnchanged = () => {
      expect(heldState()).toEqual(before);
      expect(f.scheduled).toHaveLength(scheduledBefore);
    };

    expect((await f.request(resource)).status).toBe(200);
    expect((await f.request(kind === "packet" ? "/packets" : "/jobs")).status).toBe(200);
    expect((await f.request(`${resource}/source`)).status).toBe(200);

    for (const authorization of ["Bearer secret", "Bearer other", "Bearer invalid", "Basic invalid", ""]) {
      for (const withSession of [false, true]) {
        const headers: Record<string, string> = {};
        headers.authorization = authorization;

        if (withSession) {
          headers.cookie = "owner";
          headers["x-workspace-id"] = "workspace_a";
        }

        const response = await f.send(path, "POST", body, headers);

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "session_required" } });
        assertUnchanged();
      }
    }

    for (const [headers, status] of [
      [{}, 401],
      [{ cookie: "outsider", "x-workspace-id": "workspace_a" }, 403],
      [{ cookie: "owner", "x-workspace-id": "workspace_b" }, 403],
      [{ cookie: "owner" }, 403],
    ] satisfies Array<[Record<string, string>, number]>) {
      expect((await f.send(path, "POST", body, headers)).status).toBe(status);
      assertUnchanged();
    }

    const resolved = await f.send(path, "POST", body, { cookie: "member", "x-workspace-id": "workspace_a" });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject(
      kind === "packet"
        ? { packet_id: id, status: "materializing", plan_accepted: true }
        : { job_id: id, status: "queued", selection_mode: "manual", template_id: "tpl_invoice" },
    );
    expect(f.scheduled).toHaveLength(scheduledBefore + 1);
    expect((await f.request(resource)).status).toBe(200);
  },
);
