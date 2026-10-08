export type LocalWorkspaceConcurrencyLimits = {
  /** The Workspace's concurrent extraction limit, read from product data at most once until invalidated. */
  get(workspaceId: string): number;
  /** Forget a Workspace's limit after its model configuration is saved or cleared, or it is deleted. */
  invalidate(workspaceId: string): void;
  clear(): void;
};

/**
 * The queue consults the limit on every scheduler pass, so it must not open SQLite there.
 * A failed or unavailable read is not cached: the conservative limit applies until a later
 * pass reads the configuration successfully.
 */
export function createLocalWorkspaceConcurrencyLimits({
  read,
  unavailableLimit = 1,
}: {
  /** The limit from Workspace product data, or null when the Workspace has no product data. */
  read(workspaceId: string): number | null;
  unavailableLimit?: number;
}): LocalWorkspaceConcurrencyLimits {
  const limits = new Map<string, number>();

  return {
    get: (workspaceId) => {
      const cached = limits.get(workspaceId);

      if (cached !== undefined) return cached;

      let limit: number | null;

      try {
        limit = read(workspaceId);
      } catch {
        return unavailableLimit;
      }

      if (limit === null) return unavailableLimit;
      limits.set(workspaceId, limit);

      return limit;
    },
    invalidate: (workspaceId) => {
      limits.delete(workspaceId);
    },
    clear: () => limits.clear(),
  };
}
