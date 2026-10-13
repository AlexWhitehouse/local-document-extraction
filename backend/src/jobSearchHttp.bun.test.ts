import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isJsonObject, isString, parseJson, type JsonObject, type JsonValue } from "../../shared/json";
import type { DocumentSearchFilter, FieldCondition, SearchOperator } from "../../shared/documentSearch";
import type { FieldDefinition } from "./lib/types";
import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore, type LocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createSignedInUser } from "./testing/localAuthTestClient";
import { jsonArray, jsonObject, jsonText } from "./testing/jsonFixture";
import { readObjectResponse } from "./testing/responseFixture";

const BASE = "http://127.0.0.1:8787";

const INVOICE_V1: FieldDefinition[] = [
  { id: "invoice_number", name: "Invoice number", description: "Number", data_type: "string" },
  { id: "total", name: "Total", description: "Total", data_type: "string" },
  { id: "issued", name: "Issued", description: "Issued", data_type: "date" },
  { id: "paid", name: "Paid", description: "Paid", data_type: "boolean" },
  { id: "notes", name: "Notes", description: "Notes", data_type: "string" },
  { id: "lines", name: "Lines", description: "Lines", data_type: "array<object>" },
];

// Version 2 changes Total to a number and adds a PO number.
const INVOICE_V2: FieldDefinition[] = [
  ...INVOICE_V1.map((field) => (field.id === "total" ? { ...field, data_type: "number" as const } : field)),
  { id: "po_number", name: "PO number", description: "PO", data_type: "string" },
];

const RECEIPT: FieldDefinition[] = [
  { id: "total", name: "Total", description: "Total", data_type: "number" },
  { id: "vendor", name: "Vendor", description: "Vendor", data_type: "string" },
];

type Status = "ok" | "not_found" | "invalid_type" | "unreadable" | "error";

type SeedJob = {
  jobId: string;
  templateId: string;
  version: number;
  createdAt: string;
  sourceName?: string;
  results?: Array<[fieldId: string, status: Status, answer: JsonValue, normalized: string | null]>;
  fail?: true;
};

function seed(store: LocalWorkspaceProductStore, job: SeedJob) {
  store.createQueuedExtractionJob({
    jobId: job.jobId,
    templateId: job.templateId,
    templateVersion: job.version,
    sourceFileKey: `jobs/${job.jobId}/source.pdf`,
    sourceMimeType: "application/pdf",
    sourceName: job.sourceName ?? `${job.jobId}.pdf`,
    sourceFilePageCount: 1,
    submittedAt: job.createdAt,
  });

  if (job.fail) {
    store.failQueuedExtractionJob({ jobId: job.jobId, failedAt: job.createdAt, errorCode: "test_failure", errorMessage: "Failed" });

    return;
  }

  store.claimExtractionJobForProcessing({ jobId: job.jobId, attempt: 1, claimedAt: job.createdAt });
  store.completeExtractionJob({
    jobId: job.jobId,
    attempt: 1,
    completedAt: job.createdAt,
    modelName: "test-model",
    route: "test-route",
    results: (job.results ?? []).map(([field_id, status, answer, normalized_value]) => ({
      field_id,
      status,
      answer,
      normalized_value,
      confidence: 1,
      evidence: null,
    })),
  });
}

