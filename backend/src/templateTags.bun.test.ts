import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTemplateTagName, normalizeTemplateTags } from "../../shared/templateTags";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore, type LocalWorkspaceTemplateTag } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import type { LocalWorkspaceProductAnalyticsEvent } from "./localProductAnalytics";
import { createSignedInUser } from "./testing/localAuthTestClient";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const template = { name: "Invoice", description: "Invoice fields", fields: [{ name: "Total", description: "Amount due", data_type: "number" }] };
const now = "2026-10-02T12:00:00.000Z";
const origin = "http://127.0.0.1:8787";
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "template-tags-"));
  cleanups.push(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

async function fixture(streamed = true) {
  const stateDirectory = temporaryDirectory();
  const database = new Database(join(stateDirectory, "control.sqlite"));
  cleanups.push(() => database.close());
  const verificationLinks: string[] = [];
  const auth = await createLocalAuth({
    database, baseURL: origin, requireEmailVerification: true,
    secret: "01234567890123456789012345678901",
    mailSink: { capture: async (message) => {
      const link = message.text.match(/https?:\/\/\S+/)?.[0];
      if (link) verificationLinks.push(link);
    } },
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  const sourceFileStore = createLocalSourceFileStore({ stateDirectory });
  if (!streamed) delete sourceFileStore.promoteTemporary;
  const analytics: LocalWorkspaceProductAnalyticsEvent[] = [];
  const application = createLocalApplication({ stateDirectory, auth, workspaceControl, productStoreRegistry: registry, sourceFileStore,
    productAnalytics: { record: (event) => analytics.push(event), flush: async () => {} } });
  const signUp = (email: string, name: string) => createSignedInUser({ application, auth, email, name, verificationLinks });
  const owner = await signUp("owner@example.com", "Owner");
  const member = await signUp("member@example.com", "Member");
  const stranger = await signUp("stranger@example.com", "Stranger");
  const workspaceId = workspaceControl.listAcceptedWorkspaces({ userId: owner.session.id })[0]!.id;
  const otherWorkspaceId = workspaceControl.listAcceptedWorkspaces({ userId: stranger.session.id })[0]!.id;
  const invitation = workspaceControl.createInvitation({ workspaceId, inviterUserId: owner.session.id, email: member.session.email });
  workspaceControl.acceptInvitation({ invitationId: invitation.id, userId: member.session.id, userEmail: member.session.email });
  const key = workspaceControl.rotateApiKey({ workspaceId, userId: owner.session.id }).api_key;
  const otherKey = workspaceControl.rotateApiKey({ workspaceId: otherWorkspaceId, userId: stranger.session.id }).api_key;
  configureTestWorkspace({ stateDirectory, workspaceId });
  configureTestWorkspace({ stateDirectory, workspaceId: otherWorkspaceId });
  const memberHeaders = { cookie: member.cookie, "x-workspace-id": workspaceId };
  const strangerHeaders = { cookie: stranger.cookie, "x-workspace-id": workspaceId };
  const otherKeyHeaders = { authorization: `Bearer ${otherKey}` };
  const request = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = { authorization: `Bearer ${key}` }) => application(new Request(`${origin}/v1${path}`, {
    method, headers: { origin, ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  }));
  const tags = async () => (await (await request("/template-tags")).json() as { tags: LocalWorkspaceTemplateTag[] }).tags;
  const create = async (names?: string[]) => {
    const response = await request("/templates", "POST", { ...template, ...(names ? { tags: names } : {}) });
    expect(response.status).toBe(201);
    return (await response.json() as { template_id: string }).template_id;
  };
  return { stateDirectory, registry, request, tags, create, analytics, workspaceId, memberHeaders, strangerHeaders, otherKeyHeaders };
}

test("tag normalization produces sorted unique names and bounds malformed inputs", () => {
  expect(normalizeTemplateTags([" Vendor   Invoices ", "vendor invoices", "FINANCE"])).toEqual(["finance", "vendor invoices"]);
  expect(normalizeTemplateTags([])).toEqual([]);
  expect(normalizeTemplateTagName("  ÉCOLE  ")).toBe("école");
  for (const value of [null, "invoice", [null], [4], [""], ["   "], ["a\nb"], ["a\tb"], ["x\u007f"], ["x".repeat(65)], Array(51).fill("a")]) {
    expect(() => normalizeTemplateTags(value)).toThrow();
  }
});

test("tags are reusable metadata with atomic saves, global management, and unused vocabulary", async () => {
  const f = await fixture();
  const first = await f.create([" Confidential Client ", "Business  Invoice", "business invoice"]);
  const second = await f.create(["confidential client"]);
  expect((await f.tags()).map(({ name, template_count }) => ({ name, template_count }))).toEqual([
    { name: "business invoice", template_count: 1 }, { name: "confidential client", template_count: 2 },
  ]);
  const detail = await (await f.request(`/templates/${first}`)).json();
  expect(detail).toMatchObject({ tags: ["business invoice", "confidential client"], current_version: 1 });
  const templates = await (await f.request("/templates")).json() as { templates: Array<{ id: string; tags: string[] }> };
  expect(templates.templates.find(({ id }) => id === first)?.tags).toEqual(["business invoice", "confidential client"]);
  expect((await f.request(`/templates/${first}`, "PATCH", { description: "New description" })).status).toBe(200);
  expect(await (await f.request(`/templates/${first}`)).json()).toMatchObject({ tags: ["business invoice", "confidential client"], current_version: 1 });
  expect((await f.request(`/templates/${first}`, "PATCH", { tags: [] })).status).toBe(200);
  expect(await (await f.request(`/templates/${first}`)).json()).toMatchObject({ tags: [], current_version: 1 });
  const catalog = await f.tags();
  const business = catalog.find(({ name }) => name === "business invoice")!;
  const confidential = catalog.find(({ name }) => name === "confidential client")!;
  expect(business.template_count).toBe(0);
  const conflict = await f.request(`/template-tags/${confidential.id}`, "PATCH", { name: " BUSINESS INVOICE " });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: { code: "tag_name_conflict" } });
  expect(await (await f.request(`/template-tags/${confidential.id}`, "PATCH", { name: " Accounts   Payable " })).json()).toEqual({ id: confidential.id, name: "accounts payable", template_count: 1 });
  expect(await (await f.request(`/templates/${second}`)).json()).toMatchObject({ tags: ["accounts payable"], current_version: 1 });
  expect((await f.request(`/template-tags/${confidential.id}`, "DELETE")).status).toBe(204);
  expect(await (await f.request(`/templates/${second}`)).json()).toMatchObject({ tags: [], current_version: 1 });
  expect((await f.request(`/templates/${first}`, "PATCH", { tags: ["business invoice"] })).status).toBe(200);
  expect((await f.request(`/templates/${first}`, "DELETE")).status).toBe(204);
  expect(await f.tags()).toEqual([{ ...business, template_count: 0 }]);
  const persisted = new Database(join(f.stateDirectory, "data", "workspaces", `${f.workspaceId}.sqlite`), { readonly: true });
  try { expect(persisted.query("SELECT * FROM template_tag_assignments").all()).toEqual([]); } finally { persisted.close(); }
  expect(JSON.stringify(f.analytics)).not.toContain("confidential");
  expect(JSON.stringify(f.analytics)).not.toContain("business invoice");
});

test("tag mutations enforce template access, Workspace isolation, and validation without creating vocabulary", async () => {
  const f = await fixture();
  const templateId = await f.create(["private"]);
  const tag = (await f.tags())[0]!;
  expect((await f.request("/template-tags", "GET", undefined, {})).status).toBe(401);
  expect((await f.request("/template-tags", "GET", undefined, f.strangerHeaders)).status).toBe(403);
  expect((await f.request("/template-tags", "GET", undefined, f.memberHeaders)).status).toBe(200);
  expect((await f.request(`/template-tags/${tag.id}`, "PATCH", { name: "member edit" }, f.memberHeaders)).status).toBe(200);
  expect((await f.request(`/template-tags/${tag.id}`, "PATCH", { name: "foreign" }, f.otherKeyHeaders)).status).toBe(404);
  expect((await f.request(`/template-tags/${tag.id}`, "DELETE", undefined, f.otherKeyHeaders)).status).toBe(404);
  expect(await (await f.request("/template-tags", "GET", undefined, f.otherKeyHeaders)).json()).toEqual({ tags: [] });
  for (const tags of [null, "tag", [""], [1], ["x\ny"], Array(51).fill("x")]) {
    const response = await f.request(`/templates/${templateId}`, "PATCH", { name: "Should not save", tags });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_tags" } });
  }
  expect((await f.request(`/templates/missing`, "PATCH", { tags: ["never created"] })).status).toBe(404);
  expect((await f.request(`/template-tags/${tag.id}`, "PATCH", { name: " " })).status).toBe(400);
  expect((await f.request(`/template-tags/${tag.id}`, "PATCH", null)).status).toBe(400);
  expect(await (await f.request(`/templates/${templateId}`)).json()).toMatchObject({ name: "Invoice", tags: ["member edit"], current_version: 1 });
  expect((await f.tags()).map(({ name }) => name)).toEqual(["member edit"]);
});

test("existing product databases migrate idempotently, and failed saves roll back tags with templates", () => {
  const stateDirectory = temporaryDirectory();
  const input = { templateId: "legacy", name: "Legacy", description: null, fields: [{ id: "total", name: "Total", description: "Total", data_type: "number" as const }], createdAt: now };
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "old" });
  store.createTemplate(input);
  store.close();
  const database = new Database(join(stateDirectory, "data", "workspaces", "old.sqlite"));
  database.exec("DROP TABLE template_tag_assignments; DROP TABLE template_tags; DELETE FROM product_schema_version WHERE version = 10");
  database.close();
  for (let iteration = 0; iteration < 2; iteration += 1) {
    store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: "old" });
    try {
      expect(store.getTemplate("legacy")).toMatchObject({ tags: [], current_version: 1 });
      expect(() => store.createTemplate({ ...input, templateId: "bad", tags: ["valid", ""] })).toThrow();
      expect(store.getTemplate("bad")).toBeNull();
      expect(() => store.updateTemplate({ templateId: "legacy", name: "Bad", tags: ["valid", ""], updatedAt: now })).toThrow();
      expect(store.getTemplate("legacy")).toMatchObject({ name: "Legacy", tags: [], current_version: 1 });
      expect(store.listTemplateTags()).toEqual([]);
    } finally { store.close(); }
  }
});

