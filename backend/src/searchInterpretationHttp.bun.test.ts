import { textRequestBody } from "./testing/requestFixture";
import type { JsonObject, JsonValue } from "../../shared/json";
import { workspaceControlFixture, workspaceFixture } from "./testing/workspaceControlFixture";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApplication } from "./localApplication";
import type { LocalAuth } from "./localAuth";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { configureTestWorkspace } from "./testing/workspaceModelFixture";
import { getModelPreparationSnapshot } from "./consumer/modelGateway";
import { catalogueForPrompt, INTERPRETATION_LIMITS } from "./consumer/searchInterpretation";
import { parseCostRange } from "../../shared/workspaceCosts";
import { costAmount } from "../../shared/processingCosts";
import type { SearchCatalogTemplate } from "../../shared/documentSearch";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const interpretation = {
  action: "find_documents",
  args: {},
  filter: {
    uploaded_from: "2026-10-05",
    uploaded_to: "2026-10-11",
    conditions: [
      { template_id: "tpl_invoice", field_id: "invoice_number", op: "starts_with", value: "hnh" },
      { template_id: "tpl_invoice", field_id: "billing_address", op: "contains", value: "Leeds" },
    ],
  },
  unrecognised: [],
  notes: [{ kind: "matched", text: "“Leeds” matched Billing address." }],
};

const body = {
  text: "invoices starting hnh billed to Leeds last week",
  segments: [
    { type: "template", text: "invoices", start: 0, end: 8 },
    { type: "plain", text: "billed to Leeds" },
  ],
  today: "2026-10-13",
  time_zone: "Europe/London",
};

type Reply = { content: string; cost?: number; header?: string } | { status: number };