function seedPrimaryWorkspace(store: LocalWorkspaceProductStore) {
  store.createTemplate({ templateId: "tpl_inv", name: "Invoice", description: null, fields: INVOICE_V1, createdAt: "2026-03-01T00:00:00.000Z" });
  store.createTemplate({ templateId: "tpl_rec", name: "Receipt", description: null, fields: RECEIPT, createdAt: "2026-03-01T00:00:00.000Z" });
  store.createTemplate({ templateId: "tpl_gone", name: "Gone", description: null, fields: RECEIPT, createdAt: "2026-03-01T00:00:00.000Z" });
  seed(store, {
    jobId: "job_a",
    templateId: "tpl_inv",
    version: 1,
    createdAt: "2026-03-01T09:00:00.000Z",
    results: [
      ["invoice_number", "ok", "HNH-100%", "HNH-100%"],
      ["total", "ok", "500", "500"],
    ],
  });
  store.updateTemplate({ templateId: "tpl_inv", fields: INVOICE_V2, updatedAt: "2026-03-01T10:00:00.000Z" });
  seed(store, {
    jobId: "job_b",
    templateId: "tpl_inv",
    version: 2,
    createdAt: "2026-03-02T09:00:00.000Z",
    sourceName: "march.pdf",
    results: [
      ["invoice_number", "ok", "hnh_200", "hnh_200"],
      ["total", "ok", 1200, "1200"],
      ["issued", "ok", "01/03/2026", "01/03/2026"],
      ["paid", "ok", true, "true"],
      ["notes", "ok", `It's "quoted" \\ back`, `It's "quoted" \\ back`],
      ["lines", "ok", [{ sku: "A", qty: 1 }], null],
      ["po_number", "ok", "PO-1", "PO-1"],
    ],
  });
  seed(store, {
    jobId: "job_c",
    templateId: "tpl_inv",
    version: 2,
    createdAt: "2026-03-03T09:00:00.000Z",
    results: [
      ["invoice_number", "ok", "XHNH-300", "XHNH-300"],
      ["total", "ok", 0, "0"],
      ["issued", "ok", "31/03/2026", "31/03/2026"],
      ["paid", "ok", false, "false"],
      ["notes", "ok", "", ""],
    ],
  });
  seed(store, {
    jobId: "job_d",
    templateId: "tpl_inv",
    version: 2,
    createdAt: "2026-03-04T09:00:00.000Z",
    results: [
      ["invoice_number", "not_found", null, null],
      ["total", "invalid_type", "lots", null],
      ["issued", "ok", "31/02/2026", "31/02/2026"],
      ["po_number", "not_found", null, null],
    ],
  });
  seed(store, {
    jobId: "job_e",
    templateId: "tpl_rec",
    version: 1,
    createdAt: "2026-03-05T09:00:00.000Z",
    sourceName: "+receipt.pdf",
    results: [
      ["total", "ok", 1200, "1200"],
      ["vendor", "ok", "=HYPERLINK(\"http://x\")", "=HYPERLINK(\"http://x\")"],
    ],
  });
  seed(store, { jobId: "job_f", templateId: "tpl_inv", version: 2, createdAt: "2026-03-06T09:00:00.000Z", fail: true });
  seed(store, { jobId: "job_g", templateId: "tpl_gone", version: 1, createdAt: "2026-03-07T09:00:00.000Z", fail: true });
  store.deleteTemplate({ templateId: "tpl_gone", deletedAt: "2026-03-08T00:00:00.000Z" });
}

function seedOtherWorkspace(store: LocalWorkspaceProductStore) {
  store.createTemplate({ templateId: "tpl_inv", name: "Invoice", description: null, fields: INVOICE_V1, createdAt: "2026-03-01T00:00:00.000Z" });
  seed(store, {
    jobId: "job_z",
    templateId: "tpl_inv",
    version: 1,
    createdAt: "2026-03-09T09:00:00.000Z",
    results: [["invoice_number", "ok", "HNH-999", "HNH-999"]],
  });
}

type Fixture = {
  stateDirectory: string;
  database: Database;
  application: (request: Request) => Response | Promise<Response>;
  apiKey: string;
  ownerCookie: string;
  strangerCookie: string;
  workspaceId: string;
  otherWorkspaceId: string;
  scheduled: LocalQueuedExtractionJob[];
  liveMessages: string[];
};

const fixture: Fixture = {
  stateDirectory: "",
  database: new Database(":memory:"),
  application: () => new Response(null, { status: 503 }),
  apiKey: "",
  ownerCookie: "",
  strangerCookie: "",
  workspaceId: "",
  otherWorkspaceId: "",
  scheduled: [],
  liveMessages: [],
};

