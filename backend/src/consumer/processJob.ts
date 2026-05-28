import { nowIso } from "../lib/ids";
import type { QueueJobMessage } from "../lib/types";
import { getWorkspaceProductStore } from "../lib/workspaceProductStoreClient";

export async function processJob(message: QueueJobMessage, env: Env): Promise<void> {
  const productStore = getWorkspaceProductStore(env, message.workspace_id);
  const workflowInstanceId = buildWorkflowInstanceId(message.job_id, message.attempt);
  const started = await productStore.startExtractionWorkflow({
    jobId: message.job_id,
    attempt: message.attempt,
    startedAt: nowIso(),
    workflowInstanceId,
  });

  if (!started) {
    return;
  }

  try {
    await env.DOCUMENT_PROCESSING_WORKFLOW.create({
      id: workflowInstanceId,
      params: {
        job_id: message.job_id,
        workspace_id: message.workspace_id,
        attempt: message.attempt,
      },
    });
  } catch (error) {
    console.error("Workflow start failure", {
      job_id: message.job_id,
      workspace_id: message.workspace_id,
      error: errorMessage(error),
    });
    await productStore.noteExtractionWorkflowStartFailure({
      jobId: message.job_id,
      failedAt: nowIso(),
      errorCode: "workflow_start_error",
      errorMessage: errorMessage(error),
    });
    throw error;
  }
}

function buildWorkflowInstanceId(jobId: string, attempt: number): string {
  return `${jobId}-attempt-${attempt}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
