import { describe, expect, it } from "vitest";

import {
  claimExtractionJobForProcessing,
  completeExtractionJob,
  createQueuedExtractionJob,
  failExtractionJob,
} from "./extractionJobLifecycle";

type JobRow = {
  id: string;
  workspace_id: string;
  template_id: string;
  template_version: number;
  status: string;
  source_file_key: string;
  source_mime_type: string;
  source_name: string | null;
  created_at: string;
  updated_at: string;
  workflow_started_at?: string;
  current_attempt?: number;
  completed_at?: string;
  completed_attempt?: number;
  model_name?: string;
  ai_gateway_route?: string;
  error_code?: string | null;
  error_message?: string | null;
  last_failed_attempt?: number;
};

type ResultRow = {
  job_id: string;
  field_id: string;
  status: string;
  answer_json: string;
  normalized_value: string | null;
  confidence: number | null;
  evidence_text: string | null;
  created_at: string;
  updated_at: string;
};

function createLifecycleFixture() {
  const jobs: JobRow[] = [];
  const results: ResultRow[] = [];
  const db = {
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM jobs")) {
                const [jobId] = params;
                const job = jobs.find((candidate) => candidate.id === jobId);
                return job
                  ? {
                      status: job.status,
                      current_attempt: job.current_attempt ?? 0,
                    }
                  : null;
              }

              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async run() {
              if (sql.includes("INSERT INTO jobs")) {
                const [
                  id,
                  workspaceId,
                  templateId,
                  templateVersion,
                  sourceFileKey,
                  sourceMimeType,
                  sourceName,
                  createdAt,
                  updatedAt,
                ] = params;
                jobs.push({
                  id: String(id),
                  workspace_id: String(workspaceId),
                  template_id: String(templateId),
                  template_version: Number(templateVersion),
                  status: "queued",
                  source_file_key: String(sourceFileKey),
                  source_mime_type: String(sourceMimeType),
                  source_name: sourceName === null ? null : String(sourceName),
                  created_at: String(createdAt),
                  updated_at: String(updatedAt),
                });
                return { meta: { changes: 1 } };
              }

              if (sql.includes("SET status = 'processing'")) {
                const [updatedAt, workflowStartedAt, attempt, jobId, maxAttempt] = params;
                const job = jobs.find((candidate) => candidate.id === jobId);
                if (job && job.status === "queued" && Number(job.current_attempt ?? 0) < Number(maxAttempt)) {
                  job.status = "processing";
                  job.updated_at = String(updatedAt);
                  job.workflow_started_at = String(workflowStartedAt);
                  job.current_attempt = Number(attempt);
                  job.error_code = null;
                  job.error_message = null;
                  return { meta: { changes: 1 } };
                }

                return { meta: { changes: 0 } };
              }

              if (sql.includes("INSERT INTO job_results")) {
                const [
                  jobId,
                  fieldId,
                  status,
                  answerJson,
                  normalizedValue,
                  confidence,
                  evidenceText,
                  createdAt,
                  updatedAt,
                ] = params;
                const existing = results.find(
                  (result) => result.job_id === jobId && result.field_id === fieldId,
                );
                const row = {
                  job_id: String(jobId),
                  field_id: String(fieldId),
                  status: String(status),
                  answer_json: String(answerJson),
                  normalized_value: normalizedValue === null ? null : String(normalizedValue),
                  confidence: confidence === null ? null : Number(confidence),
                  evidence_text: evidenceText === null ? null : String(evidenceText),
                  created_at: String(createdAt),
                  updated_at: String(updatedAt),
                };
                if (existing) {
                  Object.assign(existing, row, { created_at: existing.created_at });
                } else {
                  results.push(row);
                }
                return { meta: { changes: 1 } };
              }

              if (sql.includes("SET status = 'completed'")) {
                const [completedAt, updatedAt, modelName, route, attempt, jobId, currentAttempt] = params;
                const job = jobs.find((candidate) => candidate.id === jobId);
                if (job && job.status === "processing" && job.current_attempt === Number(currentAttempt)) {
                  job.status = "completed";
                  job.completed_at = String(completedAt);
                  job.updated_at = String(updatedAt);
                  job.model_name = String(modelName);
                  job.ai_gateway_route = String(route);
                  job.completed_attempt = Number(attempt);
                  return { meta: { changes: 1 } };
                }

                return { meta: { changes: 0 } };
              }

              if (sql.includes("SET status = 'failed'")) {
                const [errorCode, errorMessage, failedAt, attempt, jobId, currentAttempt] = params;
                const job = jobs.find((candidate) => candidate.id === jobId);
                if (job && job.status === "processing" && job.current_attempt === Number(currentAttempt)) {
                  job.status = "failed";
                  job.error_code = String(errorCode);
                  job.error_message = String(errorMessage);
                  job.updated_at = String(failedAt);
                  job.completed_at = undefined;
                  job.completed_attempt = undefined;
                  job.model_name = undefined;
                  job.ai_gateway_route = undefined;
                  job.last_failed_attempt = Number(attempt);
                  return { meta: { changes: 1 } };
                }

                return { meta: { changes: 0 } };
              }

              throw new Error(`Unhandled run SQL: ${sql}`);
            },
          };
        },
      };
    },
  } as D1Database;

  return { db, jobs, results };
}

