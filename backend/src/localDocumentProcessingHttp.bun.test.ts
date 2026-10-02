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
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalAuth } from "./localAuth";
import type { DocumentPacket } from "./localDocumentProcessingStore";
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse())
    await cleanup(); });
const time = "2026-10-02T18:00:00.000Z";
async function fixture() {
    const stateDirectory = await mkdtemp(join(tmpdir(), "processing-api-")), workspaceId = "workspace_a";
    cleanups.push(() => rm(stateDirectory, { recursive: true, force: true }));
    const store = createConfiguredTestProductStore({ stateDirectory, workspaceId });
    cleanups.push(() => store.close());
    store.createTemplate({ templateId: "tpl_invoice", name: "Invoice", description: "Invoices", fields: [{ id: "total", name: "Total", description: "PRIVATE", data_type: "number" }], tags: ["invoice"], createdAt: time });
    const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
    cleanups.push(registry.closeAll);
    const sourceFileStore = createLocalSourceFileStore({ stateDirectory }), scheduled: LocalQueuedExtractionJob[] = [];
    const workspace = { id: workspaceId, name: "Workspace", role: "owner", max_source_file_bytes: null, source_retention_disabled: true };
    const workspaceControl = { authorizeApiKey: ({ apiKey }: {
            apiKey: string;
        }) => apiKey === "secret" ? workspace : apiKey === "other" ? { ...workspace, id: "workspace_b" } : null, hasPendingStarterTemplateBootstrap: () => false, workspaceExists: () => true } as unknown as LocalWorkspaceControl;
    const auth = { getSession: async () => null, handler: async () => new Response(null) } as LocalAuth;
    const app = createLocalApplication({ auth, stateDirectory, workspaceControl, productStoreRegistry: registry, sourceFileStore, scheduleQueuedJob: job => { scheduled.push(job); } });
    const request = (path: string, method = "GET", body?: unknown, key = "secret") => app(new Request(`http://localhost/v1${path}`, { method, headers: { authorization: `Bearer ${key}`, ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }));
    const submit = async (fields: Record<string, string> = { template_tags: '[" INVOICE ","invoice"]' }, pdf = false) => {
        const form = new FormData();
        if (pdf) {
            const doc = await PDFDocument.create();
            for (let n = 1; n <= 3; n++)
                doc.addPage([100 + n, 100]);
            form.set("document", new File([Uint8Array.from(await doc.save())], "packet.pdf", { type: "application/pdf" }));
        }
        else
            form.set("document", new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }));
        for (const [name, value] of Object.entries(fields))
            form.set(name, value);
        return request("/extract", "POST", form);
    };
    const runner = createLocalExtractionRunner({ stateDirectory, productStoreRegistry: registry, sourceFileStore, workspaceControl, scheduleJob: job => { scheduled.push(job); }, classify: async () => ({ status: "no_match", template_id: null, reason: "No invoice present", evidence: [] }), splitDocument: async () => ({ status: "uncertain", groups: [], exclusions: [], reason: "Boundaries unclear", evidence: [] }), extract: async () => [] });
    return { store, request, submit, scheduled, sourceFileStore, runner };
}
test("admission requires ID or tags, normalizes scope, rejects overrides and never falls back from an explicit invalid ID", async () => {
    const f = await fixture();
    for (const fields of ([{}, { template_tags: "[]" }, { template_id: " ", template_tags: '["invoice"]' }, { template_id: "tpl_invoice", template_tags: "null" }, { template_tags: '["invoice"]', enable_smart_splitting: "true" }, { template_tags: '["invoice"]', options: '{"exclude_blank_pages":true}' }] as Record<string, string>[]))
        expect((await f.submit(fields)).status).toBe(400);
    expect((await f.submit({ template_id: "missing", template_tags: '["invoice"]' })).status).toBe(404);
    expect(f.scheduled).toHaveLength(0);
    expect(f.store.countExtractionJobs()).toBe(0);
    const response = await f.submit();
    expect(response.status).toBe(202);
    const job = await response.json() as {
        job_id: string;
    };
    const details = await (await f.request(`/jobs/${job.job_id}`)).json();
    expect(details).toMatchObject({ template_id: null, template_version: null, template_tags: ["invoice"], routing_status: "pending", selection_mode: "automatic" });
    expect((await f.request(`/jobs/${job.job_id}`, "GET", undefined, "other")).status).toBe(404);
});
test("manual routing holds preserve preview source and resolve the same job with CAS and a new ETag", async () => {
    const f = await fixture();
    const admission = await (await f.submit()).json() as {
        job_id: string;
    };
    await f.runner.run(f.scheduled[0]!);
    const before = await f.request(`/jobs/${admission.job_id}`);
    const oldTag = before.headers.get("etag");
    expect(await before.json()).toMatchObject({ status: "awaiting_template", template_id: null });
    expect((await f.request(`/jobs/${admission.job_id}/source`)).status).toBe(200);
    expect(await (await f.request("/jobs/counts")).json()).toMatchObject({ total: 1, status_counts: { awaiting_template: 1 } });
    const resolved = await f.request(`/jobs/${admission.job_id}/template`, "POST", { template_id: "tpl_invoice" });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ job_id: admission.job_id, status: "queued", template_id: "tpl_invoice", template_version: 1, selection_mode: "manual" });
    expect((await f.request(`/jobs/${admission.job_id}/template`, "POST", { template_id: "tpl_invoice" })).status).toBe(409);
    expect((await f.request(`/jobs/${admission.job_id}`)).headers.get("etag")).not.toBe(oldTag);
});
test("page selection validates before acceptance and creates the real subset with splitting disabled", async () => {
    const f = await fixture();
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: false, exclude_blank_pages: true });
    for (const pages of ['[]', '[1,1]', '[0]', '[4]', '[1.5]'])
        expect((await f.submit({ template_id: "tpl_invoice", pages }, true)).status).toBe(400);
    expect((await f.submit({ template_id: "tpl_invoice", pages: '[1]' })).status).toBe(400);
    const admitted = await f.submit({ template_id: "tpl_invoice", pages: '[3,1]' }, true);
    expect(admitted.status).toBe(202);
    const { job_id } = await admitted.json() as {
        job_id: string;
    };
    const job = f.store.getExtractionJobSummary(job_id)!;
    expect(job).toMatchObject({ source_file_page_count: 2, source_pages: [1, 3], template_id: "tpl_invoice" });
    const bytes = await f.sourceFileStore.read(f.store.getProcessingSource(job_id)!.source_file_key);
    const pdf = await PDFDocument.load(bytes!);
    expect(pdf.getPages().map(page => page.getWidth())).toEqual([101, 103]);
    expect(f.store.listDocumentPackets()).toEqual([]);
});
test("smart splitting captures workspace policy, holds without children, previews, and commits one revision", async () => {
    const f = await fixture();
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: false });
    const admitted = await f.submit({ template_tags: '["invoice"]', pages: '[1,3]' }, true);
    expect(admitted.status).toBe(202);
    const packet = await admitted.json() as DocumentPacket;
    expect(packet).toMatchObject({ status: "queued", selected_pages: [1, 3], processing_policy: { enable_smart_splitting: true, exclude_blank_pages: false }, children: [] });
    expect(packet).not.toHaveProperty("source_file_key");
    expect(f.store.countExtractionJobs()).toBe(0);
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: false, exclude_blank_pages: true });
    await f.runner.run(f.scheduled[0]!);
    expect(f.store.getDocumentPacket(packet.packet_id)?.status).toBe("awaiting_review");
    expect((await f.request(`/packets/${packet.packet_id}/pages/1/preview`)).headers.get("content-type")).toBe("image/png");
    expect((await f.request(`/packets/${packet.packet_id}/pages/2/preview`)).status).toBe(400);
    expect((await f.request(`/packets/${packet.packet_id}/plan`, "POST", { revision: 1, groups: [{ pages: [1] }], exclusions: [] })).status).toBe(400);
    const reviewed = await f.request(`/packets/${packet.packet_id}/plan`, "POST", { revision: 1, groups: [{ pages: [1] }, { pages: [3] }], exclusions: [] });
    expect(reviewed.status).toBe(200);
    expect((await f.request(`/packets/${packet.packet_id}/plan`, "POST", { revision: 1, groups: [{ pages: [1, 3] }], exclusions: [] })).status).toBe(409);
    await f.runner.run(f.scheduled.at(-1)!);
    expect(f.store.getDocumentPacket(packet.packet_id)?.children).toHaveLength(2);
    const slots = f.store.getDocumentPacket(packet.packet_id)!.child_slots;
    expect(f.store.countExtractionJobs()).toBe(2);
    expect((await f.request(`/packets/${packet.packet_id}`, "DELETE")).status).toBe(200);
    expect(f.store.countExtractionJobs()).toBe(0);
    for (const slot of slots)
        expect(await f.sourceFileStore.read(slot.source_file_key!)).toBeNull();
    expect((await f.request(`/packets/${packet.packet_id}`)).status).toBe(404);
});
test("manual zero-child completion independently verifies every page and excludes parents from job totals", async () => {
    const f = await fixture();
    f.store.putDocumentProcessingSettings({ enable_smart_splitting: true, exclude_blank_pages: true });
    const packet = await (await f.submit({ template_id: "tpl_invoice" }, true)).json() as DocumentPacket;
    await f.runner.run(f.scheduled[0]!);
    const response = await f.request(`/packets/${packet.packet_id}/plan`, "POST", { revision: 1, groups: [], exclusions: [1, 2, 3].map(page => ({ page, reason: "Blank", verified_blank: false })) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", outcome: "no_documents", children: [] });
    expect(f.store.countExtractionJobs()).toBe(0);
    expect((await f.request("/packets")).status).toBe(200);
});