beforeAll(async () => {
  fixture.stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-job-search-http-"));
  const verificationLinks: string[] = [];

  const auth = await createLocalAuth({
    requireEmailVerification: true,
    baseURL: BASE,
    database: fixture.database,
    mailSink: {
      capture: async (message) => {
        const link = message.text.match(/https?:\/\/\S+/)?.[0];

        if (link) verificationLinks.push(link);
      },
    },
    secret: "01234567890123456789012345678901",
  });

  const workspaceControl = createLocalWorkspaceControl(fixture.database);
  const liveUpdateHub = createLocalLiveUpdateHub();

  const application = createLocalApplication({
    auth,
    liveUpdateHub,
    stateDirectory: fixture.stateDirectory,
    workspaceControl,
    scheduleQueuedJob: (job) => {
      fixture.scheduled.push(job);
    },
  });

  fixture.application = application;
  const owner = await createSignedInUser({ application, auth, email: "ada@example.com", name: "Ada", verificationLinks });
  const stranger = await createSignedInUser({ application, auth, email: "grace@example.com", name: "Grace", verificationLinks });
  fixture.ownerCookie = owner.cookie;
  fixture.strangerCookie = stranger.cookie;
  fixture.workspaceId = workspaceControl.listAcceptedWorkspaces({ userId: owner.session.id, userName: owner.session.name })[0]!.id;
  fixture.otherWorkspaceId = workspaceControl.createWorkspace({ userId: owner.session.id, name: "Other" }).workspace_id;
  fixture.apiKey = workspaceControl.rotateApiKey({ workspaceId: fixture.workspaceId, userId: owner.session.id }).api_key;

  for (const [workspaceId, populate] of [
    [fixture.workspaceId, seedPrimaryWorkspace],
    [fixture.otherWorkspaceId, seedOtherWorkspace],
  ] as const) {
    const store = createLocalWorkspaceProductStore({ stateDirectory: fixture.stateDirectory, workspaceId });

    try {
      populate(store);
    } finally {
      store.close();
    }
  }

  liveUpdateHub.subscribe({
    workspaceId: fixture.workspaceId,
    socket: {
      data: { workspaceId: fixture.workspaceId, isAuthorized: () => true },
      send: (message) => {
        fixture.liveMessages.push(message);

        return message.length;
      },
    },
  });
});

afterAll(async () => {
  fixture.database.close();
  await rm(fixture.stateDirectory, { recursive: true, force: true });
});

type Credentials = { apiKey: string } | { cookie: string; workspaceId: string; origin?: string };

function headersFor(credentials: Credentials): Headers {
  const headers = new Headers({ "content-type": "application/json" });

  if ("apiKey" in credentials) {
    headers.set("authorization", `Bearer ${credentials.apiKey}`);

    return headers;
  }

  headers.set("cookie", credentials.cookie);
  headers.set("x-workspace-id", credentials.workspaceId);
  headers.set("origin", credentials.origin ?? BASE);

  return headers;
}

function call(path: string, body?: JsonValue, credentials: Credentials = { apiKey: fixture.apiKey }) {
  const init: RequestInit = {
    method: body === undefined ? "GET" : "POST",
    headers: headersFor(credentials),
  };

  if (body !== undefined) init.body = JSON.stringify(body);

  return fixture.application(new Request(`${BASE}/v1${path}`, init));
}

async function search(body: JsonObject, credentials?: Credentials) {
  const response = await call("/jobs/search", body, credentials);

  return { status: response.status, body: await readObjectResponse(response), cacheControl: response.headers.get("cache-control") };
}

async function found(filter: DocumentSearchFilter, credentials?: Credentials): Promise<string[]> {
  const { status, body } = await search({ filter }, credentials);

  expect({ status, error: body.error }).toEqual({ status: 200, error: undefined });

  return jsonArray(body.jobs).map((job) => jsonText(jsonObject(job).job_id));
}

