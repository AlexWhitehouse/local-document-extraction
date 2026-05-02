import { nowIso } from "../lib/ids";
import type { Env, QueueJobMessage } from "../lib/types";

export async function processJob(message: QueueJobMessage, env: Env): Promise<void> {
  const job = await env.DB
    .prepare(
      `SELECT id, status
       FROM jobs
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(message.job_id, message.workspace_id)
    .first<{ id: string; status: string }>();

  if (!job) {
    return;
  }

  const workflowInstanceId = buildWorkflowInstanceId(message.job_id, message.attempt);
  const claim = await env.DB
    .prepare(
      `UPDATE jobs
       SET status = 'workflow_started',
           updated_at = ?,
           error_code = NULL,
           error_message = NULL,
           workflow_instance_id = ?
       WHERE id = ? AND status IN ('queued', 'retryable_failed', 'failed')`,
    )
    .bind(nowIso(), workflowInstanceId, message.job_id)
    .run();

  if ((claim.meta.changes || 0) === 0) {
    return;
  }

  try {
    await env.IMAGE_PROCESSING_WORKFLOW.create({
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
    await markRetryableFailed(env, message.job_id, "workflow_start_error", errorMessage(error));
    throw error;
  }
}

async function markRetryableFailed(env: Env, jobId: string, code: string, message: string): Promise<void> {
  await env.DB
    .prepare("UPDATE jobs SET status = 'retryable_failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?")
    .bind(code, message.slice(0, 2000), nowIso(), jobId)
    .run();
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
