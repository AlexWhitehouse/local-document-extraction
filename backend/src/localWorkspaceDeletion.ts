import type { LocalSourceFileStore } from "./localSourceFileStore";
import { eraseLocalWorkspaceProductData } from "./localWorkspaceProductStore";
import type { LocalWorkspaceControl } from "./localWorkspaceControl";
import type { LocalWorkspaceProductOperations } from "./localWorkspaceProductOperations";
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
  onWorkspaceAccessRevoked,
}: {
  sourceFileStore: LocalSourceFileStore;
  stateDirectory: string;
  workspaceControl: LocalWorkspaceControl;
  workspaceProductOperations?: LocalWorkspaceProductOperations;
  onWorkspaceAccessRevoked?: (input: { workspaceId: string; reason: "workspace_access"; occurredAt: string }) => void;
}): LocalWorkspaceDeletion {
  return {
    async deleteWorkspace(input) {
      workspaceControl.assertWorkspaceDeletion(input);
      await workspaceProductOperations?.beginDeletion({ workspaceId: input.workspaceId });
      workspaceControl.recordWorkspaceDeletionIntent({ workspaceId: input.workspaceId });
      let accessRevoked = false;
      try {
        workspaceControl.deleteWorkspace(input);
        accessRevoked = true;
        onWorkspaceAccessRevoked?.({
          workspaceId: input.workspaceId,
          reason: "workspace_access",
          occurredAt: nowIso(),
        });
        await Promise.all([
          eraseLocalWorkspaceProductData({ stateDirectory, workspaceId: input.workspaceId }),
          sourceFileStore.eraseWorkspace(input.workspaceId),
        ]);
        workspaceControl.completeWorkspaceDeletionIntent({ workspaceId: input.workspaceId });
        workspaceProductOperations?.completeDeletion({ workspaceId: input.workspaceId });
      } catch (error) {
        if (!accessRevoked) {
          workspaceControl.completeWorkspaceDeletionIntent({ workspaceId: input.workspaceId });
        }
        workspaceProductOperations?.failDeletion({ workspaceId: input.workspaceId });
        throw error;
      }
    },
    async reconcileInterruptedDeletions() {
      for (const workspaceId of workspaceControl.listWorkspaceDeletionIntents()) {
        const accessRevoked = workspaceControl.revokeWorkspaceForDeletion({ workspaceId });
        if (accessRevoked) {
          onWorkspaceAccessRevoked?.({
            workspaceId,
            reason: "workspace_access",
            occurredAt: nowIso(),
          });
        }
        await Promise.all([
          eraseLocalWorkspaceProductData({ stateDirectory, workspaceId }),
          sourceFileStore.eraseWorkspace(workspaceId),
        ]);
        workspaceControl.completeWorkspaceDeletionIntent({ workspaceId });
        workspaceProductOperations?.completeDeletion({ workspaceId });
      }
    },
  };
}
