import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPdfPages } from "./lib/pdfPageOperations";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { Database } from "bun:sqlite";
import { defaultGoProcessorBinary, startGoProcessor } from "./goProcessor";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createWorkspaceCredentialVault } from "./workspaceModelConfiguration";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalExtractionRunner } from "./localExtractionRunner";
import type { LocalQueuedExtractionJob } from "./localExtractionQueue";
import { parseJson, isJsonObject, isNumber, isJsonArray, isString } from "../../shared/json";

const binary = process.env.GO_PROCESSOR_TEST_BINARY || defaultGoProcessorBinary;

const goTest = test;

async function fixture(mode: "success" | "retry" | "reject" | "no_match" | "bad_split" | "crash" | "empty_assessment" | "large_response" | "invalid_result", rendered = false, brokenObservers = false) {
  const stateDirectory = await mkdtemp(join(tmpdir(), "go-processor-test-"));
  const workspaceId = "workspace_go";
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const scheduled: LocalQueuedExtractionJob[] = [];
  let calls = 0;
  let original = new Uint8Array();
  const attachments: string[][] = [];

  const gateway = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    calls++;

    if (mode === "crash" && calls === 1) {
      return new Promise<Response>((resolve) => {
        const timer = setTimeout(() => resolve(new Response(null, { status: 503 })), 10000);
        request.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(new Response(null, { status: 499 })); }, { once: true });
      });
    }

    const body = parseJson(await request.text());
    const messages = isJsonObject(body) && isJsonArray(body.messages) ? body.messages : [];
    const user = messages.find((message) => isJsonObject(message) && message.role === "user");
    const parts = isJsonObject(user) && isJsonArray(user.content) ? user.content : [];
    const sources: string[] = [];

    for (const part of parts) {
      if (!isJsonObject(part)) continue;

      if (isJsonObject(part.image_url) && isString(part.image_url.url)) sources.push(part.image_url.url);

      if (isJsonObject(part.file)) {
        expect(part.file.format).toBe("application/pdf");

        if (isString(part.file.file_data)) sources.push(part.file.file_data);
      }
    }

    attachments.push(sources);
    const format = isJsonObject(body) && isJsonObject(body.response_format) && isJsonObject(body.response_format.json_schema) ? body.response_format.json_schema.name : null;

    if (mode === "retry" && calls === 1) return new Response(null, { status: 429, headers: { "retry-after": "1" } });

    if (mode === "reject") return new Response(null, { status: 403 });

    if (mode === "empty_assessment" && calls === 1) return Response.json({ choices: [] });

    const result = format === "document_classification"
      ? { status: mode === "no_match" ? "no_match" : "selected", template_id: mode === "no_match" ? null : "tpl_test", reason: "Fixture evidence", evidence: ["Reference on page"] }
      : format === "document_split"
        ? { status: "resolved", groups: mode === "bad_split" ? [[1], [1]] : [[1], [2]], exclusions: [], reason: "Two documents", evidence: ["Distinct references"] }
        : { results: [{ field_id: "reference", status: "ok", answer: mode === "large_response" ? "R".repeat(64 * 1024) : "TEST", confidence: 1, evidence: "Reference" }] };

    return Response.json({ id: `request-${calls}`, usage: { cost: 0.01, prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: mode === "invalid_result" ? "invalid JSON" : JSON.stringify(result) } }] });
  } });

  store.putModelConfiguration({ expectedRevision: null, updatedAt: new Date().toISOString(), configuration: {
    gateway_url: `http://127.0.0.1:${gateway.port}/v1`, model_name: "test/qwen3.5", credential_ciphertext: createWorkspaceCredentialVault(stateDirectory).encrypt(workspaceId, "test-only"),
    sequential_calls: false, supports_pdf_input: !rendered, supports_structured_output: true,
  } });
  store.createTemplate({ templateId: "tpl_test", name: "Test", description: "Fixture", tags: ["fixture"], fields: [{ id: "reference", name: "Reference", description: "Reference", data_type: "string" }], createdAt: new Date().toISOString() });

  const observe = () => {
    if (brokenObservers) throw new Error("Simulated observer failure");
  };

  const processor = await startGoProcessor(binary!, { stateDirectory, sourceFiles, timeoutMs: 5000, retryDelayMs: 1, schedule: (job) => { scheduled.push(job); }, notify: observe, outcome: observe });
  const runner = createLocalExtractionRunner({ stateDirectory, execute: processor.run, staleProcessingAfterMs: 0, scheduleJob: (job) => { scheduled.push(job); } });

  return {
    store, sourceFiles, scheduled, runner, stateDirectory, workspaceId, processor, attachments, original: () => original, calls: () => calls,
    submit: async (packet: boolean, automatic: boolean, run = true) => {
      const document = await PDFDocument.create();
      document.addPage([100, 100]).drawText("FIRST", { x: 5, y: 50, size: 12 });
      document.addPage([100, 100]).drawText("SECOND", { x: 5, y: 50, size: 12 });
      original = Uint8Array.from(await document.save());
      const sourceFileKey = await sourceFiles.write({ workspaceId, jobId: "document_test", mimeType: "application/pdf", bytes: original });
      const base = { templateId: automatic ? null : "tpl_test", templateVersion: automatic ? null : 1, templateTags: ["fixture"], sourceFileKey, sourceMimeType: "application/pdf", sourceName: "fixture.pdf", sourceFilePageCount: 2, submittedAt: new Date().toISOString() };

      if (packet) store.createDocumentPacket({ ...base, packetId: "document_test", templateTags: ["fixture"], selectedPages: [1, 2], processingPolicy: { enable_smart_splitting: true, exclude_blank_pages: false } });
      else store.createQueuedExtractionJob({ ...base, jobId: "document_test" });
      const queued: LocalQueuedExtractionJob = { job_id: "document_test", workspace_id: workspaceId, template_id: base.templateId, template_version: base.templateVersion, enqueued_at: base.submittedAt };

      if (packet) queued.kind = "packet";

      if (run) await runner.run(queued);

      return queued;
    },
    close: async () => { await processor.close(); await gateway.stop(true); store.close(); await rm(stateDirectory, { recursive: true, force: true }); },
  };
}