function condition(
  field_id: string,
  op: SearchOperator,
  value?: string | number,
  value2?: string | number,
  template_id = "tpl_inv",
): FieldCondition {
  const built: FieldCondition = { template_id, field_id, op };

  if (value !== undefined) built.value = value;

  if (value2 !== undefined) built.value2 = value2;

  return built;
}

function errorCode(body: JsonObject): string | null {
  const error = body.error;

  return isJsonObject(error) && isString(error.code) ? error.code : null;
}

describe("GET /v1/search/catalog", () => {
  test("lists active Templates, current fields, known values and models without caching", async () => {
    const response = await call("/search/catalog");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const catalog = await readObjectResponse(response);

    expect(catalog).toMatchObject({
      models: ["test-model"],
      interpretation: { available: false, reason: "model_not_configured" },
    });
    const templates = jsonArray(catalog.templates).map((template) => jsonObject(template));

    expect(templates.map((template) => template.id).sort()).toEqual(["tpl_inv", "tpl_rec"]);
    expect(templates.find((template) => template.id === "tpl_inv")).toMatchObject({
      current_version: 2,
      fields: expect.arrayContaining([
        { field_id: "total", name: "Total", data_type: "number", type: "number" },
        { field_id: "lines", name: "Lines", data_type: "array<object>", type: null },
        expect.objectContaining({ field_id: "invoice_number", known_values: expect.arrayContaining(["HNH-100%", "hnh_200", "XHNH-300"]) }),
      ]),
    });
  });

  test("is scoped to the session's Workspace and refuses non-members", async () => {
    const other = await call("/search/catalog", undefined, { cookie: fixture.ownerCookie, workspaceId: fixture.otherWorkspaceId });

    expect(jsonArray((await readObjectResponse(other)).templates)).toHaveLength(1);
    expect((await call("/search/catalog", undefined, { cookie: fixture.strangerCookie, workspaceId: fixture.workspaceId })).status).toBe(403);
  });
});

