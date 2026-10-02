import { afterEach, expect, spyOn, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { loadImage } from "@napi-rs/canvas";
import { classifyDocument, assessDocumentSplit, validateSplitPlan, DOCUMENT_ASSESSMENT_LIMITS } from "./documentAssessment";
import { materializePdfPages } from "../lib/pdfPageOperations";

const config = { AI_MODEL: "qwen3.6-classification", LITELLM_KEY: "dummy-key", MODEL_GATEWAY_URL: "http://localhost:1234/v1", MODEL_SUPPORTS_STRUCTURED_OUTPUT: "true", MODEL_SUPPORTS_PDF_INPUT: "true" };
const candidates = [{ id: "invoice", name: "Invoice", description: "An invoice that requests payment" }, { id: "receipt", name: "Receipt", description: "Proof of payment received" }];
const selected = { status: "selected" as const, template_id: "invoice", reason: "This is a request for payment", evidence: ["The document says Invoice and states payment is due"] };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function mockFetch(content: unknown) { globalThis.fetch = originalFetch; return spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { preconnect: originalFetch.preconnect })); }
const classify = (overrides = {}, input = {}) => classifyDocument({ ...config, ...overrides }, { source: new Blob(["synthetic image"]), mimeType: "image/png", candidates, ...input }, new AbortController().signal);
async function fixture() {
  const pdf = await PDFDocument.create();
  for (let i = 1; i <= 4; i++) {
    const page = pdf.addPage([100 + i, 100]);
    if (i !== 2) page.drawText(`DOCUMENT ${i}`, { x: 2, y: 60, size: 9 });
  }
  return new Blob([Uint8Array.from(await pdf.save())], { type: "application/pdf" });
}
const split = async (source: Blob, pages: number[], exclude = false, overrides = {}) => assessDocumentSplit({ ...config, ...overrides }, { source, selectedPages: pages, excludeBlankPages: exclude }, new AbortController().signal);
const resolved = (groups: number[][], exclusions: unknown[] = []) => ({ status: "resolved", groups, exclusions, reason: "The document boundaries are clear", evidence: ["Each document has its own heading"] });
const blank = (page: number) => ({ page, reason: "Page contains no content", verified_blank: true });

