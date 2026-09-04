import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import {
  createLocalWorkspaceProductStore,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";
import {
  createLocalWorkspaceProductStoreRegistry,
  LocalWorkspaceProductStoreRegistryError,
} from "./localWorkspaceProductStoreRegistry";

test("the Workspace product-store registry reuses one owner and evicts only idle owners", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-store-registry-"));
  let opened = 0;
  let closed = 0;
  let clock = 0;
  const createStore = (input: { stateDirectory: string; workspaceId: string }): LocalWorkspaceProductStore => {
    opened += 1;
    const store = createLocalWorkspaceProductStore(input);
    return {
      ...store,
      close: () => {
        closed += 1;
        store.close();
      },
    };
  };
  const registry = createLocalWorkspaceProductStoreRegistry({
    stateDirectory,
    maxOpenStores: 2,
    now: () => ++clock,
    createStore,
  });

  try {
    const first = registry.acquire({ workspaceId: "workspace_one" })!;
    const concurrent = registry.acquire({ workspaceId: "workspace_one" })!;
    expect(first.store).toBe(concurrent.store);
    expect(registry.diagnostics()).toMatchObject({ activeLeases: 2, openStores: 1 });
    first.release();
    concurrent.release();

    const second = registry.acquire({ workspaceId: "workspace_two" })!;
    second.release();
    expect(opened).toBe(2);
    expect(closed).toBe(0);

    const third = registry.acquire({ workspaceId: "workspace_three" })!;
    third.release();
    expect(opened).toBe(3);
    expect(closed).toBe(1);
    expect(registry.diagnostics()).toMatchObject({ activeLeases: 0, openStores: 2 });
  } finally {
    registry.closeAll();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("registry invalidation waits for leases, closes once, and prevents reopening", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-store-invalidation-"));
  let closed = 0;
  const registry = createLocalWorkspaceProductStoreRegistry({
    stateDirectory,
    createStore: (input) => {
      const store = createLocalWorkspaceProductStore(input);
      return {
        ...store,
        close: () => {
          closed += 1;
          store.close();
        },
      };
    },
  });

  try {
    const lease = registry.acquire({ workspaceId: "workspace_delete" })!;
    let invalidated = false;
    const invalidation = registry.invalidate({ workspaceId: "workspace_delete" }).then(() => {
      invalidated = true;
    });
    await Promise.resolve();
    expect(invalidated).toBe(false);
    expect(closed).toBe(0);

    lease.release();
    await invalidation;
    expect(invalidated).toBe(true);
    expect(closed).toBe(1);
    expect(() => registry.acquire({ workspaceId: "workspace_delete" })).toThrow(
      LocalWorkspaceProductStoreRegistryError,
    );
  } finally {
    registry.closeAll();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("critical pressure evicts idle owners without closing an actively leased store", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-store-pressure-"));
  const closedWorkspaces: string[] = [];
  const registry = createLocalWorkspaceProductStoreRegistry({
    stateDirectory,
    createStore: (input) => {
      const store = createLocalWorkspaceProductStore(input);
      return {
        ...store,
        close: () => {
          closedWorkspaces.push(input.workspaceId);
          store.close();
        },
      };
    },
  });

  try {
    const active = registry.acquire({ workspaceId: "workspace_active" })!;
    const idle = registry.acquire({ workspaceId: "workspace_idle" })!;
    idle.release();

    expect(registry.evictIdleStores()).toBe(1);
    expect(closedWorkspaces).toEqual(["workspace_idle"]);
    expect(registry.diagnostics()).toMatchObject({ activeLeases: 1, openStores: 1 });
    expect(active.store.diagnostics().foreignKeys).toBe(true);

    active.release();
    expect(registry.evictIdleStores()).toBe(1);
    expect(closedWorkspaces).toEqual(["workspace_idle", "workspace_active"]);
    expect(registry.diagnostics()).toMatchObject({ activeLeases: 0, openStores: 0 });
  } finally {
    registry.closeAll();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});

test("Workspace product stores apply the safe SQLite policy and focused indexes", async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "document-extraction-store-policy-"));
  const workspaceId = "workspace_policy";
  const store = createLocalWorkspaceProductStore({ stateDirectory, workspaceId });
  try {
    expect(store.diagnostics()).toMatchObject({
      busyTimeoutMs: 250,
      foreignKeys: true,
      journalMode: "delete",
      synchronous: 2,
    });
    expect(store.diagnostics().sqliteVersion).toMatch(/^\d+\.\d+\.\d+$/);
  } finally {
    store.close();
  }

  const database = new Database(join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`));
  try {
    const indexes = new Set(
      (database.query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    expect(indexes.has("idx_jobs_active_updated_id")).toBe(true);
    expect(indexes.has("idx_jobs_status_updated")).toBe(false);
    expect(indexes.has("idx_source_files_job")).toBe(false);
    expect(indexes.has("idx_job_results_job")).toBe(false);
    expect(database.query("SELECT version FROM product_schema_version ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
    ]);
  } finally {
    database.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
});
