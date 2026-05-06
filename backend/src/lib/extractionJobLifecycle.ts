export type QueuedExtractionJobInput = {
  jobId: string;
  workspaceId: string;
  templateId: string;
  templateVersion: number;
  sourceFileKey: string;
  sourceMimeType: string;
  sourceName: string | null;
  submittedAt: string;
};

export type QueuedExtractionJob = {
  jobId: string;
  status: "queued";
  sourceName: string | null;
  templateId: string;
  templateVersion: number;
};

export type ClaimExtractionJobForProcessingInput = {
  jobId: string;
  attempt: number;
  claimedAt: string;
};

export type CompletedExtractionResult = {
  field_id: string;
  status: string;
  answer: unknown;
  normalized_value: string | null;
  confidence: number | null;
  evidence: string | null;
};

export type CompleteExtractionJobInput = {
  jobId: string;
  attempt: number;
  completedAt: string;
  modelName: string;
  route: string;
  results: CompletedExtractionResult[];
};

export type FailExtractionJobInput = {
  jobId: string;
  attempt: number;
  failedAt: string;
  errorCode: string;
  errorMessage: string;
};

export async function createQueuedExtractionJob(
  db: D1Database,
  input: QueuedExtractionJobInput,
): Promise<QueuedExtractionJob> {
  await db
    .prepare(
      `INSERT INTO jobs (
        id, workspace_id, template_id, template_version, status,
        source_file_key, source_mime_type, source_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.jobId,
      input.workspaceId,
      input.templateId,
      input.templateVersion,
      input.sourceFileKey,
      input.sourceMimeType,
      input.sourceName,
      input.submittedAt,
      input.submittedAt,
    )
    .run();

  return {
    jobId: input.jobId,
    status: "queued",
    sourceName: input.sourceName,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
  };
}

export async function claimExtractionJobForProcessing(
  db: D1Database,
  input: ClaimExtractionJobForProcessingInput,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs
         SET status = 'processing',
             updated_at = ?,
             error_code = NULL,
             error_message = NULL,
             workflow_started_at = ?,
             current_attempt = ?
         WHERE id = ? AND status = 'queued' AND current_attempt < ?`,
    )
    .bind(
      input.claimedAt,
      input.claimedAt,
      input.attempt,
      input.jobId,
      input.attempt,
    )
    .run();

  return (result.meta.changes || 0) > 0;
}

export async function completeExtractionJob(
  db: D1Database,
  input: CompleteExtractionJobInput,
): Promise<boolean> {
  const job = await db
    .prepare("SELECT status, current_attempt FROM jobs WHERE id = ?")
    .bind(input.jobId)
    .first<{ status: string; current_attempt: number | null }>();
  if (
    !job ||
    job.status !== "processing" ||
    Number(job.current_attempt || 0) !== input.attempt
  ) {
    return false;
  }

  const writes = input.results.map((row) =>
    db
      .prepare(
        `INSERT INTO job_results (
             job_id, field_id, status, answer_json, normalized_value, confidence, evidence_text, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(job_id, field_id)
           DO UPDATE SET
             status = excluded.status,
             answer_json = excluded.answer_json,
             normalized_value = excluded.normalized_value,
             confidence = excluded.confidence,
             evidence_text = excluded.evidence_text,
             updated_at = excluded.updated_at`,
      )
      .bind(
        input.jobId,
        row.field_id,
        row.status,
        JSON.stringify(row.answer),
        row.normalized_value,
        row.confidence,
        row.evidence,
        input.completedAt,
        input.completedAt,
      ),
  );

  writes.push(
    db
      .prepare(
        `UPDATE jobs
           SET status = 'completed',
               completed_at = ?,
               updated_at = ?,
               model_name = ?,
               ai_gateway_route = ?,
               prompt_version = 'v1',
               schema_version = 'v1',
               completed_attempt = ?
           WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
      )
      .bind(
        input.completedAt,
        input.completedAt,
        input.modelName,
        input.route,
        input.attempt,
        input.jobId,
        input.attempt,
      ),
  );

  const results = await db.batch(writes);
  const completion = results.at(-1);
  return Boolean(completion && (completion.meta.changes || 0) > 0);
}

export async function failExtractionJob(
  db: D1Database,
  input: FailExtractionJobInput,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs
         SET status = 'failed',
             error_code = ?,
             error_message = ?,
             updated_at = ?,
             last_failed_attempt = ?
         WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
    )
    .bind(
      input.errorCode,
      input.errorMessage.slice(0, 2000),
      input.failedAt,
      input.attempt,
      input.jobId,
      input.attempt,
    )
    .run();

  return (result.meta.changes || 0) > 0;
}
