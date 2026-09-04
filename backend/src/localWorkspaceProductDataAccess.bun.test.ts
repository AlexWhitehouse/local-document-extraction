import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalWorkspaceProductDataAccess, LocalWorkspaceProductDataAccessError } from "./localWorkspaceProductDataAccess";
import { createLocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import { createLocalWorkspaceProductStoreRegistry, LocalWorkspaceProductStoreRegistryError } from "./localWorkspaceProductStoreRegistry";

const fixtures: Array<{ stateDirectory: string; registry: ReturnType<typeof createLocalWorkspaceProductStoreRegistry> }> = [];
async function fixture() {
  const stateDirectory = await mkdtemp(join(tmpdir(), "workspace-product-access-"));
  const operations = createLocalWorkspaceProductOperations();
  const registry = createLocalWorkspaceProductStoreRegistry({ stateDirectory, maxOpenStores: 1 });
  fixtures.push({ stateDirectory, registry });
  return { stateDirectory, operations, registry, access: createLocalWorkspaceProductDataAccess({ operations, registry }) };
}

afterEach(async () => {
  for (const { stateDirectory, registry } of fixtures.splice(0)) {
    registry.closeAll();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function expectDeletionDrained(operations: ReturnType<typeof createLocalWorkspaceProductOperations>, workspaceId: string) {
  let drained = false;
  const deletion = operations.beginDeletion({ workspaceId }).then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(true);
  await deletion;
}

test("access returns callback results and releases storage capacity and admitted work", async () => {
  const { access, operations } = await fixture();
  const result = { accepted: true };
  expect(await access.run({ workspaceId: "first", mode: "create" }, ({ store, signal }) => {
    expect(signal.aborted).toBe(false);
    store.ensureStarterInvoiceTemplate({ createdAt: "2026-09-04T12:00:00Z" });
    return result;
  })).toBe(result);
  expect(await access.run({ workspaceId: "second", mode: "create" }, ({ store }) => store.listTemplates())).toEqual([]);
  expect(await access.run({ workspaceId: "first", mode: "existing" }, ({ store }) => store?.listTemplates().length)).toBe(1);
  await expectDeletionDrained(operations, "first");
  await expectDeletionDrained(operations, "second");
});

test("existing-only absence runs the callback without creating storage and still participates in deletion", async () => {
  const { access, operations, stateDirectory } = await fixture();
  const finish = deferred();
  let signal!: AbortSignal;
  const running = access.run({ workspaceId: "absent", mode: "existing" }, async (context) => {
    expect(context.store).toBeNull();
    signal = context.signal;
    await finish.promise;
    return "unconfigured";
  });
  let drained = false;
  const deletion = operations.beginDeletion({ workspaceId: "absent" }).then(() => { drained = true; });
  try {
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(stat(join(stateDirectory, "data", "workspaces", "absent.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    finish.resolve();
    expect(await running).toBe("unconfigured");
    await deletion;
  }
});

test.each(["throw", "reject"])("callback %s preserves the original error and releases both resources", async (kind) => {
  const { access, operations } = await fixture();
  // Even an error with an acquisition-related type must not be reclassified
  // when it originates in the callback.
  const failure = new LocalWorkspaceProductStoreRegistryError("capacity_exhausted", "Callback failure");
  await expect(access.run({ workspaceId: "failed", mode: "create" }, () => {
    if (kind === "throw") throw failure;
    return Promise.reject(failure);
  })).rejects.toBe(failure);
  await expect(access.run({ workspaceId: "next", mode: "create" }, ({ store }) => store.listTemplates())).resolves.toEqual([]);
  await expectDeletionDrained(operations, "failed");
});

test("capacity rejection releases partial admission and never enters the callback", async () => {
  const { access, operations } = await fixture();
  const finish = deferred();
  const holding = access.run({ workspaceId: "busy", mode: "create" }, async () => { await finish.promise; });
  let entered = false;
  try {
    await expect(access.run({ workspaceId: "blocked", mode: "create" }, () => { entered = true; })).rejects.toMatchObject({
      name: "LocalWorkspaceProductDataAccessError", code: "capacity_exhausted",
    });
    expect(entered).toBe(false);
    await expectDeletionDrained(operations, "blocked");
  } finally {
    finish.resolve();
    await holding;
  }
});

test.each(["Workspace", "Document"])("%s deletion cancels access but waits for callback settlement before releasing its lease", async (kind) => {
  const { access, operations } = await fixture();
  const finish = deferred();
  const scope = { workspaceId: "deleting", jobId: "job", mode: "create" as const };
  let signal!: AbortSignal;
  const running = access.run(scope, async (context) => {
    signal = context.signal;
    await finish.promise;
    // An abort must not close storage while admitted work is still unwinding.
    return context.store.listTemplates();
  });
  let drained = false;
  const deletion = (kind === "Workspace"
    ? operations.beginDeletion(scope)
    : operations.beginDocumentDeletion(scope)).then(() => { drained = true; });
  let entered = false;
  try {
    expect(signal.aborted).toBe(true);
    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(access.run(scope, () => { entered = true; })).rejects.toMatchObject({
      code: kind === "Workspace" ? "workspace_deleting" : "job_deleting",
    });
    expect(entered).toBe(false);
    await expect(access.run({ workspaceId: "other", mode: "create" }, () => {})).rejects.toMatchObject({ code: "capacity_exhausted" });
  } finally {
    finish.resolve();
    expect(await running).toEqual([]);
    await deletion;
  }
  await expect(access.run({ workspaceId: "other", mode: "create" }, ({ store }) => store.listTemplates())).resolves.toEqual([]);
});

test("invalidated storage stays closed and a rejected access does not strand deletion", async () => {
  const { access, operations, registry } = await fixture();
  await access.run({ workspaceId: "erased", mode: "create" }, () => {});
  await registry.invalidate({ workspaceId: "erased" });
  let entered = false;
  await expect(access.run({ workspaceId: "erased", mode: "create" }, () => { entered = true; })).rejects.toMatchObject({ code: "workspace_invalidated" });
  expect(entered).toBe(false);
  await expectDeletionDrained(operations, "erased");
});

test("unexpected acquisition failures retain their cause and unwind admission", async () => {
  const { operations, registry } = await fixture();
  const cause = new Error("Cannot open storage");
  const access = createLocalWorkspaceProductDataAccess({ operations, registry: { ...registry, acquire: () => { throw cause; } } });
  let entered = false;
  await expect(access.run({ workspaceId: "failed", mode: "create" }, () => { entered = true; })).rejects.toEqual(
    new LocalWorkspaceProductDataAccessError("unexpected", "Workspace product data access failed", { cause }),
  );
  expect(entered).toBe(false);
  await expectDeletionDrained(operations, "failed");
});

test("creation-enabled access never supplies a missing store to the callback", async () => {
  const { operations, registry } = await fixture();
  const access = createLocalWorkspaceProductDataAccess({ operations, registry: { ...registry, acquire: () => null } });
  let entered = false;
  await expect(access.run({ workspaceId: "missing", mode: "create" }, () => { entered = true; })).rejects.toMatchObject({ code: "store_unavailable" });
  expect(entered).toBe(false);
  await expectDeletionDrained(operations, "missing");
});

test.each([false, true])("lease release failure drains admission and preserves an existing callback failure (%s)", async (callbackFails) => {
  const { operations, registry } = await fixture();
  const failure = new Error("Store release failed");
  const access = createLocalWorkspaceProductDataAccess({ operations, registry: {
    ...registry,
    acquire: (scope) => {
      const lease = registry.acquire(scope)!;
      return { store: lease.store, release: () => { lease.release(); throw failure; } };
    },
  } });
  const callbackFailure = new Error("Product work failed");
  await expect(access.run({ workspaceId: "release", mode: "create" }, () => {
    if (callbackFails) throw callbackFailure;
  })).rejects.toBe(callbackFails ? callbackFailure : failure);
  await expectDeletionDrained(operations, "release");
});