function fixture(options: { configured?: boolean; assistantModel?: string; timeout?: string } = {}) {
  const stateDirectory = mkdtempSync(join(tmpdir(), "search-interpretation-"));
  cleanups.push(() => rmSync(stateDirectory, { force: true, recursive: true }));

  if (options.configured !== false)
    for (const workspaceId of ["workspace_a", "workspace_b"])
      configureTestWorkspace({
        stateDirectory,
        workspaceId,
        modelName: "extraction-model",
        assistantModel: options.assistantModel
          ? { model_name: options.assistantModel, supports_pdf_input: false, supports_structured_output: false }
          : undefined,
      });

  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  const workspace = workspaceFixture({ id: "workspace_a", name: "A" });

  const workspaceControl = workspaceControlFixture({
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
      (userId === "member" && ["workspace_a", "workspace_b"].includes(workspaceId)) ||
      (userId === "a_only" && workspaceId === "workspace_a")
        ? workspaceFixture({ ...workspace, id: workspaceId, role: "member" })
        : userId === "owner" && workspaceId === "workspace_a"
          ? workspaceFixture({ ...workspace, id: workspaceId, role: "owner" })
          : null,
    authorizeApiKey: ({ apiKey }: { apiKey: string }) => (apiKey === "inbound" ? workspace : null),
  });

  const auth: LocalAuth = {
    handler: async () => new Response(null),
    getSession: async (request) => {
      const id = request.headers.get("cookie");

      return id ? { id, email: "test@example.com", name: "Test user" } : null;
    },
  };

  const application = createLocalApplication({
    stateDirectory,
    auth,
    workspaceControl,
    productStoreRegistry: registry,
    workspaceProductOperations: createLocalWorkspaceProductOperations(),
    modelGatewayRequestTimeoutMs: options.timeout,
  });

  const lease = (workspaceId: string) => {
    const acquired = registry.acquire({ workspaceId, mode: "create" })!;
    cleanups.push(acquired.release);

    return acquired.store;
  };

  const storeA = lease("workspace_a");
  const storeB = lease("workspace_b");
  storeA.createTemplate({
    templateId: "tpl_invoice",
    name: "Invoice",
    description: "",
    fields: [
      { id: "invoice_number", name: "Invoice number", description: "", data_type: "string" },
      { id: "billing_address", name: "Billing address", description: "", data_type: "string" },
      { id: "total", name: "Total", description: "", data_type: "number" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  storeB.createTemplate({
    templateId: "tpl_order",
    name: "Purchase order",
    description: "",
    fields: [{ id: "po_number", name: "PO number", description: "", data_type: "string" }],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  /** Replies in order; the last reply repeats. Each request body is recorded. */
  const mockGateway = (...replies: Reply[]) => {
    let index = 0;

    const mock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          const reply = replies[Math.min(index, replies.length - 1)];
          index += 1;

          if ("status" in reply) return new Response("upstream detail", { status: reply.status });

          const usage: JsonObject = { prompt_tokens: 100, completion_tokens: 20 };
          const headers = new Headers();

          if (reply.cost !== undefined) usage.cost = reply.cost;

          if (reply.header) headers.set("x-litellm-response-cost", reply.header);

          return Response.json(
            { id: `req_${index}`, choices: [{ message: { content: reply.content } }], usage },
            { headers },
          );
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );

    cleanups.push(() => mock.mockRestore());

    return {
      mock,
      requests: () => mock.mock.calls.map((call) => JSON.parse(textRequestBody(call[1]!.body))),
    };
  };

  const interpret = (payload = JSON.stringify(body), headers: Record<string, string> = {}, signal?: AbortSignal) =>
    application(
      new Request("http://localhost/v1/search/interpret", {
        method: "POST",
        body: payload,
        signal,
        headers: { cookie: "member", "x-workspace-id": "workspace_a", "content-type": "application/json", ...headers },
      }),
    );

  return { application, interpret, mockGateway, storeA, storeB };
}

const reply = (value: JsonValue, extra: { cost?: number; header?: string } = {}): Reply => ({
  content: JSON.stringify(value),
  ...extra,
});

const aroundToday = () => {
  const day = 86_400_000;
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

  return {
    current: parseCostRange(iso(today - day), iso(today + 2 * day), "day"),
    later: parseCostRange(iso(today + 2 * day), iso(today + 5 * day), "day"),
  };
};

test("returns a validated interpretation from one text-only call to the assistant model", async () => {
  const f = fixture({ assistantModel: "assistant-model" });
  const gateway = f.mockGateway(reply(interpretation, { cost: 0.002 }));

  const response = await f.interpret();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ interpretation });
  expect(getModelPreparationSnapshot().reservedBytes).toBe(0);

  const [request] = gateway.requests();
  expect(gateway.requests()).toHaveLength(1);
  expect(request.model).toBe("assistant-model");
  // The assistant model doesn't support structured output in this configuration.
  expect(request.response_format).toBeUndefined();
  expect(request.messages[0].content).toContain("refer to the upload date");
  expect(request.messages[0].content).toContain("Output contract:");

  const message = JSON.parse(request.messages[1].content);
  expect(message).toEqual({
    today: "2026-10-13",
    timeZone: "Europe/London",
    untrustedContext: {
      request: body.text,
      // Offsets stay on the client; only each segment's type and text reach the model.
      segments: [
        { type: "template", text: "invoices" },
        { type: "plain", text: "billed to Leeds" },
      ],
      catalogue: {
        templates: [
          {
            id: "tpl_invoice",
            name: "Invoice",
            fields: [
              { field_id: "invoice_number", name: "Invoice number", type: "text" },
              { field_id: "billing_address", name: "Billing address", type: "text" },
              { field_id: "total", name: "Total", type: "number" },
            ],
          },
        ],
        models: [],
        // A member can't read costs, so the model can't search by them.
        capabilities: { cost: false },
      },
    },
  });
});

test("only owners and admins get cost in the catalogue, and the model's cost filter is checked against it", async () => {
  const f = fixture();
  const costly = { ...interpretation, filter: { cost: { op: "gt", value: 0.03 } } };
  const gateway = f.mockGateway(reply(costly));

  const owned = await f.interpret(JSON.stringify(body), { cookie: "owner" });
  expect(owned.status).toBe(200);
  expect((await owned.json()).interpretation.filter).toEqual({ conditions: [{ cost: { op: "gt", value: 0.03 } }] });
  expect(gateway.requests()[0].messages[0].content).toContain('"3 cents" is 0.03');
  expect(JSON.parse(gateway.requests()[0].messages[1].content).untrustedContext.catalogue.capabilities).toEqual({ cost: true });

  const withoutCosts: Array<Record<string, string>> = [{ cookie: "member" }, { cookie: "", authorization: "Bearer inbound" }];

  for (const headers of withoutCosts) {
    const before = gateway.requests().length;
    const refused = await f.interpret(JSON.stringify(body), headers);

    expect(refused.status).toBe(422);
    const [first, correction] = gateway.requests().slice(before);

    expect(JSON.parse(first.messages[1].content).untrustedContext.catalogue.capabilities).toEqual({ cost: false });
    expect(correction.messages[3].content).toContain("Only workspace owners and admins can search by cost.");
  }
});

test("API keys may interpret, structured output is requested when supported, and cookie requests need a trusted origin", async () => {
  const f = fixture();
  const gateway = f.mockGateway(reply(interpretation));

  const keyed = await f.interpret(JSON.stringify(body), { cookie: "", authorization: "Bearer inbound" });
  expect(keyed.status).toBe(200);
  expect(gateway.requests()[0]).toMatchObject({ model: "extraction-model", response_format: { type: "json_object" } });

  const foreign = await f.interpret(JSON.stringify(body), { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
  expect(foreign.status).toBe(403);
  expect((await foreign.json()).error.code).toBe("untrusted_origin");
  expect(gateway.mock).toHaveBeenCalledTimes(1);
});

test("an invalid first response gets one correction attempt", async () => {
  const f = fixture();
  const gateway = f.mockGateway({ content: "```json\nnot json```" }, reply(interpretation));

  const response = await f.interpret();
  expect(response.status).toBe(200);
  expect((await response.json()).interpretation).toEqual(interpretation);

  const retry = gateway.requests()[1];
  expect(retry.messages).toHaveLength(4);
  expect(retry.messages[2]).toEqual({ role: "assistant", content: "```json\nnot json```" });
  expect(retry.messages[3].content).toContain("Return valid JSON without markdown fences.");
});

test("Templates and fields the catalogue doesn't contain are rejected, and a second failure is 422", async () => {
  const f = fixture();

  const unknownField = {
    ...interpretation,
    filter: { conditions: [{ template_id: "tpl_invoice", field_id: "supplier", op: "contains", value: "Acme" }] },
  };

  const unknownTemplate = { ...interpretation, filter: { template_ids: ["tpl_elsewhere"] } };
  const gateway = f.mockGateway(reply(unknownField), reply(unknownTemplate), reply(interpretation));

  const response = await f.interpret();
  expect(response.status).toBe(422);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).error.code).toBe("search_interpretation_invalid");
  expect(gateway.mock).toHaveBeenCalledTimes(2);
  expect(gateway.requests()[1].messages[3].content).toContain('Field "supplier" isn\'t on that template.');
});

test("a missing model configuration is 409 and makes no call", async () => {
  const f = fixture({ configured: false });
  const gateway = f.mockGateway(reply(interpretation));

  const response = await f.interpret();
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("workspace_model_not_configured");
  expect(gateway.mock).not.toHaveBeenCalled();
});

test.each([500, 401])("a gateway HTTP %d is 502 without upstream detail", async (status) => {
  const f = fixture();
  f.mockGateway({ status });

  const response = await f.interpret();
  expect(response.status).toBe(502);
  const text = await response.text();
  expect(JSON.parse(text).error.code).toBe("search_interpretation_failed");
  expect(text).not.toContain("upstream detail");
});

test("a cancelled request is 499", async () => {
  const f = fixture();
  const controller = new AbortController();

  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          controller.abort();
        }),
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  cleanups.push(() => mock.mockRestore());

  const response = await f.interpret(JSON.stringify(body), {}, controller.signal);
  expect(response.status).toBe(499);
  expect((await response.json()).error.code).toBe("request_cancelled");
});

test("a model that misses the deadline is a 502 failure, not a cancellation", async () => {
  const f = fixture({ timeout: "50" });

  // The gateway ignores its abort signal and answers after the 100 ms overall deadline.
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        await Bun.sleep(250);

        return Response.json({ choices: [{ message: { content: JSON.stringify(interpretation) } }] });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  cleanups.push(() => mock.mockRestore());

  const response = await f.interpret();
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: { code: "search_interpretation_failed", message: "The configured model didn't respond in time. Try again." },
  });
});

