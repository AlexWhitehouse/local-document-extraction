import type { Database, SQLQueryBindings } from "bun:sqlite";

export type JobRetrySkipReason =
  | "not_found"
  | "not_failed"
  | "template_unavailable"
  | "source_unavailable"
  | "packet_unavailable";

export type RetriedExtractionJob = { job_id: string; template_id: string; template_version: number; attempt: number };

export type JobRetryResult = {
  retried: RetriedExtractionJob[];
  skipped: Array<{ job_id: string; reason: JobRetrySkipReason }>;
  /** Packets that failed only because of their children and are extracting again. */
  reopened_packet_ids: string[];
};

type RetryCandidate = {
  status: string;
  template_id: string | null;
  current_version: number | null;
  field_count: number;
  source_available: number;
  packet_id: string | null;
  packet_status: string | null;
  packet_error_code: string | null;
};

const FINISHED_PACKET_STATUSES = ["completed", "failed"];

/**
 * Moves failed jobs back to the queue on their Template's current version. The attempt counter
 * restarts, so the next claim is attempt 1 and recovery grants the full retry budget again.
 * A job needs its original: the local working copy, or a retained remote copy that processing restores.
 * A packet that failed only because of its children returns to extraction, so the child's
 * completion settles it again. Call inside one write transaction.
 */
export function retryFailedJobs(
  database: Database,
  { jobIds, retriedAt }: { jobIds: readonly string[]; retriedAt: string },
): JobRetryResult {
  const result: JobRetryResult = { retried: [], skipped: [], reopened_packet_ids: [] };

  const read = database.query<RetryCandidate, SQLQueryBindings[]>(
    `SELECT j.status, t.id AS template_id, t.current_version,
       (SELECT COUNT(*) FROM template_fields f WHERE f.template_id = t.id AND f.version = t.current_version) AS field_count,
       (s.job_id IS NOT NULL AND (s.deleted_at IS NULL OR s.retained_key IS NOT NULL)) AS source_available,
       p.id AS packet_id, p.status AS packet_status, p.error_code AS packet_error_code
     FROM jobs j
     LEFT JOIN templates t ON t.id = j.template_id AND t.status = 'active' AND t.deleted_at IS NULL
     LEFT JOIN source_files s ON s.job_id = j.id
     LEFT JOIN document_packet_children c ON c.job_id = j.id AND c.state <> 'deleted'
     LEFT JOIN document_packets p ON p.id = c.packet_id
     WHERE j.id = ?`,
  );

  const reopenPacket = database.query(
    `UPDATE document_packets SET status = 'processing_children', updated_at = ?
     WHERE id = ? AND status = 'failed' AND error_code IS NULL`,
  );

  const requeue = database.query(
    `UPDATE jobs SET status = 'queued', template_version = ?, error_code = NULL, error_message = NULL,
       next_retry_at = NULL, current_attempt = 0, updated_at = ?
     WHERE id = ? AND status = 'failed'`,
  );

  const skip = (jobId: string, reason: JobRetrySkipReason) => result.skipped.push({ job_id: jobId, reason });

  for (const jobId of jobIds) {
    const job = read.get(jobId);

    if (!job) skip(jobId, "not_found");
    else if (job.status !== "failed") skip(jobId, "not_failed");
    else if (job.template_id === null || job.current_version === null || job.field_count < 1)
      skip(jobId, "template_unavailable");
    else if (!job.source_available) skip(jobId, "source_unavailable");
    else if (
      job.packet_id !== null &&
      FINISHED_PACKET_STATUSES.includes(job.packet_status ?? "") &&
      (job.packet_status !== "failed" || job.packet_error_code !== null)
    )
      // The packet itself failed, or finished without this child; its outcome can't be reopened.
      skip(jobId, "packet_unavailable");
    else if (requeue.run(job.current_version, retriedAt, jobId).changes < 1) skip(jobId, "not_failed");
    else {
      if (job.packet_id !== null && reopenPacket.run(retriedAt, job.packet_id).changes > 0)
        result.reopened_packet_ids.push(job.packet_id);

      result.retried.push({
        job_id: jobId,
        template_id: job.template_id,
        template_version: job.current_version,
        attempt: 1,
      });
    }
  }

  return result;
}