describe("POST /v1/jobs/search", () => {
  test("plain words match names, IDs and text values literally, and report the matching field", async () => {
    expect(await found({ text: "hnh" })).toEqual(["job_c", "job_b", "job_a"]);
    expect(await found({ text: "100%" })).toEqual(["job_a"]);
    // One- and two-character terms match only the document name and job ID, literally.
    expect(await found({ text: "_2" })).toEqual([]);
    expect(await found({ text: "_b" })).toEqual(["job_b"]);
    expect(await found({ text: "ma" })).toEqual(["job_b"]);
    expect(await found({ text: "MARCH" })).toEqual(["job_b"]);
    expect(await found({ text: "job_e" })).toEqual(["job_e"]);

    const { body } = await search({ filter: { text: "quoted" } });

    expect(body.jobs).toEqual([
      expect.objectContaining({
        job_id: "job_b",
        template_name: "Invoice",
        status: "completed",
        matches: [{ template_id: "tpl_inv", field_id: "notes", field_name: "Notes", type: "text", value_state: "value", display: `It's "quoted" \\ back` }],
      }),
    ]);
  });

  test("text conditions are case-insensitive and treat %, _, \\ and quotes literally", async () => {
    expect(await found({ conditions: [condition("invoice_number", "contains", "%")] })).toEqual(["job_a"]);
    expect(await found({ conditions: [condition("invoice_number", "contains", "_")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("notes", "contains", "\\")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("notes", "contains", `"QUOTED"`)] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("notes", "starts_with", "it's")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("invoice_number", "starts_with", "hnh")] })).toEqual(["job_b", "job_a"]);
    expect(await found({ conditions: [condition("invoice_number", "ends_with", "300")] })).toEqual(["job_c"]);
    expect(await found({ conditions: [condition("invoice_number", "is", "HNH_200")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("invoice_number", "is_not", "hnh_200")] })).toEqual(["job_c", "job_a"]);
  });

  test("number and date comparisons are inclusive and never match missing or invalid values", async () => {
    expect(await found({ conditions: [condition("total", "gte", 1200)] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("total", "eq", 0)] })).toEqual(["job_c"]);
    expect(await found({ conditions: [condition("total", "lte", 0)] })).toEqual(["job_c"]);
    expect(await found({ conditions: [condition("total", "between", 0, 1200)] })).toEqual(["job_c", "job_b"]);
    expect(await found({ conditions: [condition("total", "gt", "£1,000")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("total", "invalid")] })).toEqual(["job_d"]);
    expect(await found({ conditions: [condition("issued", "between", "2026-03-01", "2026-03-01")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("issued", "lte", "2026-03-31")] })).toEqual(["job_c", "job_b"]);
    expect(await found({ conditions: [condition("issued", "lt", "2026-03-31")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("issued", "invalid")] })).toEqual(["job_d"]);
    expect(await found({ conditions: [condition("paid", "is_false")] })).toEqual(["job_c"]);
    expect(await found({ conditions: [condition("paid", "is_true")] })).toEqual(["job_b"]);
    expect(await found({ conditions: [condition("notes", "empty")] })).toEqual(["job_c"]);

    const impossible = await search({ filter: { conditions: [condition("issued", "gte", "2026-02-30")] } });

    expect({ status: impossible.status, code: errorCode(impossible.body) }).toEqual({ status: 400, code: "invalid_search_filter" });
  });

  test("conditions only match stored values of the field's current type on the named Template", async () => {
    // job_a stored Total as text under version 1; job_e's Receipt Total shares the field ID.
    expect(await found({ conditions: [condition("total", "has_value")] })).toEqual(["job_c", "job_b"]);
    expect(await found({ conditions: [condition("total", "not_found")] })).toEqual([]);
    expect(await found({ conditions: [condition("total", "gte", 1000, undefined, "tpl_rec")] })).toEqual(["job_e"]);
    // Not found includes completed jobs with no stored value, such as one processed before the field existed.
    expect(await found({ conditions: [condition("po_number", "not_found")] })).toEqual(["job_d", "job_c", "job_a"]);

    const { body } = await search({ filter: { conditions: [condition("total", "lte", 1200), condition("issued", "has_value")] } });

    expect(jsonArray(body.jobs).map((job) => jsonObject(job).matches)).toEqual([
      [
        { template_id: "tpl_inv", field_id: "total", field_name: "Total", type: "number", value_state: "value", display: "0" },
        { template_id: "tpl_inv", field_id: "issued", field_name: "Issued", type: "date", value_state: "value", display: "2026-03-31" },
      ],
      [
        { template_id: "tpl_inv", field_id: "total", field_name: "Total", type: "number", value_state: "value", display: "1200" },
        { template_id: "tpl_inv", field_id: "issued", field_name: "Issued", type: "date", value_state: "value", display: "2026-03-01" },
      ],
    ]);
  });

  test("metadata and field filters combine with AND", async () => {
    expect(
      await found({
        statuses: ["completed"],
        template_ids: ["tpl_inv"],
        uploaded_from: "2026-03-02",
        uploaded_to: "2026-03-03",
        model: "test-model",
        conditions: [condition("invoice_number", "contains", "hnh")],
      }),
    ).toEqual(["job_c", "job_b"]);
    expect(await found({ statuses: ["failed"] })).toEqual(["job_g", "job_f"]);
    expect(await found({ statuses: ["failed"], template_ids: ["tpl_inv"] })).toEqual(["job_f"]);
    expect(await found({ text: "hnh", conditions: [condition("total", "eq", 0)] })).toEqual(["job_c"]);
    expect(await found({ conditions: [condition("total", "eq", 0), condition("total", "gte", 1000, undefined, "tpl_rec")] })).toEqual([]);
  });

  test("unknown or deleted Templates and fields are rejected as invalid filters", async () => {
    for (const filter of [
      { conditions: [condition("missing_field", "has_value")] },
      { conditions: [condition("total", "has_value", undefined, undefined, "tpl_gone")] },
      { conditions: [condition("lines", "has_value")] },
      { conditions: [condition("total", "contains", "1")] },
      { template_ids: ["tpl_gone"] },
      { statuses: ["deleted"] },
      { unexpected: true },
    ]) {
      const { status, body, cacheControl } = await search({ filter });

      expect({ status, code: errorCode(body), cacheControl }).toEqual({ status: 400, code: "invalid_search_filter", cacheControl: "private, no-store" });
    }

    expect((await search({ filter: {}, limit: 101 })).status).toBe(400);
    expect((await search({ filter: {}, ids_only: true, limit: 500 })).status).toBe(200);
  });

  test("pages are stable, keyed by upload time, and cursors are bound to their filter", async () => {
    const filter = { template_ids: ["tpl_inv"] };
    const first = await search({ filter, limit: 2 });

    expect(first.body).toMatchObject({ total: 5, total_capped: false, has_more: true });
    expect(jsonArray(first.body.jobs).map((job) => jsonObject(job).job_id)).toEqual(["job_f", "job_d"]);
    expect(await search({ filter, limit: 2 })).toEqual(first);

    const second = await search({ filter, limit: 2, cursor: first.body.next_cursor ?? null });
    const third = await search({ filter, limit: 2, cursor: second.body.next_cursor ?? null });

    expect(jsonArray(second.body.jobs).map((job) => jsonObject(job).job_id)).toEqual(["job_c", "job_b"]);
    expect(third.body).toMatchObject({ jobs: [expect.objectContaining({ job_id: "job_a" })], has_more: false, next_cursor: null });

    const rebound = await search({ filter: { template_ids: ["tpl_rec"] }, limit: 2, cursor: first.body.next_cursor ?? null });
    const tampered = await search({ filter, limit: 2, cursor: `${jsonText(first.body.next_cursor)}x` });

    expect([errorCode(rebound.body), errorCode(tampered.body)]).toEqual(["invalid_cursor", "invalid_cursor"]);

    const ids = await search({ filter, ids_only: true, limit: 3 });

    expect(ids.body).toEqual({
      job_ids: ["job_f", "job_d", "job_c"],
      statuses: { job_f: "failed", job_d: "completed", job_c: "completed" },
      total: 5,
      total_capped: false,
      next_cursor: expect.any(String),
      has_more: true,
    });
  });

  test("never returns another Workspace's jobs, for API keys or sessions", async () => {
    expect(await found({ text: "hnh-999" })).toEqual([]);
    expect(await found({ text: "hnh" }, { cookie: fixture.ownerCookie, workspaceId: fixture.workspaceId })).toEqual(["job_c", "job_b", "job_a"]);
    expect(await found({ text: "hnh" }, { cookie: fixture.ownerCookie, workspaceId: fixture.otherWorkspaceId })).toEqual(["job_z"]);
    expect((await search({ filter: { text: "hnh" } }, { cookie: fixture.strangerCookie, workspaceId: fixture.workspaceId })).status).toBe(403);
  });
});