test.each<[string, JsonValue]>([
  ["a list", []],
  ["an unknown property", { ...body, catalog: {} }],
  ["empty text", { ...body, text: "   " }],
  ["long text", { ...body, text: "x".repeat(1001) }],
  ["too many segments", { ...body, segments: Array.from({ length: 61 }, () => ({ type: "plain", text: "x" })) }],
  ["a segment without text", { ...body, segments: [{ type: "plain" }] }],
  ["a segment with an unknown property", { ...body, segments: [{ type: "plain", text: "x", score: 1 }] }],
  ["an impossible date", { ...body, today: "2026-02-30" }],
  ["a missing time zone", { text: body.text, segments: [], today: body.today }],
  ["a long time zone", { ...body, time_zone: "A".repeat(65) }],
])("rejects %s with 400 before calling the model", async (_label, payload) => {
  const f = fixture();
  const gateway = f.mockGateway(reply(interpretation));

  const response = await f.interpret(JSON.stringify(payload));
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("invalid_search_interpretation_request");
  expect(gateway.mock).not.toHaveBeenCalled();
});

test("a body that isn't JSON is 400", async () => {
  const f = fixture();
  const gateway = f.mockGateway(reply(interpretation));

  const response = await f.interpret("{");
  expect(response.status).toBe(400);
  expect(gateway.mock).not.toHaveBeenCalled();
});

