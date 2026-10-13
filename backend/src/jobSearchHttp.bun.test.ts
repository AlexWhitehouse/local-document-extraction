import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isJsonObject, isNumber, isString, parseJson, type JsonObject, type JsonValue } from "../../shared/json";
import type { CostCondition, DocumentSearchFilter, FieldCondition, SearchOperator } from "../../shared/documentSearch";
import { readModelCallUsage } from "./consumer/modelUsage";
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

const COST_FIELDS: FieldDefinition[] = [
  { id: "total", name: "Total", description: "Total", data_type: "number" },
  { id: "vendor", name: "Vendor", description: "Vendor", data_type: "string" },
];

type Stage = "split" | "auto_template" | "extraction";

/** Records one finished model call, as the gateway observer does. A null amount is an unreported cost. */
function charge(store: LocalWorkspaceProductStore, ownerId: string, amount: number | null, stage: Stage = "extraction") {
  const call = store.modelCallObserver({
    ownerId,
    stage,
    model: "test-model",
    configurationRevision: 1,
    now: () => "2026-04-08T00:00:00.000Z",
  });

  call.finished(call.started(), readModelCallUsage({ usage: { cost: amount } }));
}

/**
 * Totals, newest first: child_two 0.02 (packet share), child_one 0.061 (0.06 share + 0.001), c_failed 0.1,
 * c_unknown 0 (unreported only), c_partial 0.04 (+ an unreported call), c_mid 0.05, c_low 0.005 + 0.025, c_none 0.
 */
function seedCostWorkspace(store: LocalWorkspaceProductStore): string[] {
  store.createTemplate({ templateId: "tpl_cost", name: "Invoice", description: null, fields: COST_FIELDS, createdAt: "2026-04-01T00:00:00.000Z" });

  const completed = (jobId: string, day: string, total: number, vendor: string) =>
    seed(store, {
      jobId,
      templateId: "tpl_cost",
      version: 1,
      createdAt: `2026-04-${day}T09:00:00.000Z`,
      results: [
        ["total", "ok", total, String(total)],
        ["vendor", "ok", vendor, vendor],
      ],
    });

  completed("c_none", "01", 10, "Acme");
  completed("c_low", "02", 100, "Acme");
  // Added in stage order, 0.005 + 0.025 is 0.030000000000000002.
  charge(store, "c_low", 0.005, "auto_template");
  charge(store, "c_low", 0.025);
  completed("c_mid", "03", 200, "Beta");
  charge(store, "c_mid", 0.05);
  completed("c_partial", "04", 300, "Acme");
  charge(store, "c_partial", 0.04);
  charge(store, "c_partial", null);
  completed("c_unknown", "05", 400, "Beta");
  charge(store, "c_unknown", null);
  seed(store, { jobId: "c_failed", templateId: "tpl_cost", version: 1, createdAt: "2026-04-06T09:00:00.000Z", fail: true });
  charge(store, "c_failed", 0.1);

  store.createDocumentPacket({
    packetId: "packet",
    templateId: "tpl_cost",
    templateVersion: 1,
    templateTags: [],
    selectedPages: [1, 2, 3, 4],
    processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: true },
    sourceFileKey: "packet/source.pdf",
    sourceMimeType: "application/pdf",
    sourceName: "packet.pdf",
    sourceFilePageCount: 4,
    submittedAt: "2026-04-07T08:00:00.000Z",
  });
  store.claimPacketRound({ packetId: "packet", updatedAt: "2026-04-07T08:00:00.000Z", configurationSnapshot: {} });
  charge(store, "packet", 0.08, "split");

  const planned = store.acceptDocumentPacketPlan({
    packetId: "packet",
    revision: 1,
    expectedRound: 1,
    groups: [[1, 2, 3], [4]],
    exclusions: [],
    updatedAt: "2026-04-07T08:00:00.000Z",
  })!;

  const children = planned.child_slots.map((slot, index) => {
    store.materializePacketChild({
      packetId: "packet",
      jobId: slot.job_id,
      sourceFileKey: `${slot.job_id}/source.pdf`,
      sourceFilePageCount: slot.pages.length,
      updatedAt: `2026-04-07T1${index}:00:00.000Z`,
    });

    return slot.job_id;
  });

  charge(store, children[0]!, 0.001);

  return children;
}

/** A Workspace seeded like the primary one, for a test that changes its documents. */
type PrimaryWorkspaceCopy = {
  workspaceId: string;
  apiKey: string;
  liveMessages: string[];
};

