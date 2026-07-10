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
