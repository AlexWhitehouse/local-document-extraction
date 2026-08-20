import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpError } from "./lib/http";
import { parseLocalMultipartSubmission } from "./localMultipartSubmission";
import { createLocalSourceFileStore } from "./localSourceFileStore";

test("multipart submission streams the document to a promotable temporary file", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-multipart-"));
  const form = new FormData();
  form.set("template_id", "template_invoice");
  form.set("options", JSON.stringify({ include_confidence: true }));
  form.set("document", new File([new Uint8Array([1, 2, 3, 4])], "invoice.pdf", { type: "application/pdf" }));

  try {
    const parsed = await parseLocalMultipartSubmission({
      maxSourceFileBytes: 10,
      request: new Request("http://127.0.0.1/v1/extract", { method: "POST", body: form }),
      stateDirectory,
    });
    expect(parsed).toMatchObject({
      templateId: "template_invoice",
      source: { mimeType: "application/pdf", name: "invoice.pdf", size: 4 },
    });
    expect(new Uint8Array(await Bun.file(parsed.source.temporaryPath).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));

    const sourceFiles = createLocalSourceFileStore({ stateDirectory });
    const key = await sourceFiles.promoteTemporary!({
      workspaceId: "workspace_one",
      jobId: "job_one",
      mimeType: parsed.source.mimeType,
      temporaryPath: parsed.source.temporaryPath,
    });
    expect(key).toBe("workspaces/workspace_one/jobs/job_one/source.pdf");
    expect(await sourceFiles.read(key)).not.toBeNull();
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("multipart submission rejects duplicate fields and oversized files without retaining temporary data", async () => {
  for (const scenario of ["duplicate", "oversized"] as const) {
    const stateDirectory = await mkdtemp(join(tmpdir(), `document-extraction-multipart-${scenario}-`));
    const form = new FormData();
    form.append("template_id", "template_one");
    if (scenario === "duplicate") form.append("template_id", "template_two");
    form.set("document", new File([new Uint8Array([1, 2, 3])], "source.pdf", { type: "application/pdf" }));
    try {
      let failure: unknown = null;
      try {
        await parseLocalMultipartSubmission({
          maxSourceFileBytes: scenario === "oversized" ? 2 : 10,
          request: new Request("http://127.0.0.1/v1/extract", { method: "POST", body: form }),
          stateDirectory,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(HttpError);
      expect((failure as HttpError).code).toBe(scenario === "duplicate" ? "invalid_multipart" : "source_file_too_large");
      const temporaryFiles = await readdir(join(stateDirectory, "temporary", "submissions")).catch(() => []);
      expect(temporaryFiles).toEqual([]);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  }
});

test("multipart Source size accepts the exact boundary and rejects boundary plus one", async () => {
  for (const sourceBytes of [3, 4]) {
    const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-source-boundary-"));
    const form = new FormData();
    form.set("template_id", "template_boundary");
    form.set("document", new File([new Uint8Array(sourceBytes)], "source.png", { type: "image/png" }));
    const request = new Request("http://127.0.0.1/v1/extract", { method: "POST", body: form });
    expect(request.headers.get("content-length")).toBeNull();

    try {
      if (sourceBytes === 3) {
        const parsed = await parseLocalMultipartSubmission({
          maxSourceFileBytes: 3,
          request,
          stateDirectory,
        });
        expect(parsed.source.size).toBe(3);
        await rm(parsed.source.temporaryPath, { force: true });
      } else {
        await expect(parseLocalMultipartSubmission({
          maxSourceFileBytes: 3,
          request,
          stateDirectory,
        })).rejects.toMatchObject({ status: 400, code: "source_file_too_large" });
      }
      const temporaryFiles = await readdir(join(stateDirectory, "temporary", "submissions")).catch(() => []);
      expect(temporaryFiles).toEqual([]);
    } finally {
      await rm(stateDirectory, { recursive: true, force: true });
    }
  }
});

test("an aborted multipart stream promptly removes its partial temporary Source file", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-multipart-abort-"));
  const controller = new AbortController();
  const boundary = "document-extraction-aborted-boundary";
  let bodyCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(new TextEncoder().encode([
        `--${boundary}`,
        'Content-Disposition: form-data; name="template_id"',
        "",
        "template_abort",
        `--${boundary}`,
        'Content-Disposition: form-data; name="document"; filename="source.pdf"',
        "Content-Type: application/pdf",
        "",
        "%PDF-partial",
      ].join("\r\n")));
    },
    cancel() {
      bodyCancelled = true;
    },
  });
  const parsing = parseLocalMultipartSubmission({
    maxSourceFileBytes: 1024,
    request: new Request("http://127.0.0.1/v1/extract", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half",
      signal: controller.signal,
    } as RequestInit),
    stateDirectory,
  });
  await Bun.sleep(1);
  controller.abort();

  try {
    await expect(parsing).rejects.toMatchObject({ status: 400, code: "submission_aborted" });
    expect(bodyCancelled).toBe(true);
    const temporaryFiles = await readdir(join(stateDirectory, "temporary", "submissions")).catch(() => []);
    expect(temporaryFiles).toEqual([]);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
