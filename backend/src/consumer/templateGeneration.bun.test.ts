import { afterEach, expect, spyOn, test } from "bun:test";
import { generateTemplate, validateGeneratedTemplate } from "./templateGeneration";

const proposal = { name: "Invoice", description: "Invoice details", fields: [
  { name: "Total", description: "Invoice total", data_type: "number" },
] };
const config = { AI_MODEL: "test/model", LITELLM_KEY: "dummy-key", MODEL_GATEWAY_URL: "http://localhost:1234/v1", MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true" };
afterEach(() => { globalThis.fetch = originalFetch; });
const originalFetch = globalThis.fetch;
function mockFetch(implementation: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>) {
  return spyOn(globalThis, "fetch").mockImplementation(Object.assign(implementation, { preconnect: originalFetch.preconnect }));
}
const run = (overrides = {}, signal = new AbortController().signal) => generateTemplate({ ...config, ...overrides }, new Blob(["sample"]), "image/png", "Only capture totals", signal);
const completion = (content: string) => Response.json({ choices: [{ message: { content } }] });

test("corrects rejected proposals with precise feedback and applies only the validated result", async () => {
  const responses = ["```json invalid```", JSON.stringify({ ...proposal, fields: [{ ...proposal.fields[0], data_type: "integer" }] }), JSON.stringify(proposal)];
  const fetch = mockFetch(async () => completion(responses.shift()!));
  const result = await run();
  expect(result.fields?.[0].id).toBe("total");
  expect(fetch).toHaveBeenCalledTimes(3);
  const first = JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(first.model).toBe("test/model");
  expect(first.messages[0].content).toContain("1 to 50");
  expect(first.messages[1].content[0].text).toBe("Only capture totals");
  const last = JSON.parse(fetch.mock.calls[2][1]!.body as string);
  expect(last.messages.at(-1).content).toContain("unsupported data_type");
  expect(last.messages.filter((message: { role: string }) => message.role === "assistant")).toHaveLength(2);
});

test("fails after exactly four invalid proposals", async () => {
  const fetch = mockFetch(async () => completion("null"));
  await expect(run()).rejects.toThrow("after four attempts");
  expect(fetch).toHaveBeenCalledTimes(4);
});

test.each([401, 429, 503])("does not retry gateway HTTP %i", async (status) => {
  const fetch = mockFetch(async () => new Response("secret error detail", { status }));
  await expect(run()).rejects.toThrow(`HTTP ${status}`);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("does not retry a timeout", async () => {
  const fetch = mockFetch((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  await expect(run({ MODEL_GATEWAY_REQUEST_TIMEOUT_MS: "5" })).rejects.toThrow("timed out");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("cancellation prevents further correction attempts", async () => {
  const controller = new AbortController();
  const fetch = mockFetch(async () => { controller.abort(); return completion("{}"); });
  await expect(run({}, controller.signal)).rejects.toThrow("cancelled");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each(["gemma-4-local", "qwen3.6-27b"])("uses template JSON Schema for %s", async (model) => {
  const fetch = mockFetch(async () => completion(JSON.stringify(proposal)));
  await run({ AI_MODEL: model });
  const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(body.response_format.json_schema.name).toBe("generated_template");
  expect(body.response_format.json_schema.schema.properties.fields).toBeDefined();
});

test("omits response format when the workspace does not support structured output", async () => {
  const fetch = mockFetch(async () => completion(JSON.stringify(proposal)));
  await run({ MODEL_SUPPORTS_STRUCTURED_OUTPUT: "false" });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).not.toHaveProperty("response_format");
});

const table = { name: "Items", description: "Line items", data_type: "array<object>", object_schema: { mode: "table", columns: [{ heading: "Price", data_type: "number", description: "Unit price" }] } };
test("accepts editable table metadata and rejects unsupported features without trimming", () => {
  const result = validateGeneratedTemplate({ ...proposal, fields: [table] });
  expect(result.fields?.[0].description).toContain("[[OBJECT_SCHEMA]]");
  const invalid = [
    { ...proposal, required: true },
    { ...proposal, fields: [null] },
    { ...proposal, fields: [{ ...proposal.fields[0], enum: [1, 2] }] },
    { ...proposal, fields: [{ ...proposal.fields[0], object_schema: table.object_schema }] },
    { ...proposal, fields: [{ ...table, object_schema: undefined }] },
    { ...proposal, fields: [table, { ...table, name: "Other" }] },
    { ...proposal, fields: [{ ...table, object_schema: { mode: "table", columns: Array.from({ length: 21 }, (_, i) => ({ heading: `Column ${i}`, data_type: "string", description: "Value" })) } }] },
    { ...proposal, fields: Array.from({ length: 51 }, (_, i) => ({ ...proposal.fields[0], name: `Field ${i}` })) },
    { ...proposal, fields: [{ ...proposal.fields[0], name: "Price!" }] },
  ];
  for (const value of invalid) expect(() => validateGeneratedTemplate(value)).toThrow();
});

test("cancels a queued sequential generation without waiting for or overtaking the active call", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const fetch = mockFetch(async () => { await blocked; return completion(JSON.stringify(proposal)); });
  const configuration = { MODEL_GATEWAY_SEQUENTIAL_CALLS: "true", MODEL_GATEWAY_WORKSPACE_ID: "generation-cancel-test" };
  const first = run(configuration);
  await Bun.sleep(5);
  const controller = new AbortController();
  const second = run(configuration, controller.signal);
  controller.abort();
  const third = run(configuration);
  try {
    await expect(second).rejects.toThrow("cancelled");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await Promise.all([first, third]);
  }
  expect(fetch).toHaveBeenCalledTimes(2);
});
