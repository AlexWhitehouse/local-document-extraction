import type { LocalSourceFileStore } from "./localSourceFileStore";
import type { LocalSourceObjectManifest } from "./localSourceObjectManifest";
import { eraseLocalWorkspaceProductData } from "./localWorkspaceProductStore";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { nowIso } from "./lib/ids";

export type LocalWorkspaceDeletion = {
  deleteWorkspace(input: { workspaceId: string; userId: string; assertAuthorized?: () => void; commit?: (work: () => void) => void }): Promise<void>;
  reconcileInterruptedDeletions(): Promise<void>;
};

export function createLocalWorkspaceDeletion({
  sourceFileStore,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
  productStoreRegistry,
  sourceObjectManifest,
  onWorkspaceAccessRevoked,
  onWorkspaceErased,
}: {
  sourceFileStore: LocalSourceFileStore;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
  productStoreRegistry?: LocalWorkspaceProductStoreRegistry;
  /** Remote originals are released to background cleanup; logical deletion never waits on remote storage. */
  sourceObjectManifest?: Pick<LocalSourceObjectManifest, "markWorkspaceDeleting">;
  onWorkspaceAccessRevoked?: (input: { workspaceId: string; reason: "workspace_access"; occurredAt: string }) => void;
  /** Runs once the Workspace's product data and Source files have been erased. */
  onWorkspaceErased?: (workspaceId: string) => void;
}): LocalWorkspaceDeletion {
  const announceAccessRevoked = (workspaceId: string) =>
    onWorkspaceAccessRevoked?.({ workspaceId, reason: "workspace_access", occurredAt: nowIso() });

  const eraseRevokedWorkspace = async (workspaceId: string) => {
    await productStoreRegistry?.invalidate({ workspaceId });
    // Every remote object already has a manifest entry, so this covers them all before product data goes.
    sourceObjectManifest?.markWorkspaceDeleting({ workspaceId });
    await Promise.all([
      eraseLocalWorkspaceProductData({ stateDirectory, workspaceId }),
      sourceFileStore.eraseWorkspace(workspaceId),
    ]);
    workspaceControl.completeWorkspaceDeletionIntent({ workspaceId });
    workspaceProductOperations?.completeDeletion({ workspaceId });
    onWorkspaceErased?.(workspaceId);
  };

  return {
    async deleteWorkspace(input) {
      const { workspaceId } = input;
      workspaceControl.assertWorkspaceDeletion(input);
      await workspaceProductOperations?.beginDeletion({ workspaceId });
      // The intent survives a crash after access is revoked so startup can finish the erase.
      workspaceControl.recordWorkspaceDeletionIntent({ workspaceId });
      let accessRevoked = false;

      try {
        input.assertAuthorized?.();

        // Re-checks ownership: membership may have changed while in-flight work drained.
        if (input.commit) input.commit(() => workspaceControl.deleteWorkspace(input));
        else workspaceControl.deleteWorkspace(input);
        accessRevoked = true;
        announceAccessRevoked(workspaceId);
        await eraseRevokedWorkspace(workspaceId);
      } catch (error) {
        if (!accessRevoked) workspaceControl.completeWorkspaceDeletionIntent({ workspaceId });
        workspaceProductOperations?.failDeletion({ workspaceId });
        throw error;
      }
    },
    async reconcileInterruptedDeletions() {
      for (const workspaceId of workspaceControl.listWorkspaceDeletionIntents()) {
        if (workspaceControl.revokeWorkspaceForDeletion({ workspaceId })) announceAccessRevoked(workspaceId);
        await eraseRevokedWorkspace(workspaceId);
      }
    },
  };
}