describe("POST /v1/jobs/export formats", () => {
  async function exported(format: string) {
    const response = await call("/jobs/export", { job_ids: ["job_b", "job_e", "job_f", "job_missing"], format });

    return { response, text: await response.text() };
  }

  test("CSV has one row per document, Template-prefixed headings, JSON tables and neutralised formulas", async () => {
    const { response, text } = await exported("csv");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/\.csv"$/);
    expect([response.headers.get("x-exported-job-count"), response.headers.get("x-skipped-job-count")]).toEqual(["3", "1"]);

    const lines = text.replace(/^\uFEFF/, "").trimEnd().split("\r\n");

    expect(lines[0]).toBe(
      "Document,Template,Version,Status,Uploaded,Invoice — Invoice number,Invoice — Total,Invoice — Issued,Invoice — Paid,Invoice — Notes,Invoice — Lines,Invoice — PO number,Receipt — Total,Receipt — Vendor",
    );
    expect(lines.slice(1)).toEqual([
      "job_f.pdf,Invoice,2,failed,2026-03-06T09:00:00.000Z,,,,,,,,,",
      `'+receipt.pdf,Receipt,1,completed,2026-03-05T09:00:00.000Z,,,,,,,,1200,"'=HYPERLINK(""http://x"")"`,
      `march.pdf,Invoice,2,completed,2026-03-02T09:00:00.000Z,hnh_200,1200,2026-03-01,true,"It's ""quoted"" \\ back","[{""sku"":""A"",""qty"":1}]",PO-1,,`,
    ]);
  });

  test("JSON lists each document's results by field ID", async () => {
    const { response, text } = await exported("json");

    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = jsonObject(parseJson(text));

    expect(jsonArray(body.documents).map((document) => jsonObject(document).job_id)).toEqual(["job_f", "job_e", "job_b"]);
    expect(jsonArray(body.documents)[1]).toEqual({
      job_id: "job_e",
      source_name: "+receipt.pdf",
      template_id: "tpl_rec",
      template_name: "Receipt",
      template_version: 1,
      status: "completed",
      created_at: "2026-03-05T09:00:00.000Z",
      results: {
        total: { name: "Total", data_type: "number", status: "ok", answer: 1200 },
        vendor: { name: "Vendor", data_type: "string", status: "ok", answer: "=HYPERLINK(\"http://x\")" },
      },
    });
    expect(body.generated_at).toEqual(expect.any(String));
  });

  test("the workbook stays the default and unknown formats are rejected", async () => {
    const workbook = await call("/jobs/export", { job_ids: ["job_b"] });

    expect(workbook.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(workbook.headers.get("content-disposition")).toMatch(/\.xlsx"$/);
    expect((await exported("pdf")).response.status).toBe(400);
  });
});

describe("POST /v1/jobs/retry", () => {
  test("requires a trusted origin for session requests", async () => {
    const response = await call("/jobs/retry", { job_ids: ["job_f"] }, { cookie: fixture.ownerCookie, workspaceId: fixture.workspaceId, origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(fixture.scheduled).toEqual([]);
  });

  test("requeues failed jobs on the current version, schedules and publishes them, and skips the rest", async () => {
    const response = await call(
      "/jobs/retry",
      { job_ids: ["job_f", "job_g", "job_b", "job_missing", "job_z"] },
      { cookie: fixture.ownerCookie, workspaceId: fixture.workspaceId },
    );

    expect(await readObjectResponse(response)).toEqual({
      retried: ["job_f"],
      skipped: [
        { job_id: "job_g", reason: "template_unavailable" },
        { job_id: "job_b", reason: "not_failed" },
        { job_id: "job_missing", reason: "not_found" },
        { job_id: "job_z", reason: "not_found" },
      ],
    });
    expect(fixture.scheduled).toEqual([
      expect.objectContaining({ job_id: "job_f", workspace_id: fixture.workspaceId, template_id: "tpl_inv", template_version: 2, attempt: 1 }),
    ]);
    expect(fixture.liveMessages.flatMap((message) => jsonArray(jsonObject(parseJson(message)).events))).toContainEqual(
      expect.objectContaining({ type: "extraction_job_lifecycle", job: expect.objectContaining({ job_id: "job_f", status: "queued" }) }),
    );
    expect(await found({ statuses: ["queued"] })).toEqual(["job_f"]);
    expect((await call("/jobs/retry", { job_ids: [] })).status).toBe(400);
  });

  test("deleting a document removes it from field searches", async () => {
    const deleted = await fixture.application(
      new Request(`${BASE}/v1/jobs/job_b`, { method: "DELETE", headers: headersFor({ apiKey: fixture.apiKey }) }),
    );

    expect(deleted.status).toBe(200);
    expect(await found({ conditions: [condition("invoice_number", "is", "hnh_200")] })).toEqual([]);
    expect(await found({ text: "quoted" })).toEqual([]);
  });
});
