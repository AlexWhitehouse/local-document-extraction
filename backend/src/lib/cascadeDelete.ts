import { nowIso } from "./ids";
import { getWorkspaceProductStore } from "./workspaceProductStoreClient";

const RESIDUAL_SOURCE_FILE_CLEANUP_BATCH_SIZE = 25;

export async function deleteWorkspaceCascade(env: Env, workspaceId: string): Promise<void> {
  const productStore = getWorkspaceProductStore(env, workspaceId);

  await deleteResidualWorkspaceSourceFiles(env, productStore);
  await productStore.eraseWorkspaceProductData();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM workspace_invitations WHERE workspace_id = ?").bind(workspaceId),
    env.DB.prepare("DELETE FROM workspace_memberships WHERE workspace_id = ?").bind(workspaceId),
    env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspaceId),
  ]);
}

async function deleteResidualWorkspaceSourceFiles(
  env: Env,
  productStore: ReturnType<typeof getWorkspaceProductStore>,
): Promise<void> {
  while (true) {
    const residualSourceFiles = await productStore.listResidualSourceFilesForCleanup({
      limit: RESIDUAL_SOURCE_FILE_CLEANUP_BATCH_SIZE,
    });
    if (residualSourceFiles.length === 0) {
      return;
    }

    await Promise.all(
      residualSourceFiles.map(async (sourceFile) => {
        await env.SOURCE_FILES_BUCKET.delete(sourceFile.source_file_key);
        await productStore.markSourceFileCleaned({
          jobId: sourceFile.job_id,
          sourceFileKey: sourceFile.source_file_key,
          cleanedAt: nowIso(),
        });
      }),
    );

    if (residualSourceFiles.length < RESIDUAL_SOURCE_FILE_CLEANUP_BATCH_SIZE) {
      return;
    }
  }
}