goTest("Go completes smart splitting, smart template selection, extraction, accounting and cleanup", async () => {
  const f = await fixture("success");

  try {
    await f.submit(true, true);

    for (const child of f.scheduled.splice(0)) await f.runner.run(child);
    const packet = f.store.getDocumentPacket("document_test")!;
    expect(packet.status).toBe("completed");
    expect(packet.children).toHaveLength(2);
    expect(packet.children.every((job) => job.status === "completed")).toBe(true);
    expect(f.calls()).toBe(5);

    for (const [index, parts] of f.attachments.entries()) {
      expect(parts).toHaveLength(1);
      const bytes = Buffer.from(parts[0]!.split(",")[1]!, "base64");
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(index === 0 ? 2 : 1);

      // Selecting every page sends the original rather than a re-saved copy.
      if (index === 0) expect(bytes.equals(f.original())).toBe(true);
    }

    expect(packet.costs?.total).toMatchObject({ amount: 0.05, complete: true, reported_calls: 5, unreported_calls: 0 });

    for (const child of packet.children) expect(f.store.getExtractionJob(child.job_id)?.results[0]?.answer).toBe("TEST");
  } finally { await f.close(); }
}, 30000);

goTest("Go durably reschedules a throttled extraction and resumes with the persisted attempt", async () => {
  const f = await fixture("retry");

  try {
    await f.submit(false, false);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("queued");
    expect(f.scheduled).toHaveLength(1);
    const retry = f.scheduled[0]!;
    expect(retry.attempt).toBe(2);
    expect(Date.parse(retry.not_before!) - Date.parse(retry.enqueued_at)).toBeGreaterThanOrEqual(1000);
    await Bun.sleep(Math.max(0, Date.parse(retry.not_before!) - Date.now()));
    await f.runner.run(retry);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("completed");
    expect(f.calls()).toBe(2);
  } finally { await f.close(); }
}, 15000);

goTest("Go retains failed sources and does not retry deterministic gateway rejection", async () => {
  const f = await fixture("reject");

  try {
    await f.submit(false, false);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("failed");
    expect(f.scheduled).toHaveLength(0);
    expect(f.calls()).toBe(1);
    expect(await f.sourceFiles.read(f.store.getProcessingSource("document_test")!.source_file_key)).not.toBeNull();
  } finally { await f.close(); }
}, 15000);

goTest("Go holds unmatched Documents for manual template selection", async () => {
  const f = await fixture("no_match");

  try {
    await f.submit(false, true);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("awaiting_template");
    expect(f.calls()).toBe(1);
  } finally { await f.close(); }
}, 15000);

