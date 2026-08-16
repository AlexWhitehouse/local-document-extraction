import {
  createLocalWorkspaceProductStore,
  openLocalWorkspaceProductStore,
  type LocalWorkspaceProductStore,
} from "./localWorkspaceProductStore";

export type LocalWorkspaceProductStoreHandle = Omit<LocalWorkspaceProductStore, "close">;

export type LocalWorkspaceProductStoreLease = {
  store: LocalWorkspaceProductStoreHandle;
  release(): void;
};

export type LocalWorkspaceProductStoreRegistry = {
  acquire(input: {
    workspaceId: string;
    mode?: "create" | "existing";
  }): LocalWorkspaceProductStoreLease | null;
  closeAll(): void;
  diagnostics(): {
    activeLeases: number;
    invalidatedWorkspaces: number;
    maxOpenStores: number;
    openStores: number;
  };
  invalidate(input: { workspaceId: string }): Promise<void>;
};

export class LocalWorkspaceProductStoreRegistryError extends Error {
  constructor(
    public readonly code: "capacity_exhausted" | "workspace_invalidated",
    message: string,
  ) {
    super(message);
  }
}

type StoreEntry = {
  activeLeases: number;
  closeWaiters: Array<() => void>;
  invalidated: boolean;
  lastReleasedAt: number;
  store: LocalWorkspaceProductStore;
};

export function createLocalWorkspaceProductStoreRegistry({
  stateDirectory,
  maxOpenStores = 64,
  now = Date.now,
  createStore = createLocalWorkspaceProductStore,
  openStore = openLocalWorkspaceProductStore,
}: {
  stateDirectory: string;
  maxOpenStores?: number;
  now?: () => number;
  createStore?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  openStore?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore | null;
}): LocalWorkspaceProductStoreRegistry {
  const normalizedMaxOpenStores = Number.isSafeInteger(maxOpenStores) && maxOpenStores > 0
    ? maxOpenStores
    : 64;
  const entries = new Map<string, StoreEntry>();
  const invalidatedWorkspaces = new Set<string>();

  const closeEntry = (workspaceId: string, entry: StoreEntry) => {
    if (entries.get(workspaceId) !== entry) return;
    entries.delete(workspaceId);
    entry.store.close();
    for (const resolve of entry.closeWaiters.splice(0)) resolve();
  };

  const evictOneIdleStore = (): boolean => {
    let candidate: { workspaceId: string; entry: StoreEntry } | null = null;
    for (const [workspaceId, entry] of entries) {
      if (entry.activeLeases !== 0 || entry.invalidated) continue;
      if (!candidate || entry.lastReleasedAt < candidate.entry.lastReleasedAt) {
        candidate = { workspaceId, entry };
      }
    }
    if (!candidate) return false;
    closeEntry(candidate.workspaceId, candidate.entry);
    return true;
  };

  return {
    acquire: ({ workspaceId, mode = "create" }) => {
      if (invalidatedWorkspaces.has(workspaceId)) {
        throw new LocalWorkspaceProductStoreRegistryError(
          "workspace_invalidated",
          "Workspace product storage has been invalidated",
        );
      }

      let entry = entries.get(workspaceId);
      if (!entry) {
        while (entries.size >= normalizedMaxOpenStores && evictOneIdleStore()) {
          // Evict only as many idle owners as are needed for this acquisition.
        }
        if (entries.size >= normalizedMaxOpenStores) {
          throw new LocalWorkspaceProductStoreRegistryError(
            "capacity_exhausted",
            "Workspace product-store capacity is temporarily exhausted",
          );
        }
        const store = mode === "existing"
          ? openStore({ stateDirectory, workspaceId })
          : createStore({ stateDirectory, workspaceId });
        if (!store) return null;
        entry = {
          activeLeases: 0,
          closeWaiters: [],
          invalidated: false,
          lastReleasedAt: now(),
          store,
        };
        entries.set(workspaceId, entry);
      }

      entry.activeLeases += 1;
      let released = false;
      return {
        store: entry.store,
        release: () => {
          if (released) return;
          released = true;
          entry!.activeLeases -= 1;
          entry!.lastReleasedAt = now();
          if (entry!.invalidated && entry!.activeLeases === 0) {
            closeEntry(workspaceId, entry!);
          }
        },
      };
    },
    closeAll: () => {
      for (const [workspaceId, entry] of [...entries]) {
        closeEntry(workspaceId, entry);
      }
    },
    diagnostics: () => ({
      activeLeases: [...entries.values()].reduce((total, entry) => total + entry.activeLeases, 0),
      invalidatedWorkspaces: invalidatedWorkspaces.size,
      maxOpenStores: normalizedMaxOpenStores,
      openStores: entries.size,
    }),
    invalidate: async ({ workspaceId }) => {
      invalidatedWorkspaces.add(workspaceId);
      const entry = entries.get(workspaceId);
      if (!entry) return;
      entry.invalidated = true;
      if (entry.activeLeases === 0) {
        closeEntry(workspaceId, entry);
        return;
      }
      await new Promise<void>((resolve) => entry.closeWaiters.push(resolve));
    },
  };
}

export function createEphemeralLocalWorkspaceProductStoreRegistry({
  stateDirectory,
  createStore,
  openStore = (input) => createStore(input),
}: {
  stateDirectory: string;
  createStore: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore;
  openStore?: (input: { stateDirectory: string; workspaceId: string }) => LocalWorkspaceProductStore | null;
}): LocalWorkspaceProductStoreRegistry {
  return {
    acquire: ({ workspaceId, mode = "create" }) => {
      const store = mode === "existing"
        ? openStore({ stateDirectory, workspaceId })
        : createStore({ stateDirectory, workspaceId });
      if (!store) return null;
      let released = false;
      return {
        store,
        release: () => {
          if (released) return;
          released = true;
          store.close();
        },
      };
    },
    closeAll: () => {},
    diagnostics: () => ({ activeLeases: 0, invalidatedWorkspaces: 0, maxOpenStores: 0, openStores: 0 }),
    invalidate: async () => {},
  };
}