type Fixture = {
  stateDirectory: string;
  database: Database;
  application: (request: Request) => Response | Promise<Response>;
  apiKey: string;
  ownerCookie: string;
  strangerCookie: string;
  adminCookie: string;
  memberCookie: string;
  workspaceId: string;
  otherWorkspaceId: string;
  costWorkspaceId: string;
  costApiKey: string;
  /** The packet's two documents: three pages, then one. */
  packetChildren: string[];
  /** Jobs scheduled by the current test. Emptied before each test. */
  scheduled: LocalQueuedExtractionJob[];
  /** Tests that retry or delete documents use their own copy, so the shared primary Workspace never changes. */
  copyPrimaryWorkspace: () => PrimaryWorkspaceCopy;
};

const fixture: Fixture = {
  stateDirectory: "",
  database: new Database(":memory:"),
  application: () => new Response(null, { status: 503 }),
  apiKey: "",
  ownerCookie: "",
  strangerCookie: "",
  adminCookie: "",
  memberCookie: "",
  workspaceId: "",
  otherWorkspaceId: "",
  costWorkspaceId: "",
  costApiKey: "",
  packetChildren: [],
  scheduled: [],
  copyPrimaryWorkspace: () => {
    throw new Error("The fixture is not ready.");
  },
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

  // A workspace with recorded costs, where Ada is the owner, Lin an admin and Grace a member.
  // Grace stays a stranger to the primary workspace. Sign-ins are rate limited, so no more users are added.
  fixture.costWorkspaceId = workspaceControl.createWorkspace({ userId: owner.session.id, name: "Costs" }).workspace_id;
  fixture.costApiKey = workspaceControl.rotateApiKey({ workspaceId: fixture.costWorkspaceId, userId: owner.session.id }).api_key;
  const admin = await createSignedInUser({ application, auth, email: "lin@example.com", name: "Lin", verificationLinks });

  for (const [user, email, role] of [
    [admin, "lin@example.com", "admin"],
    [stranger, "grace@example.com", "member"],
  ] as const) {
    const invitation = workspaceControl.createInvitation({ workspaceId: fixture.costWorkspaceId, inviterUserId: owner.session.id, email, role });

    workspaceControl.acceptInvitation({ invitationId: invitation.id, userId: user.session.id, userEmail: email });
  }

  fixture.adminCookie = admin.cookie;
  fixture.memberCookie = stranger.cookie;

  const costStore = createLocalWorkspaceProductStore({ stateDirectory: fixture.stateDirectory, workspaceId: fixture.costWorkspaceId });

  try {
    fixture.packetChildren = seedCostWorkspace(costStore);
  } finally {
    costStore.close();
  }

  const populate = (workspaceId: string, seedWorkspace: (store: LocalWorkspaceProductStore) => void) => {
    const store = createLocalWorkspaceProductStore({ stateDirectory: fixture.stateDirectory, workspaceId });

    try {
      seedWorkspace(store);
    } finally {
      store.close();
    }
  };

  populate(fixture.workspaceId, seedPrimaryWorkspace);
  populate(fixture.otherWorkspaceId, seedOtherWorkspace);

  fixture.copyPrimaryWorkspace = () => {
    const workspaceId = workspaceControl.createWorkspace({ userId: owner.session.id, name: "Primary copy" }).workspace_id;
    const liveMessages: string[] = [];

    populate(workspaceId, seedPrimaryWorkspace);
    liveUpdateHub.subscribe({
      workspaceId,
      socket: {
        data: { workspaceId, isAuthorized: () => true },
        send: (message) => {
          liveMessages.push(message);

          return message.length;
        },
      },
    });

    return { workspaceId, apiKey: workspaceControl.rotateApiKey({ workspaceId, userId: owner.session.id }).api_key, liveMessages };
  };
});

