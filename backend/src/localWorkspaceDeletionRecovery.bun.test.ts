import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalAuth } from "./localAuth";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceDeletion } from "./localWorkspaceDeletion";
import { createLocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";

test("failed Workspace erasure retains durable cleanup intent that reconciliation completes idempotently", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-delete-recovery-"));
  const database = new Database(":memory:");
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: { capture: async () => undefined },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const localSourceFiles = createLocalSourceFileStore({ stateDirectory });
  let failSourceErasure = true;
  const sourceFiles = {
    ...localSourceFiles,
    eraseWorkspace: async (workspaceId: string) => {
      if (failSourceErasure) {
        throw new Error("Source storage is temporarily unavailable");
      }
      await localSourceFiles.eraseWorkspace(workspaceId);
    },
  };

  try {
    const signUp = await auth.handler(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    const user = await signUp.json() as { user: { id: string; name: string } };
    const deletedWorkspace = workspaceControl.listAcceptedWorkspaces({ userId: user.user.id, userName: user.user.name })[0]!;
    workspaceControl.createWorkspace({ userId: user.user.id, name: "Remaining Workspace" });
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: deletedWorkspace.id });
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [{ id: "invoice_number", name: "Invoice number", description: "Invoice number.", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.close();
    await localSourceFiles.write({
      workspaceId: deletedWorkspace.id,
      jobId: "job_invoice",
      mimeType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    const deletion = createLocalWorkspaceDeletion({ sourceFileStore: sourceFiles, stateDirectory, workspaceControl });

    await expect(deletion.deleteWorkspace({ workspaceId: deletedWorkspace.id, userId: user.user.id }))
      .rejects.toThrow("Source storage is temporarily unavailable");

    expect(workspaceControl.workspaceExists({ workspaceId: deletedWorkspace.id })).toBe(false);
    expect(workspaceControl.listWorkspaceDeletionIntents()).toEqual([deletedWorkspace.id]);
    await expect(stat(join(stateDirectory, "source-files", "workspaces", deletedWorkspace.id))).resolves.toBeDefined();

    failSourceErasure = false;
    await deletion.reconcileInterruptedDeletions();
    await deletion.reconcileInterruptedDeletions();

    expect(workspaceControl.listWorkspaceDeletionIntents()).toEqual([]);
    await expect(stat(join(stateDirectory, "data", "workspaces", `${deletedWorkspace.id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDirectory, "source-files", "workspaces", deletedWorkspace.id))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("reconciliation erases only explicitly recorded Workspace deletion intents", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-delete-reconcile-scope-"));
  const database = new Database(":memory:");
  const workspaceControl = createLocalWorkspaceControl(database);
  const sourceFiles = createLocalSourceFileStore({ stateDirectory });
  const orphanWorkspaceId = "workspace_orphan";
  const activeWorkspaceId = "workspace_active";

  try {
    for (const workspaceId of [orphanWorkspaceId, activeWorkspaceId]) {
      const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
      productStore.close();
      await sourceFiles.write({
        workspaceId,
        jobId: "job_invoice",
        mimeType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      });
    }
    workspaceControl.recordWorkspaceDeletionIntent({ workspaceId: orphanWorkspaceId });

    await createLocalWorkspaceDeletion({ sourceFileStore: sourceFiles, stateDirectory, workspaceControl })
      .reconcileInterruptedDeletions();

    await expect(stat(join(stateDirectory, "data", "workspaces", `${orphanWorkspaceId}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDirectory, "source-files", "workspaces", orphanWorkspaceId))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDirectory, "data", "workspaces", `${activeWorkspaceId}.sqlite`))).resolves.toBeDefined();
    await expect(stat(join(stateDirectory, "source-files", "workspaces", activeWorkspaceId))).resolves.toBeDefined();
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