test("classifies from allowed metadata only and sends the requested model/schema", async () => {
  const fetch = mockFetch(selected);
  expect(await classify({}, { candidates: candidates.map((candidate) => ({ ...candidate, fields: [{ name: "PRIVATE FIELD", description: "PRIVATE GUIDANCE" }], arbitrary: "PRIVATE EXTRA" })) })).toEqual(selected);
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body.model).toBe("qwen3.6-classification");
  expect(body.response_format.json_schema.name).toBe("document_classification");
  expect(body.messages[1].content[0].text).not.toContain("PRIVATE");
  expect(JSON.parse(body.messages[1].content[0].text).candidates).toEqual(candidates);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("empty candidate pool does no model work and large pools never silently truncate", async () => {
  const fetch = mockFetch(selected);
  expect((await classify({}, { candidates: [] })).status).toBe("no_match");
  await expect(classify({}, { candidates: Array.from({ length: DOCUMENT_ASSESSMENT_LIMITS.candidates + 1 }, (_, i) => ({ ...candidates[0]!, id: String(i) })) })).rejects.toMatchObject({ code: "document_assessment_limit_exceeded" });
  await expect(classify({}, { candidates: [{ ...candidates[0]!, description: "a".repeat(DOCUMENT_ASSESSMENT_LIMITS.candidateBytes) }] })).rejects.toMatchObject({ code: "document_assessment_limit_exceeded" });
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["not json", { ...selected, template_id: "outside-tag-pool" }, { ...selected, evidence: [] }, { ...selected, fields: [] }])("invalid classification consumes one call and yields uncertainty: %j", async (response) => {
  const fetch = mockFetch(response);
  const result = await classify();
  expect(result.status).toBe("uncertain");
  expect(result.template_id).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an otherwise suitable single candidate still requires assessment", async () => {
  const fetch = mockFetch({ status: "no_match", template_id: null, reason: "This is a delivery note", evidence: ["The document describes a delivery"] });
  expect((await classify({}, { candidates: [candidates[0]] })).status).toBe("no_match");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("targeted feedback and disabled structured output are honored without hidden retry calls", async () => {
  const fetch = mockFetch(selected);
  await classify({ MODEL_SUPPORTS_STRUCTURED_OUTPUT: "false" }, { previous: { reason: "Compare whether payment is due or already received", evidence: ["Footer mentions payment"] } });
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(body.response_format).toBeUndefined();
  expect(JSON.parse(body.messages[1].content[0].text).previous.reason).toContain("already received");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("split model receives only selected pages, with physical lineage mapping", async () => {
  const fetch = mockFetch(resolved([[1], [3, 4]]));
  expect((await split(await fixture(), [1, 3, 4])).groups).toEqual([[1], [3, 4]]);
  const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  const content = body.messages[1].content;
  expect(JSON.parse(content[0].text).pages).toEqual([{ attachment_page: 1, original_page: 1 }, { attachment_page: 2, original_page: 3 }, { attachment_page: 3, original_page: 4 }]);
  const filePart = content[1];
  const fileData = filePart.file.file_data as string;
  const actual = await PDFDocument.load(Buffer.from(fileData.split(",")[1]!, "base64"));
  expect(actual.getPages().map((page) => page.getWidth())).toEqual([101, 103, 104]);
});

test("rendered classification and splitting keep sibling/excluded pages out", async () => {
  const source = await fixture();
  const child = new Blob([Uint8Array.from(await materializePdfPages(source, [3]))], { type: "application/pdf" });
  const classifyFetch = mockFetch(selected);
  await classify({ MODEL_SUPPORTS_PDF_INPUT: "false" }, { source: child, mimeType: "application/pdf" });
  const classificationParts = JSON.parse(classifyFetch.mock.calls[0]![1]!.body as string).messages[1].content;
  expect(classificationParts).toHaveLength(2);
  expect((await loadImage(Buffer.from(classificationParts[1].image_url.url.split(",")[1], "base64"))).width).toBe(206);
  const splitFetch = mockFetch(resolved([[1], [4]]));
  await split(source, [1, 4], false, { MODEL_SUPPORTS_PDF_INPUT: "false" });
  const splitParts = JSON.parse(splitFetch.mock.calls[0]![1]!.body as string).messages[1].content;
  expect(splitParts).toHaveLength(3);
  expect((await loadImage(Buffer.from(splitParts[1].image_url.url.split(",")[1], "base64"))).width).toBe(202);
  expect((await loadImage(Buffer.from(splitParts[2].image_url.url.split(",")[1], "base64"))).width).toBe(208);
});

test("only independently verified blank pages can be excluded; allblank succeeds with zero groups", async () => {
  const source = await fixture();
  mockFetch(resolved([[1], [3, 4]], [blank(2)]));
  expect((await split(source, [1, 2, 3, 4], true)).status).toBe("resolved");
  mockFetch(resolved([], [blank(2)]));
  expect(await split(source, [2], true)).toMatchObject({ status: "resolved", groups: [], exclusions: [blank(2)] });
  mockFetch(resolved([], [blank(1)]));
  expect(await split(source, [1], true)).toMatchObject({ status: "uncertain", groups: [], exclusions: [] });
  mockFetch(resolved([[1]], [blank(2)]));
  expect((await split(source, [1, 2], false)).status).toBe("uncertain");
});

test("invalid split coverage, repeated pages and missing evidence cannot commit", async () => {
  const source = await fixture();
  for (const result of [resolved([[1]], []), resolved([[1, 2], [2, 3, 4]]), resolved([[0, 1, 2, 3, 4]]), { ...resolved([[1, 2, 3, 4]]), evidence: [] }]) {
    const fetch = mockFetch(result);
    expect((await split(source, [1, 2, 3, 4])).status).toBe("uncertain");
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});

test("manual plans may exclude nonblank pages but cannot declare empty nonblank work completed", () => {
  const excluded = { page: 2, reason: "User explicitly excluded cover", verified_blank: false };
  expect(validateSplitPlan([[3, 1]], [excluded], [1, 2, 3], false, true).groups).toEqual([[1, 3]]);
  expect(() => validateSplitPlan([[1, 3]], [excluded], [1, 2, 3], false)).toThrow();
  expect(() => validateSplitPlan([], [excluded], [2], true, true)).toThrow();
});

test("gateway failures propagate without switching model or resetting assessment work", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => new Response("sensitive upstream body", { status: 503 }), { preconnect: originalFetch.preconnect }));
  await expect(classify()).rejects.toThrow("HTTP 503");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("lazy PDF preparation waits for shared memory admission and cancellation does not materialize a source", async () => {
  const { getModelPreparationSnapshot, withDocumentProcessingMemory, withPreparedModelSourceFactory } = await import("./modelGateway");
  const before = getModelPreparationSnapshot();
  const controller = new AbortController();
  let preparations = 0;
  await withDocumentProcessingMemory(before.maxBytes, new AbortController().signal, async () => {
    const pending = withPreparedModelSourceFactory(config, 1, "image/png", controller.signal, async () => { preparations++; return new Blob(["x"]); }, async () => {});
    await Bun.sleep(1);
    expect(preparations).toBe(0);
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });
  expect(preparations).toBe(0);
  expect(getModelPreparationSnapshot().reservedBytes).toBe(before.reservedBytes);
});
