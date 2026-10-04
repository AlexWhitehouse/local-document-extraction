import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