goTest("Go reassesses invalid split plans without losing or duplicating pages", async () => {
  const f = await fixture("bad_split");

  try {
    await f.submit(true, false);
    expect(f.store.getDocumentPacket("document_test")?.status).toBe("awaiting_review");
    expect(f.store.getDocumentPacket("document_test")?.children).toHaveLength(0);
    expect(f.calls()).toBe(3);
  } finally { await f.close(); }
}, 15000);

goTest("Go renders a Document once across template selection and extraction", async () => {
  const f = await fixture("success", true);

  try {
    await f.submit(false, true);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("completed");
    expect((await f.processor.diagnostics()).pdf_operations).toBe(1);
    const pages = await renderPdfPages(f.original());

    const geometry = async (png: Buffer) => {
      const image = await loadImage(png);
      const canvas = createCanvas(image.width, image.height);
      canvas.getContext("2d").drawImage(image, 0, 0);
      const pixels = canvas.getContext("2d").getImageData(0, 0, image.width, image.height).data;

      return { width: image.width, height: image.height, inked: pixels.some((value, index) => index % 4 !== 3 && value < 128) };
    };

    // The API and the processor share one renderer, at 2× for 100-point pages; the stages share one rendering.
    expect(f.attachments[0]).toEqual(pages.map((page) => `data:image/png;base64,${Buffer.from(page).toString("base64")}`));
    const rendered = await Promise.all(f.attachments[0]!.map((dataUrl) => geometry(Buffer.from(dataUrl.split(",")[1]!, "base64"))));
    expect(rendered).toEqual(pages.map(() => ({ width: 200, height: 200, inked: true })));
    expect(f.attachments[0]).toEqual(f.attachments[1]);
    const database = new Database(join(f.stateDirectory, "data", "workspaces", `${f.workspaceId}.sqlite`), { readonly: true });

    try { expect(database.query("SELECT count(*) AS total FROM model_call_costs").get()).toEqual({ total: 2 }); }
    finally { database.close(); }
  } finally { await f.close(); }
}, 15000);