for (const streamed of [true, false]) {
  test(`extraction ${streamed ? "streamed" : "FormData"} accepts and discards valid request tags, validates malformed/duplicate parts`, async () => {
    const f = await fixture(streamed);
    const templateId = await f.create(["existing"]);
    const submit = (values: Array<string | File>, includeTemplate = true) => {
      const form = new FormData();
      if (includeTemplate) form.append("template_id", templateId);
      form.append("document", new File([new Uint8Array([137, 80, 78, 71])], "invoice.png", { type: "image/png" }));
      form.append("options", JSON.stringify({ include_confidence: true }));
      for (const value of values) form.append("template_tags", value);
      return f.request("/extract", "POST", form);
    };
    for (const value of [undefined, "[]", '["unknown future tag", " UNKNOWN  FUTURE TAG "]']) {
      const response = await submit(value === undefined ? [] : [value]);
      expect(response.status).toBe(202);
      const queued = await response.json() as { job_id: string };
      const job = await (await f.request(`/jobs/${queued.job_id}`)).json() as Record<string, unknown>;
      expect(job).toMatchObject({ template_id: templateId, template_version: 1 });
      expect(job).not.toHaveProperty("template_tags");
    }
    expect((await f.tags()).map(({ name }) => name)).toEqual(["existing"]);
    for (const value of ["", "not JSON", "null", '"tag"', '[" "]', "[1]", '["a\\nb"]', JSON.stringify(Array(51).fill("a"))]) {
      const response = await submit([value]);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_template_tags" } });
    }
    expect((await submit(["[]", "[]"])).status).toBe(400);
    expect((await submit([new File(["[]"], "tags.json", { type: "application/json" })])).status).toBe(400);
    expect((await submit(['["existing"]'], false)).status).toBe(400);
    if (streamed) expect(readdirSync(join(f.stateDirectory, "temporary", "submissions"))).toEqual([]);
    expect(JSON.stringify(f.analytics)).not.toContain("unknown future tag");
  });
}
