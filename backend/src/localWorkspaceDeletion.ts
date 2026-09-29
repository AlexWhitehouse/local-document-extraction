import type { LocalSourceFileStore } from "./localSourceFileStore";
import { eraseLocalWorkspaceProductData } from "./localWorkspaceProductStore";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
import type { LocalWorkspaceProductStoreRegistry } from "./localWorkspaceProductStoreRegistry";
import { nowIso } from "./lib/ids";

export type LocalWorkspaceDeletion = {
  deleteWorkspace(input: { workspaceId: string; userId: string }): Promise<void>;
  reconcileInterruptedDeletions(): Promise<void>;
};

export function createLocalWorkspaceDeletion({
  sourceFileStore,
  stateDirectory,
  workspaceControl,
  workspaceProductOperations,
  productStoreRegistry,
  onWorkspaceAccessRevoked,
}: {
  sourceFileStore: LocalSourceFileStore;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
  productStoreRegistry?: LocalWorkspaceProductStoreRegistry;
  onWorkspaceAccessRevoked?: (input: { workspaceId: string; reason: "workspace_access"; occurredAt: string }) => void;
}): LocalWorkspaceDeletion {
  const announceAccessRevoked = (workspaceId: string) =>
    onWorkspaceAccessRevoked?.({ workspaceId, reason: "workspace_access", occurredAt: nowIso() });
  const eraseRevokedWorkspace = async (workspaceId: string) => {
    await productStoreRegistry?.invalidate({ workspaceId });
    await Promise.all([
      eraseLocalWorkspaceProductData({ stateDirectory, workspaceId }),
      sourceFileStore.eraseWorkspace(workspaceId),
    ]);
    workspaceControl.completeWorkspaceDeletionIntent({ workspaceId });
    workspaceProductOperations?.completeDeletion({ workspaceId });
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
        // Re-checks ownership: membership may have changed while in-flight work drained.
        workspaceControl.deleteWorkspace(input);
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
