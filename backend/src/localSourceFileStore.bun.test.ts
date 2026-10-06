import { PDFDocument } from "pdf-lib";
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalSourceFileStore } from "./localSourceFileStore";

test("local Source file storage writes, reads, and deletes binaries through its public interface", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-source-files-"));
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });

  try {
    const sourceFileKey = await sourceFiles.write({
      workspaceId: "workspace_research",
      jobId: "job_invoice",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });

    expect(await sourceFiles.read(sourceFileKey)).toEqual(new Uint8Array([137, 80, 78, 71]));
    await sourceFiles.delete(sourceFileKey);
    expect(await sourceFiles.read(sourceFileKey)).toBeNull();
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("local Source file storage hard-erases one Workspace idempotently without affecting another Workspace", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-source-workspace-erase-"));
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });

  try {
    const erasedWorkspaceFile = await sourceFiles.write({
      workspaceId: "workspace_erased",
      jobId: "job_invoice",
      mimeType: "image/png",
      bytes: new Uint8Array([1]),
    });

    const retainedWorkspaceFile = await sourceFiles.write({
      workspaceId: "workspace_retained",
      jobId: "job_invoice",
      mimeType: "image/png",
      bytes: new Uint8Array([2]),
    });

    await sourceFiles.eraseWorkspace("workspace_erased");
    await sourceFiles.eraseWorkspace("workspace_erased");

    expect(await sourceFiles.read(erasedWorkspaceFile)).toBeNull();
    expect(await sourceFiles.read(retainedWorkspaceFile)).toEqual(new Uint8Array([2]));
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("library directory listings resume after a cursor so every saved original is eventually visited", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-library-listing-"));
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });

  try {
    const temporary = join(stateDirectory, "temporary", "evaluation-documents");

    for (const [workspaceId, documentId] of [
      ["workspace_b", "evd_1"],
      ["workspace_a", "evd_2"],
      ["workspace_a", "evd_1"],
    ]) {
      const temporaryPath = join(temporary, `${workspaceId}-${documentId}.upload`);
      await Bun.write(temporaryPath, new Uint8Array([137, 80, 78, 71]));
      await sourceFiles.promoteEvaluationDocument!({
        workspaceId: workspaceId!,
        documentId: documentId!,
        mimeType: "image/png",
        temporaryPath,
      });
    }

    const names = (list: Array<{ workspaceId: string; documentId: string }>) =>
      list.map((d) => `${d.workspaceId}/${d.documentId}`);

    const first = await sourceFiles.listEvaluationDocumentDirectories!({ limit: 2 });
    expect(names(first)).toEqual(["workspace_a/evd_1", "workspace_a/evd_2"]);
    expect(
      names(await sourceFiles.listEvaluationDocumentDirectories!({ limit: 2, after: "workspace_a/evd_2" })),
    ).toEqual(["workspace_b/evd_1"]);
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});


test("PDF Source views survive parent deletion and reopening, and isolate pages and Workspace ownership", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "source-views-"));

  try {
    let files = createLocalSourceFileStore({ stateDirectory });
    const pdf = await PDFDocument.create();
    pdf.addPage([100, 150]);
    pdf.addPage([200, 250]);
    pdf.addPage([300, 350]);
    const source = await files.write({ workspaceId: "a", jobId: "parent", mimeType: "application/pdf", bytes: await pdf.save() });
    const child = await files.createPdfView!({ workspaceId: "a", jobId: "child", sourceFileKey: source, pages: [1, 3] });
    const nested = await files.createPdfView!({ workspaceId: "a", jobId: "nested", sourceFileKey: child, pages: [2] });
    const original = await files.resolveProcessingSource!(source);
    const view = await files.resolveProcessingSource!(child);
    expect((await stat(view.path)).ino).toBe((await stat(original.path)).ino);
    expect(view.pages).toEqual([1, 3]);
    await expect(files.createPdfView!({ workspaceId: "b", jobId: "child", sourceFileKey: source, pages: [1] })).rejects.toThrow("Workspace");
    await files.delete(source);
    files = createLocalSourceFileStore({ stateDirectory });
    const downloaded = await PDFDocument.load((await files.read(child))!);
    expect(downloaded.getPages().map((page) => page.getWidth())).toEqual([100, 300]);
    await files.delete(child);
    const remaining = await PDFDocument.load((await files.read(nested))!);
    expect(remaining.getPages().map((page) => page.getWidth())).toEqual([300]);
    await files.delete(nested);
    await files.delete(nested);
    expect(await files.open!(nested)).toBeNull();
  } finally { await rm(stateDirectory, { recursive: true, force: true }); }
});
