import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApplication } from "./localApplication";
import { createLocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import type { LocalAuth } from "./localAuth";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const dates = "start=2026-01-01&end=2027-01-01&unit=day";
function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), "costs-http-"));
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory });
  cleanup.push(() => { registry.closeAll(); rmSync(stateDirectory, { recursive: true, force: true }); });
  let revoked = false;
  const auth: LocalAuth = { handler: async () => new Response(null), getSession: async request => {
    const id = request.headers.get("cookie"); return id ? { id, email: `${id}@example.com`, name: id } : null;
  } };
  const control = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) => !revoked && workspaceId === "allowed" && ["owner", "admin", "member"].includes(userId) ? { id: workspaceId, role: userId } : null,
    hasPendingStarterTemplateBootstrap: () => false,
  } as unknown as LocalWorkspaceControl;
  const app = createLocalApplication({ auth, stateDirectory, workspaceControl: control, productStoreRegistry: registry });
  const request = (resource = `overview?${dates}`, headers: Record<string, string> = { cookie: "owner" }, method = "GET", workspace = "allowed") => app(new Request(`http://localhost/v1/workspaces/${workspace}/costs/${resource}`, { headers, method }));
  return { stateDirectory, registry, request, revoke: () => { revoked = true; } };
}

test("all cost resources require an owner/admin session, including deleted detail; authorization precedes opening a store", async () => {
  const f = fixture();
  for (const resource of [`overview?${dates}`, `documents?${dates}`, "documents/deleted"]) {
    expect((await f.request(resource, {})).status).toBe(401);
    expect((await f.request(resource, { authorization: "Bearer workspace-api-key" })).status).toBe(401);
    expect((await f.request(resource, { cookie: "member" })).status).toBe(403);
    expect((await f.request(resource, { cookie: "outsider" })).status).toBe(403);
    expect((await f.request(resource, { cookie: "owner" }, "GET", "other")).status).toBe(403);
  }
  expect(readdirSync(f.stateDirectory)).toEqual([]);
  for (const role of ["owner", "admin"]) {
    const response = await f.request(undefined, { cookie: role });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data.totals.documents).toBe(0); expect(data.buckets.length).toBe(365);
  }
  f.revoke(); expect((await f.request()).status).toBe(403);
});

test("cost API rejects unbounded ranges and malformed filters/cursors and supports empty or missing details", async () => {
  const f = fixture();
  for (const path of ["overview", "overview?start=2000-01-01&end=2027-01-01&unit=day", `documents?${dates}&sort=invalid`, `documents?${dates}&kind=invalid`, `documents?${dates}&cursor=bad`, `documents?${dates}&search=${"x".repeat(201)}`]) expect((await f.request(path)).status).toBe(400);
  expect((await f.request(undefined, { cookie: "owner" }, "POST")).status).toBe(405);
  expect((await f.request("documents/missing")).status).toBe(404);
  const page = await f.request(`documents?${dates}&sort=total&kind=multi`);
  expect(page.status).toBe(200);
  expect(await page.json()).toMatchObject({ items: [], cursor: null });
});
