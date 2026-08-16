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
