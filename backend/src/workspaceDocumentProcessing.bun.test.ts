import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceProductStore, openLocalWorkspaceProductStore } from "./localWorkspaceProductStore";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { effectiveDocumentProcessingPolicy, validateDocumentProcessingSettings } from "./workspaceDocumentProcessing";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const temporaryState = () => {
  const directory = mkdtempSync(join(tmpdir(), "document-processing-settings-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

test("processing defaults are disabled and all four settings combinations persist independently of effective policy", () => {
  const stateDirectory = temporaryState();
  const workspaceId = "workspace_a";
  let store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  expect(store.getDocumentProcessingSettings()).toEqual({ enable_smart_splitting: false, exclude_blank_pages: false });
  for (const enable_smart_splitting of [false, true]) for (const exclude_blank_pages of [false, true]) {
    const settings = { enable_smart_splitting, exclude_blank_pages };
    expect(store.putDocumentProcessingSettings(settings)).toEqual(settings);
    store.close();
    store = openLocalWorkspaceProductStore({ stateDirectory, workspaceId })!;
    expect(store.getDocumentProcessingSettings()).toEqual(settings);
    const snapshot = effectiveDocumentProcessingPolicy(settings);
    expect(snapshot).toEqual({ enable_smart_splitting, exclude_blank_pages: enable_smart_splitting && exclude_blank_pages });
    store.putDocumentProcessingSettings({ enable_smart_splitting: false, exclude_blank_pages: false });
    expect(snapshot).toEqual({ enable_smart_splitting, exclude_blank_pages: enable_smart_splitting && exclude_blank_pages });
  }
  store.close();
  for (const invalid of [null, [], {}, { enable_smart_splitting: true }, { enable_smart_splitting: "yes", exclude_blank_pages: false }, { enable_smart_splitting: true, exclude_blank_pages: true, auto_template_selection: true }]) {
    expect(() => validateDocumentProcessingSettings(invalid)).toThrow();
  }
});

test("workspace members can read lazy default policy; only owners and admins can change it", async () => {
  const stateDirectory = temporaryState();
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanups.push(registry.closeAll);
  const auth: LocalAuth = { handler: async () => new Response(null), getSession: async (request) => {
    const id = request.headers.get("cookie");
    return id ? { id, email: `${id}@example.com`, name: id } : null;
  } };
  const workspaceControl = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => workspaceId === "workspace_a" && ["owner", "admin", "member"].includes(userId) ? { id: workspaceId, name: "A", role: userId } : null,
    hasPendingStarterTemplateBootstrap: () => false,
  } as unknown as LocalWorkspaceControl;
  const application = createLocalApplication({ auth, stateDirectory, workspaceControl, productStoreRegistry: registry });
  const request = (method: string, role: string, settings?: unknown) => application(new Request("http://localhost/v1/workspaces/workspace_a/document-processing-settings", {
    method, headers: { ...(role ? { cookie: role } : {}), "content-type": "application/json" }, ...(settings === undefined ? {} : { body: JSON.stringify(settings) }),
  }));
  expect((await request("GET", "")).status).toBe(401);
  expect((await request("GET", "outsider")).status).toBe(403);
  for (const role of ["owner", "admin", "member"]) {
    const response = await request("GET", role);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ enable_smart_splitting: false, exclude_blank_pages: false });
  }
  expect(readdirSync(stateDirectory)).toEqual([]);
  const settings = { enable_smart_splitting: true, exclude_blank_pages: true };
  expect((await request("PUT", "member", settings)).status).toBe(403);
  expect((await request("PUT", "outsider", settings)).status).toBe(403);
  expect((await request("PUT", "owner", { enable_smart_splitting: true })).status).toBe(400);
  for (const role of ["owner", "admin"]) {
    expect((await request("PUT", role, settings)).status).toBe(200);
    expect(await (await request("GET", "member")).json()).toEqual(settings);
  }
  expect((await request("POST", "owner", settings)).status).toBe(405);
});