describe("Extraction job lifecycle", () => {
  it("creates a queued Extraction job with the selected Template version", async () => {
    const { db, jobs } = createLifecycleFixture();

    const queued = await createQueuedExtractionJob(db, {
      jobId: "job_test",
      workspaceId: "workspace_test",
      templateId: "template_test",
      templateVersion: 3,
      sourceFileKey: "workspaces/workspace_test/jobs/job_test/source.pdf",
      sourceMimeType: "application/pdf",
      sourceName: "invoice.pdf",
      submittedAt: "2026-05-06T12:00:00.000Z",
    });

    expect(queued).toEqual({
      jobId: "job_test",
      status: "queued",
      sourceName: "invoice.pdf",
      templateId: "template_test",
      templateVersion: 3,
    });
    expect(jobs).toEqual([
      expect.objectContaining({
        id: "job_test",
        workspace_id: "workspace_test",
        template_id: "template_test",
        template_version: 3,
        status: "queued",
      }),
    ]);
  });

  it("claims an eligible Extraction job for processing", async () => {
    const { db, jobs } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "queued",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:00:00.000Z",
      current_attempt: 0,
      error_code: "previous_error",
      error_message: "Previous error",
    });

    const claimed = await claimExtractionJobForProcessing(db, {
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });

    expect(claimed).toBe(true);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        id: "job_test",
        status: "processing",
        current_attempt: 1,
        error_code: null,
        error_message: null,
        updated_at: "2026-05-06T12:01:00.000Z",
        workflow_started_at: "2026-05-06T12:01:00.000Z",
      }),
    );
  });

  it("does not claim workflow metadata as a durable Extraction job lifecycle state", async () => {
    const { db, jobs } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "workflow_started",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:00:00.000Z",
      current_attempt: 0,
    });

    const claimed = await claimExtractionJobForProcessing(db, {
      jobId: "job_test",
      attempt: 1,
      claimedAt: "2026-05-06T12:01:00.000Z",
    });

    expect(claimed).toBe(false);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "workflow_started",
        current_attempt: 0,
      }),
    );
  });

  it("does not claim terminal Extraction jobs for later processing attempts", async () => {
    const { db, jobs } = createLifecycleFixture();
    jobs.push(
      {
        id: "completed_job",
        workspace_id: "workspace_test",
        template_id: "template_test",
        template_version: 3,
        status: "completed",
        source_file_key: "workspaces/workspace_test/jobs/completed_job/source.pdf",
        source_mime_type: "application/pdf",
        source_name: "completed.pdf",
        created_at: "2026-05-06T12:00:00.000Z",
        updated_at: "2026-05-06T12:02:00.000Z",
        current_attempt: 1,
        completed_at: "2026-05-06T12:02:00.000Z",
        completed_attempt: 1,
      },
      {
        id: "failed_job",
        workspace_id: "workspace_test",
        template_id: "template_test",
        template_version: 3,
        status: "failed",
        source_file_key: "workspaces/workspace_test/jobs/failed_job/source.pdf",
        source_mime_type: "application/pdf",
        source_name: "failed.pdf",
        created_at: "2026-05-06T12:00:00.000Z",
        updated_at: "2026-05-06T12:02:00.000Z",
        current_attempt: 1,
        error_code: "processing_error",
        error_message: "Model returned invalid output",
        last_failed_attempt: 1,
      },
    );

    const completedClaimed = await claimExtractionJobForProcessing(db, {
      jobId: "completed_job",
      attempt: 2,
      claimedAt: "2026-05-06T12:03:00.000Z",
    });
    const failedClaimed = await claimExtractionJobForProcessing(db, {
      jobId: "failed_job",
      attempt: 2,
      claimedAt: "2026-05-06T12:03:00.000Z",
    });

    expect(completedClaimed).toBe(false);
    expect(failedClaimed).toBe(false);
    expect(jobs).toEqual([
      expect.objectContaining({
        id: "completed_job",
        status: "completed",
        current_attempt: 1,
        completed_attempt: 1,
      }),
      expect.objectContaining({
        id: "failed_job",
        status: "failed",
        current_attempt: 1,
        last_failed_attempt: 1,
      }),
    ]);
  });

  it("completes a processing Extraction job with durable Extraction results", async () => {
    const { db, jobs, results } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "processing",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
      current_attempt: 1,
    });

    const completed = await completeExtractionJob(db, {
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:02:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Ada Lovelace",
          normalized_value: "Ada Lovelace",
          confidence: 0.97,
          evidence: "Patient: Ada Lovelace",
        },
        {
          field_id: "invoice_total",
          status: "not_found",
          answer: null,
          normalized_value: null,
          confidence: null,
          evidence: null,
        },
      ],
    });

    expect(completed).toBe(true);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        template_version: 3,
        completed_at: "2026-05-06T12:02:00.000Z",
        completed_attempt: 1,
      }),
    );
    expect(results).toEqual([
      expect.objectContaining({
        job_id: "job_test",
        field_id: "patient_name",
        status: "ok",
        answer_json: JSON.stringify("Ada Lovelace"),
        normalized_value: "Ada Lovelace",
        confidence: 0.97,
        evidence_text: "Patient: Ada Lovelace",
      }),
      expect.objectContaining({
        job_id: "job_test",
        field_id: "invoice_total",
        status: "not_found",
        answer_json: JSON.stringify(null),
        normalized_value: null,
      }),
    ]);
  });

  it("ignores stale completion attempts without persisting Extraction results", async () => {
    const { db, jobs, results } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "processing",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
      current_attempt: 2,
    });

    const completed = await completeExtractionJob(db, {
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:02:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Ada Lovelace",
          normalized_value: "Ada Lovelace",
          confidence: null,
          evidence: null,
        },
      ],
    });

    expect(completed).toBe(false);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "processing",
        current_attempt: 2,
      }),
    );
    expect(results).toEqual([]);
  });

  it("rejects duplicate completion attempts after an Extraction job is terminal", async () => {
    const { db, jobs, results } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "completed",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:02:00.000Z",
      completed_at: "2026-05-06T12:02:00.000Z",
      current_attempt: 1,
      completed_attempt: 1,
    });

    const completed = await completeExtractionJob(db, {
      jobId: "job_test",
      attempt: 1,
      completedAt: "2026-05-06T12:03:00.000Z",
      modelName: "google/gemini-3-flash",
      route: "default",
      results: [
        {
          field_id: "patient_name",
          status: "ok",
          answer: "Grace Hopper",
          normalized_value: "Grace Hopper",
          confidence: null,
          evidence: null,
        },
      ],
    });

    expect(completed).toBe(false);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        completed_at: "2026-05-06T12:02:00.000Z",
        completed_attempt: 1,
      }),
    );
    expect(results).toEqual([]);
  });

  it("fails a processing Extraction job with durable error information", async () => {
    const { db, jobs } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "processing",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:01:00.000Z",
      current_attempt: 1,
    });

    const failed = await failExtractionJob(db, {
      jobId: "job_test",
      attempt: 1,
      failedAt: "2026-05-06T12:02:00.000Z",
      errorCode: "processing_error",
      errorMessage: "Model returned invalid output",
    });

    expect(failed).toBe(true);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        error_code: "processing_error",
        error_message: "Model returned invalid output",
        updated_at: "2026-05-06T12:02:00.000Z",
        last_failed_attempt: 1,
      }),
    );
  });

  it("rejects stale failure attempts without overwriting newer lifecycle state", async () => {
    const { db, jobs } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "processing",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:02:00.000Z",
      current_attempt: 2,
      error_code: null,
      error_message: null,
    });

    const failed = await failExtractionJob(db, {
      jobId: "job_test",
      attempt: 1,
      failedAt: "2026-05-06T12:03:00.000Z",
      errorCode: "processing_error",
      errorMessage: "Stale workflow attempt failed later",
    });

    expect(failed).toBe(false);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "processing",
        current_attempt: 2,
        updated_at: "2026-05-06T12:02:00.000Z",
        error_code: null,
        error_message: null,
      }),
    );
  });

  it("rejects duplicate failure attempts after an Extraction job is terminal", async () => {
    const { db, jobs } = createLifecycleFixture();
    jobs.push({
      id: "job_test",
      workspace_id: "workspace_test",
      template_id: "template_test",
      template_version: 3,
      status: "failed",
      source_file_key: "workspaces/workspace_test/jobs/job_test/source.pdf",
      source_mime_type: "application/pdf",
      source_name: "invoice.pdf",
      created_at: "2026-05-06T12:00:00.000Z",
      updated_at: "2026-05-06T12:02:00.000Z",
      current_attempt: 1,
      error_code: "processing_error",
      error_message: "Model returned invalid output",
      last_failed_attempt: 1,
    });

    const failed = await failExtractionJob(db, {
      jobId: "job_test",
      attempt: 1,
      failedAt: "2026-05-06T12:03:00.000Z",
      errorCode: "missing_source_file",
      errorMessage: "Source file is missing from storage",
    });

    expect(failed).toBe(false);
    expect(jobs[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        updated_at: "2026-05-06T12:02:00.000Z",
        error_code: "processing_error",
        error_message: "Model returned invalid output",
        last_failed_attempt: 1,
      }),
    );
  });

  it("stops safely when failing a missing Extraction job", async () => {
    const { db, jobs } = createLifecycleFixture();

    const failed = await failExtractionJob(db, {
      jobId: "missing_job",
      attempt: 1,
      failedAt: "2026-05-06T12:02:00.000Z",
      errorCode: "missing_job",
      errorMessage: "Extraction job is missing or no longer belongs to the Workspace",
    });

    expect(failed).toBe(false);
    expect(jobs).toEqual([]);
  });
});