goTest("Go process crash preserves accepted work and restarts for durable recovery", async () => {
  const f = await fixture("crash");

  try {
    const pid = (await f.processor.diagnostics()).pid;
    expect(isNumber(pid)).toBe(true);
    const pending = f.submit(false, false);
    const observed = pending.then(() => null, (error: Error) => error);
    const deadline = Date.now() + 5000;

    while (f.calls() === 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(f.calls()).toBe(1);

    if (!isNumber(pid)) throw new Error("Missing processor PID");
    process.kill(pid, "SIGKILL");
    expect(await observed).toBeInstanceOf(Error);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("processing");
    await f.runner.recover();
    expect(f.scheduled).toHaveLength(1);
    await f.runner.run(f.scheduled[0]!);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("completed");
    expect(f.store.getExtractionJobSummary("document_test")?.completed_attempt).toBe(2);
    expect(f.calls()).toBe(2);
  } finally { await f.close(); }
}, 20000);

goTest("cleared model configuration terminally fails accepted work without spending a retry", async () => {
  const f = await fixture("success");

  try {
    const queued = await f.submit(false, false, false);
    f.store.clearModelConfiguration(f.store.getModelConfiguration()!.revision);
    await f.runner.run(queued);
    expect(f.store.getExtractionJobSummary("document_test")).toMatchObject({ status: "failed", error_code: "workspace_model_not_configured", current_attempt: 1 });
    expect(f.scheduled).toHaveLength(0);
    expect(f.calls()).toBe(0);
  } finally { await f.close(); }
}, 15000);


goTest("Go retries an unreadable assessment response within the same durable round", async () => {
  const f = await fixture("empty_assessment");

  try {
    await f.submit(false, true);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("completed");
    expect(f.store.getDocumentRouting("document_test")?.routing_rounds).toBe(1);
    expect(f.calls()).toBe(3);
  } finally { await f.close(); }
}, 15000);


goTest("Go persists large extraction results while preserving accounting", async () => {
  const f = await fixture("large_response");

  try {
    await f.submit(false, false);
    expect(f.store.getExtractionJob("document_test")?.results[0]?.answer).toBe("R".repeat(64 * 1024));
    expect(f.store.getExtractionJobSummary("document_test")?.costs?.total).toMatchObject({ amount: 0.01, reported_calls: 1 });
  } finally { await f.close(); }
}, 15000);


goTest("observer failures do not turn accepted Documents into failed extractions", async () => {
  const f = await fixture("success", false, true);

  try {
    await f.submit(false, false);
    expect(f.store.getExtractionJobSummary("document_test")?.status).toBe("completed");
    expect(f.store.getExtractionJob("document_test")?.results[0]?.answer).toBe("TEST");
    expect(f.calls()).toBe(1);
  } finally { await f.close(); }
}, 15000);


goTest("split children reuse the parent's pixels with isolated model context and no child PDF", async () => {
  const f = await fixture("success", true);

  try {
    await f.submit(true, true);
    const parentPages = f.attachments[0]!;
    expect(parentPages).toHaveLength(2);
    expect(parentPages[0]).not.toBe(parentPages[1]);
    expect(f.store.getProcessingSource("document_test")).toBeNull();

    for (const [index, child] of f.scheduled.splice(0).entries()) {
      const source = f.store.getProcessingSource(child.job_id)!;
      expect(source.source_file_key.endsWith("/source.view")).toBe(true);
      const download = await f.sourceFiles.open!(source.source_file_key);
      expect((await PDFDocument.load(await download!.arrayBuffer())).getPageCount()).toBe(1);
      await f.runner.run(child);
      expect(f.attachments[1 + index * 2]).toEqual([parentPages[index]!]);
      expect(f.attachments[2 + index * 2]).toEqual([parentPages[index]!]);
    }

    const stats = await f.processor.diagnostics();
    expect(stats.render_operations).toBe(1);
    expect(stats.materialize_operations).toBe(0);
    expect(stats.page_cache).toMatchObject({ hits: 2, bytes: 0, pages: 0 });
    expect(f.store.getDocumentPacket("document_test")!.status).toBe("completed");
  } finally { await f.close(); }
}, 30000);

goTest("virtual children recover after losing the processor and its pixel cache", async () => {
  const f = await fixture("success", true);

  try {
    await f.submit(true, false);
    const before = await f.processor.diagnostics();

    if (!isNumber(before.pid)) throw new Error("Missing processor PID");
    process.kill(before.pid, "SIGKILL");
    await Bun.sleep(100);

    for (const child of f.scheduled.splice(0)) await f.runner.run(child);
    expect(f.store.getDocumentPacket("document_test")!.status).toBe("completed");
    expect(f.attachments[1]).toEqual([f.attachments[0]![0]!]);
    expect(f.attachments[2]).toEqual([f.attachments[0]![1]!]);
    expect((await f.processor.diagnostics()).render_operations).toBe(2);
  } finally { await f.close(); }
}, 30000);


goTest("native-PDF extraction materializes only the pages owned by each child", async () => {
  const f = await fixture("success");

  try {
    await f.submit(true, false);
    const runner = createLocalExtractionRunner({ stateDirectory: f.stateDirectory, execute: f.processor.run, scheduleJob: () => {} });

    for (const child of f.scheduled.splice(0)) await runner.run(child);
    expect(f.store.getDocumentPacket("document_test")!.status).toBe("completed");

    for (const parts of f.attachments.slice(1)) {
      const pdf = await PDFDocument.load(Buffer.from(parts[0]!.split(",")[1]!, "base64"));
      expect(pdf.getPageCount()).toBe(1);
    }
  } finally { await f.close(); }
}, 30000);


goTest("invalid extraction output records usage before scheduling its existing durable retry", async () => {
  const f = await fixture("invalid_result");

  try {
    await f.submit(false, false);
    const job = f.store.getExtractionJobSummary("document_test")!;
    expect(job.status).toBe("queued");
    expect(job.costs?.total).toMatchObject({ amount: 0.01, reported_calls: 1, unreported_calls: 0 });
    expect(f.calls()).toBe(1);
    expect(f.scheduled).toHaveLength(1);
  } finally { await f.close(); }
}, 15000);


test("a missing processor fails startup clearly without selecting another engine", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "missing-go-processor-"));

  try {
    await expect(startGoProcessor(join(stateDirectory, "missing-binary"), {
      stateDirectory, sourceFiles: createLocalSourceFileStore({ stateDirectory }),
      timeoutMs: 1000, retryDelayMs: 0, schedule: () => {}, notify: () => {}, outcome: () => {},
    })).rejects.toThrow("Run bun run build");
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});