test("each call, including the correction attempt and failures, is recorded and summed in the cost overview", async () => {
  const f = fixture({ assistantModel: "assistant-model" });
  f.mockGateway(reply({ action: "teleport" }, { cost: 0.001 }), reply(interpretation, { header: "0.0025" }));
  expect((await f.interpret()).status).toBe(200);

  f.mockGateway({ status: 500 });
  expect((await f.interpret()).status).toBe(502);

  const { current, later } = aroundToday();
  const overview = f.storeA.getCostOverview(current);
  expect(overview.searches.calls).toBe(3);
  expect(overview.searches.costs).toMatchObject({ complete: false, reported_calls: 2, unreported_calls: 1 });
  expect(overview.searches.costs.amount).toBeCloseTo(0.0035, 12);
  // Search spend is the Workspace's, not a Document's.
  expect(overview.totals.costs.total).toEqual(costAmount());
  expect(f.storeA.getCostOverview(later).searches).toEqual({ calls: 0, costs: costAmount() });
  expect(f.storeB.getCostOverview(current).searches).toEqual({ calls: 0, costs: costAmount() });
});

test("a caller only interprets against its own Workspace's catalogue", async () => {
  const f = fixture();
  const gateway = f.mockGateway(reply(interpretation));

  const outsider = await f.interpret(JSON.stringify(body), { cookie: "a_only", "x-workspace-id": "workspace_b" });
  expect(outsider.status).toBe(403);
  expect(gateway.mock).not.toHaveBeenCalled();

  // An API key is bound to its Workspace whatever the header says.
  expect((await f.interpret(JSON.stringify(body), { cookie: "", authorization: "Bearer inbound", "x-workspace-id": "workspace_b" })).status).toBe(200);

  // Workspace B's catalogue has no Invoice Template, so A's IDs fail validation twice.
  const response = await f.interpret(JSON.stringify(body), { "x-workspace-id": "workspace_b" });
  expect(response.status).toBe(422);

  const catalogue = (request: { messages: Array<{ content: string }> }) =>
    JSON.parse(request.messages[1].content).untrustedContext.catalogue.templates.map(
      (template: { id: string }) => template.id,
    );

  expect(gateway.requests().map(catalogue)).toEqual([["tpl_invoice"], ["tpl_order"], ["tpl_order"]]);
  expect(f.storeB.getCostOverview(aroundToday().current).searches.calls).toBe(2);
});

test("the catalogue offered to the model is bounded and keeps Templates the request names", () => {
  const field = (index: number) => ({
    field_id: `field_${index}`,
    name: `Field number ${index} with a fairly long descriptive label`,
    data_type: "string",
    type: "text" as const,
    known_values: Array.from({ length: 20 }, (_, value) => `Known value ${value} for ${index}`),
  });

  const templates: SearchCatalogTemplate[] = Array.from({ length: 120 }, (_, index) => ({
    id: `tpl_${index}`,
    name: `Template ${String(index).padStart(3, "0")}`,
    current_version: 1,
    fields: Array.from({ length: 20 }, (_, position) => field(position)),
  }));

  const offered = catalogueForPrompt({ templates, models: ["model-a"] }, "find template 119 totals");
  const ids = offered.templates.map((template) => template.id);

  expect(Buffer.byteLength(JSON.stringify(offered))).toBeLessThanOrEqual(INTERPRETATION_LIMITS.catalogueBytes);
  expect(offered).toMatchObject({ known_values_omitted: true, truncated: true, models: ["model-a"] });
  expect(ids[0]).toBe("tpl_119");
  expect(ids.length).toBeGreaterThan(10);

  const small = catalogueForPrompt({ templates: templates.slice(0, 2), models: [] }, "");
  const values = small.templates.flatMap((template) => template.fields.flatMap((entry) => entry.known_values ?? []));

  expect(small.truncated).toBeUndefined();
  expect(values).toHaveLength(INTERPRETATION_LIMITS.knownValuesPerField * 20 * 2);
});