beforeEach(() => {
  fixture.scheduled.splice(0);
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

describe("searching by processing cost", () => {
  const owner = (): Credentials => ({ cookie: fixture.ownerCookie, workspaceId: fixture.costWorkspaceId });
  const admin = (): Credentials => ({ cookie: fixture.adminCookie, workspaceId: fixture.costWorkspaceId });
  const member = (): Credentials => ({ cookie: fixture.memberCookie, workspaceId: fixture.costWorkspaceId });
  const costKey = (): Credentials => ({ apiKey: fixture.costApiKey });

  const cost = (op: CostCondition["op"], value: number, value2?: number): CostCondition =>
    value2 === undefined ? { op, value } : { op, value, value2 };

  const byCost = (filter: DocumentSearchFilter) => found(filter, owner());

  const children = () => {
    const [three, one] = fixture.packetChildren;

    return { three: three!, one: one! };
  };

  test("comparisons are on the total reported cost, with exact boundaries", async () => {
    const { three, one } = children();

    expect(await byCost({ cost: cost("gt", 0.03) })).toEqual([three, "c_failed", "c_partial", "c_mid"]);
    // c_low's 0.005 + 0.025 is 0.030000000000000002 in floating point; it still equals $0.03.
    expect(await byCost({ cost: cost("gte", 0.03) })).toEqual([three, "c_failed", "c_partial", "c_mid", "c_low"]);
    expect(await byCost({ cost: cost("eq", 0.03) })).toEqual(["c_low"]);
    expect(await byCost({ cost: cost("lt", 0.03) })).toEqual([one, "c_unknown", "c_none"]);
    expect(await byCost({ cost: cost("lte", 0.02) })).toEqual([one, "c_unknown", "c_none"]);
    expect(await byCost({ cost: cost("lt", 0.02) })).toEqual(["c_unknown", "c_none"]);
    expect(await byCost({ cost: cost("between", 0.02, 0.04) })).toEqual([one, "c_partial", "c_low"]);
    expect(await byCost({ cost: cost("between", 0.05, 0.05) })).toEqual(["c_mid"]);
    expect(await byCost({ cost: cost("gt", 1) })).toEqual([]);
  });

  test("a packet document counts its page share of the split; unreported calls add nothing", async () => {
    const { three, one } = children();

    // 0.08 split over four pages: three pages is 0.06, plus the document's own 0.001; one page is 0.02.
    expect(await byCost({ cost: cost("eq", 0.061) })).toEqual([three]);
    expect(await byCost({ cost: cost("eq", 0.02) })).toEqual([one]);
    expect(await byCost({ cost: cost("eq", 0.04) })).toEqual(["c_partial"]);
    expect(await byCost({ cost: cost("eq", 0) })).toEqual(["c_unknown", "c_none"]);
  });

  test("each result lists its cost as the document page shows it, and the search agrees with it", async () => {
    const { body } = await search({ filter: { cost: cost("gte", 0) } }, owner());
    const jobs = jsonArray(body.jobs).map((job) => jsonObject(job));
    const matches = Object.fromEntries(jobs.map((job) => [jsonText(job.job_id), jsonArray(job.matches)]));

    expect(jsonObject(jsonObject(jobs.find((job) => job.job_id === "c_low")!.costs).total).amount).toBe(0.030000000000000002);
    expect(matches.c_partial).toEqual([{ kind: "cost", amount: 0.04, currency: "USD", complete: false, display: "$0.0400+" }]);
    expect(matches.c_unknown).toEqual([{ kind: "cost", amount: null, currency: "USD", complete: false, display: null }]);
    expect(matches.c_none).toEqual([{ kind: "cost", amount: 0, currency: "USD", complete: true, display: "$0.00" }]);
    expect(matches[children().three]).toEqual([
      { kind: "cost", amount: expect.closeTo(0.061, 12), currency: "USD", complete: true, display: "$0.0610" },
    ]);

    // Every document's own total, rounded as the search rounds it, finds that document.
    for (const job of jobs) {
      const costs = jsonObject(jsonObject(job.costs).total);
      const amount = isNumber(costs.amount) ? costs.amount : 0;
      const same = await byCost({ cost: cost("eq", Number(amount.toFixed(10))) });

      expect(same).toContain(jsonText(job.job_id));
    }
  });

  test("combines with statuses, Templates, field conditions and plain words", async () => {
    const { three } = children();

    expect(await byCost({ statuses: ["completed"], cost: cost("gt", 0.03) })).toEqual(["c_partial", "c_mid"]);
    expect(await byCost({ statuses: ["failed"], cost: cost("gt", 0.03) })).toEqual(["c_failed"]);
    expect(await byCost({ template_ids: ["tpl_cost"], cost: cost("gt", 0.03) })).toEqual([three, "c_failed", "c_partial", "c_mid"]);
    expect(
      await byCost({ conditions: [condition("total", "gte", 200, undefined, "tpl_cost")], cost: cost("lt", 0.045) }),
    ).toEqual(["c_unknown", "c_partial"]);
    expect(await byCost({ text: "acme", cost: cost("gte", 0.03) })).toEqual(["c_partial", "c_low"]);

    const { body } = await search(
      { filter: { conditions: [condition("vendor", "is", "beta", undefined, "tpl_cost")], cost: cost("gt", 0) } },
      owner(),
    );

    expect(jsonArray(body.jobs).map((job) => jsonObject(job).matches)).toEqual([
      [
        { template_id: "tpl_cost", field_id: "vendor", field_name: "Vendor", type: "text", value_state: "value", display: "Beta" },
        { kind: "cost", amount: 0.05, currency: "USD", complete: true, display: "$0.0500" },
      ],
    ]);
  });

  test("pages through cost results, with cursors bound to the cost condition", async () => {
    const filter = { cost: cost("gte", 0.02) };
    const first = await search({ filter, limit: 2 }, owner());

    expect(first.body).toMatchObject({ total: 6, total_capped: false, has_more: true });
    const second = await search({ filter, limit: 2, cursor: first.body.next_cursor ?? null }, owner());
    const third = await search({ filter, limit: 2, cursor: second.body.next_cursor ?? null }, owner());

    expect([first, second, third].flatMap((page) => jsonArray(page.body.jobs).map((job) => jsonObject(job).job_id))).toEqual(
      await byCost(filter),
    );
    expect(third.body).toMatchObject({ has_more: false, next_cursor: null });

    const ids = await search({ filter, ids_only: true, limit: 500 }, owner());

    expect(ids.body.job_ids).toEqual(await byCost(filter));

    const rebound = await search({ filter: { cost: cost("gte", 0.03) }, limit: 2, cursor: first.body.next_cursor ?? null }, owner());
    const unbound = await search({ filter: {}, limit: 2, cursor: first.body.next_cursor ?? null }, owner());

    expect([errorCode(rebound.body), errorCode(unbound.body)]).toEqual(["invalid_cursor", "invalid_cursor"]);
  });

  test("only callers who can read the Costs page may search by cost", async () => {
    const overview = (credentials: Credentials) =>
      fixture.application(
        new Request(`${BASE}/v1/workspaces/${fixture.costWorkspaceId}/costs/overview?start=2026-04-01&end=2026-04-09&unit=day`, {
          headers: headersFor(credentials),
        }),
      );

    for (const credentials of [owner(), admin()]) {
      expect((await overview(credentials)).status).toBe(200);
      expect((await search({ filter: { cost: cost("gt", 0.03) } }, credentials)).status).toBe(200);
    }

    for (const credentials of [member(), costKey()]) {
      expect((await overview(credentials)).status).not.toBe(200);
      const refused = await search({ filter: { cost: cost("gt", 0.03) } }, credentials);

      expect({ status: refused.status, error: refused.body.error, cacheControl: refused.cacheControl }).toEqual({
        status: 403,
        error: { code: "forbidden", message: "Only workspace owners and admins can search by cost." },
        cacheControl: "private, no-store",
      });
      // Everything else stays available to them.
      expect(await found({ statuses: ["failed"] }, credentials)).toEqual(["c_failed"]);
    }

    // A malformed cost is a 400 for everyone.
    for (const credentials of [owner(), member()]) {
      const malformed = await search({ filter: { cost: { op: "gt", value: -1 } } }, credentials);

      expect([malformed.status, errorCode(malformed.body)]).toEqual([400, "invalid_search_filter"]);
    }
  });

  test("the catalogue says whether the caller may search by cost", async () => {
    const capability = async (credentials: Credentials) =>
      (await readObjectResponse(await call("/search/catalog", undefined, credentials))).capabilities;

    expect(await capability(owner())).toEqual({ cost: true });
    expect(await capability(admin())).toEqual({ cost: true });
    expect(await capability(member())).toEqual({ cost: false });
    expect(await capability(costKey())).toEqual({ cost: false });
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
    const { workspaceId } = fixture.copyPrimaryWorkspace();
    const response = await call("/jobs/retry", { job_ids: ["job_f"] }, { cookie: fixture.ownerCookie, workspaceId, origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect(fixture.scheduled).toEqual([]);
  });

  test("requeues failed jobs on the current version, schedules and publishes them, and skips the rest", async () => {
    const { workspaceId, apiKey, liveMessages } = fixture.copyPrimaryWorkspace();

    const response = await call(
      "/jobs/retry",
      { job_ids: ["job_f", "job_g", "job_b", "job_missing", "job_z"] },
      { cookie: fixture.ownerCookie, workspaceId },
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
      expect.objectContaining({ job_id: "job_f", workspace_id: workspaceId, template_id: "tpl_inv", template_version: 2, attempt: 1 }),
    ]);
    expect(liveMessages.flatMap((message) => jsonArray(jsonObject(parseJson(message)).events))).toContainEqual(
      expect.objectContaining({ type: "extraction_job_lifecycle", job: expect.objectContaining({ job_id: "job_f", status: "queued" }) }),
    );
    expect(await found({ statuses: ["queued"] }, { apiKey })).toEqual(["job_f"]);
    expect((await call("/jobs/retry", { job_ids: [] }, { apiKey })).status).toBe(400);
  });

  test("deleting a document removes it from field searches", async () => {
    const { apiKey } = fixture.copyPrimaryWorkspace();

    expect(await found({ conditions: [condition("invoice_number", "is", "hnh_200")] }, { apiKey })).toEqual(["job_b"]);

    const deleted = await fixture.application(new Request(`${BASE}/v1/jobs/job_b`, { method: "DELETE", headers: headersFor({ apiKey }) }));

    expect(deleted.status).toBe(200);
    expect(await found({ conditions: [condition("invoice_number", "is", "hnh_200")] }, { apiKey })).toEqual([]);
    expect(await found({ text: "quoted" }, { apiKey })).toEqual([]);
  });
});
