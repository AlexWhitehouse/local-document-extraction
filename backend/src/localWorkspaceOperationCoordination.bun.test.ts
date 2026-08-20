import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { createLocalApplication } from "./localApplication";
import { createLocalAuth } from "./localAuth";
import { createLocalSourceFileStore } from "./localSourceFileStore";
import { createLocalWorkspaceControl, type LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import {
  LocalWorkspaceProductStoreRegistryError,
  type LocalWorkspaceProductStoreRegistry,
} from "./localWorkspaceProductStoreRegistry";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";

test("Workspace deletion drains admitted product work and rejects new product HTTP requests", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-operation-coordination-"));
  const database = new Database(":memory:");
  const verificationLinks: string[] = [];
  const auth = await createLocalAuth({
    baseURL: "http://127.0.0.1:8787",
    database,
    mailSink: {
      capture: async (message) => {
        const link = message.text.match(/https?:\/\/\S+/)?.[0];
        if (link) verificationLinks.push(link);
      },
    },
    secret: "01234567890123456789012345678901",
  });
  const workspaceControl = createLocalWorkspaceControl(database);
  const originalAssertWorkspaceDeletion = workspaceControl.assertWorkspaceDeletion;
  let deletionPolicyChecked: () => void = () => {};
  const deletionPolicyCheckedPromise = new Promise<void>((resolve) => {
    deletionPolicyChecked = resolve;
  });
  workspaceControl.assertWorkspaceDeletion = (input) => {
    originalAssertWorkspaceDeletion(input);
    deletionPolicyChecked();
  };
  const localSourceFiles = createLocalSourceFileStore({ stateDirectory });
  let sourceWriteReached: () => void = () => {};
  let releaseSourceWrite: () => void = () => {};
  const sourceWriteReachedPromise = new Promise<void>((resolve) => {
    sourceWriteReached = resolve;
  });
  const releaseSourceWritePromise = new Promise<void>((resolve) => {
    releaseSourceWrite = resolve;
  });
  const sourceFiles = {
    ...localSourceFiles,
    promoteTemporary: async (input: Parameters<NonNullable<typeof localSourceFiles.promoteTemporary>>[0]) => {
      const sourceFileKey = await localSourceFiles.promoteTemporary!(input);
      sourceWriteReached();
      await releaseSourceWritePromise;
      return sourceFileKey;
    },
    write: async (input: Parameters<typeof localSourceFiles.write>[0]) => {
      const sourceFileKey = await localSourceFiles.write(input);
      sourceWriteReached();
      await releaseSourceWritePromise;
      return sourceFileKey;
    },
  };
  const application = createLocalApplication({
    auth,
    sourceFileStore: sourceFiles,
    stateDirectory,
    workspaceControl,
  });

  try {
    await application(new Request("http://127.0.0.1:8787/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", password: "Strong1!" }),
    }));
    await application(new Request(verificationLinks[0]!, { redirect: "manual" }));
    const signIn = await application(new Request("http://127.0.0.1:8787/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    }));
    const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0]!;
    const session = await auth.getSession(new Request("http://127.0.0.1:8787", { headers: { cookie } }));
    const deletedWorkspace = workspaceControl.listAcceptedWorkspaces({ userId: session!.id, userName: session!.name })[0]!;
    workspaceControl.createWorkspace({ userId: session!.id, name: "Remaining Workspace" });
    const headers = { cookie, "x-workspace-id": deletedWorkspace.id };
    const productStore = createLocalWorkspaceProductStore({ stateDirectory, workspaceId: deletedWorkspace.id });
    productStore.createTemplate({
      templateId: "tpl_invoice",
      name: "Invoice",
      description: "Extract invoice details.",
      fields: [{ id: "invoice_number", name: "Invoice number", description: "Invoice number.", data_type: "string" }],
      createdAt: "2026-07-10T12:00:00.000Z",
    });
    productStore.close();

    const admittedSubmission = application(new Request("http://127.0.0.1:8787/v1/extract", {
      method: "POST",
      headers,
      body: documentFormData("tpl_invoice", "admitted.png"),
    }));
    await sourceWriteReachedPromise;
    const deletion = application(new Request(`http://127.0.0.1:8787/v1/workspaces/${deletedWorkspace.id}`, {
      method: "DELETE",
      headers: { cookie },
    }));
    await deletionPolicyCheckedPromise;

    const templateResponse = await application(new Request("http://127.0.0.1:8787/v1/templates", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Blocked template",
        fields: [{ name: "Value", description: "A value.", data_type: "string" }],
      }),
    }));
    const jobResponse = await application(new Request("http://127.0.0.1:8787/v1/jobs", { headers }));
    const rejectedSubmission = await application(new Request("http://127.0.0.1:8787/v1/extract", {
      method: "POST",
      headers,
      body: documentFormData("tpl_invoice", "rejected.png"),
    }));

    for (const response of [templateResponse, jobResponse, rejectedSubmission]) {
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: { code: "workspace_deleting", message: "Workspace deletion is in progress" },
      });
    }

    releaseSourceWrite();
    expect((await admittedSubmission).status).toBe(202);
    expect((await deletion).status).toBe(200);
    await expect(stat(join(stateDirectory, "data", "workspaces", `${deletedWorkspace.id}.sqlite`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(stateDirectory, "source-files", "workspaces", deletedWorkspace.id))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    releaseSourceWrite();
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("product-store capacity failure releases the admitted Workspace operation", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-store-capacity-"));
  const workspaceId = "workspace_capacity";
  const workspaceProductOperations = createLocalWorkspaceProductOperations();
  const productStoreRegistry: LocalWorkspaceProductStoreRegistry = {
    acquire: () => {
      throw new LocalWorkspaceProductStoreRegistryError(
        "capacity_exhausted",
        "Workspace product-store capacity is temporarily exhausted",
      );
    },
    closeAll: () => {},
    evictIdleStores: () => 0,
    diagnostics: () => ({
      activeLeases: 64,
      invalidatedWorkspaces: 0,
      maxOpenStores: 64,
      openStores: 64,
    }),
    invalidate: async () => {},
  };
  const workspaceControl = {
    getAcceptedWorkspaceContext: () => ({
      id: workspaceId,
      name: "Capacity Workspace",
      created_at: "2026-08-16T12:00:00.000Z",
      max_source_file_bytes: null,
      has_api_key: false,
      role: "owner",
    }),
  } as unknown as LocalWorkspaceControl;
  const application = createLocalApplication({
    auth: {
      getSession: async () => ({ id: "user_1", email: "ada@example.com", name: "Ada Lovelace" }),
      handler: async () => new Response(null, { status: 404 }),
    },
    productStoreRegistry,
    sourceFileStore: createLocalSourceFileStore({ stateDirectory }),
    stateDirectory,
    workspaceControl,
    workspaceProductOperations,
  });

  try {
    const response = await application(new Request("http://127.0.0.1:8787/v1/jobs", {
      headers: { "x-workspace-id": workspaceId },
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "local_product_store_capacity_unavailable",
        message: "Local Workspace product-store capacity is temporarily full",
      },
    });

    let deletionStarted = false;
    await Promise.race([
      workspaceProductOperations.beginDeletion({ workspaceId }).then(() => {
        deletionStarted = true;
      }),
      Bun.sleep(50),
    ]);
    expect(deletionStarted).toBe(true);
    workspaceProductOperations.failDeletion({ workspaceId });
  } finally {
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function documentFormData(templateId: string, name: string): FormData {
  const formData = new FormData();
  formData.append("template_id", templateId);
  formData.append("document", new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" }));
  return formData;
}
