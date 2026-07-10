import { existsSync, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import type { FieldDefinition } from "./lib/types";

export type LocalWorkspaceTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  current_version: number;
  created_at: string;
  updated_at: string;
};

export type LocalWorkspaceTemplateDetail = LocalWorkspaceTemplate & {
  fields: Array<FieldDefinition & { position: number }>;
};

export type LocalWorkspaceSubmissionTemplate = {
  template_id: string;
  template_version: number;
};

export type LocalQueuedExtractionJob = {
  job_id: string;
  status: "queued";
  source_name: string | null;
  template_id: string;
  template_version: number;
};

export type LocalWorkspaceExtractionJobSummary = {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  source_name: string | null;
  source_mime_type: string;
  source_file_page_count: number | null;
  template_id: string;
  template_version: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  current_attempt: number;
  completed_attempt: number;
  last_failed_attempt: number;
};

export type LocalWorkspaceExtractionResult = {
  field_id: string;
  name: string;
  data_type: FieldDefinition["data_type"];
  status: string;
  answer: unknown;
  confidence: number | null;
  evidence: string | null;
};

export type LocalWorkspaceExtractionJob = LocalWorkspaceExtractionJobSummary & {
  results: LocalWorkspaceExtractionResult[];
};

export type LocalClaimedExtractionJob = {
  job_id: string;
  template_id: string;
  template_version: number;
  source_file_key: string;
  source_mime_type: string;
  fields: FieldDefinition[];
};

export type LocalScheduledExtractionJob = {
  job_id: string;
  template_id: string;
  template_version: number;
  attempt: number;
};

export type DeletedLocalWorkspaceExtractionJob = {
  job_id: string;
  source_file_key: string;
  status: "queued" | "processing" | "completed" | "failed";
};

export type LocalWorkspaceProductStore = {
  close(): void;
  createTemplate(input: {
    templateId: string;
    name: string;
    description: string | null;
    fields: FieldDefinition[];
    createdAt: string;
  }): { template_id: string; version: 1; status: "active" };
  updateTemplate(input: {
    templateId: string;
    name?: string;
    description?: string | null;
    fields?: FieldDefinition[];
    updatedAt: string;
  }): { template_id: string; version: number; status: "active" } | null;
  deleteTemplate(input: { templateId: string; deletedAt: string }): boolean;
  ensureStarterInvoiceTemplate(input: { createdAt: string }): void;
  createQueuedExtractionJob(input: {
    jobId: string;
    templateId: string;
    templateVersion: number;
    sourceFileKey: string;
    sourceMimeType: string;
    sourceName: string | null;
    sourceFilePageCount: number | null;
    submittedAt: string;
  }): LocalQueuedExtractionJob;
  failQueuedExtractionJob(input: {
    jobId: string;
    failedAt: string;
    errorCode: string;
    errorMessage: string;
  }): boolean;
  claimExtractionJobForProcessing(input: {
    jobId: string;
    attempt: number;
    claimedAt: string;
  }): LocalClaimedExtractionJob | null;
  completeExtractionJob(input: {
    jobId: string;
    attempt: number;
    completedAt: string;
    modelName: string;
    route: string;
    results: Array<{
      field_id: string;
      status: string;
      answer: unknown;
      normalized_value: string | null;
      confidence: number | null;
      evidence: string | null;
    }>;
  }): boolean;
  failExtractionJob(input: {
    jobId: string;
    attempt: number;
    failedAt: string;
    errorCode: string;
    errorMessage: string;
  }): boolean;
  requeueExtractionJob(input: {
    jobId: string;
    attempt: number;
    requeuedAt: string;
    errorCode: string;
    errorMessage: string;
  }): boolean;
  recoverExtractionJobs(input: {
    maxAttempts: number;
    recoveredAt: string;
    staleProcessingBefore: string;
  }): LocalScheduledExtractionJob[];
  getTemplate(templateId: string): LocalWorkspaceTemplateDetail | null;
  deleteExtractionJob(input: { jobId: string }): DeletedLocalWorkspaceExtractionJob | null;
  getExtractionJob(jobId: string): LocalWorkspaceExtractionJob | null;
  getSubmissionTemplate(templateId: string): LocalWorkspaceSubmissionTemplate | null;
  listTemplates(): LocalWorkspaceTemplate[];
  countExtractionJobs(): number;
  listExtractionJobs(input?: {
    cursor?: { createdAt: string; jobId: string } | null;
    limit?: number;
    search?: string;
  }): LocalWorkspaceExtractionJobSummary[];
  markSourceFileCleaned(input: { jobId: string; sourceFileKey: string; cleanedAt: string }): boolean;
};

export function createLocalWorkspaceProductStore({
  stateDirectory,
  workspaceId,
}: {
  stateDirectory: string;
  workspaceId: string;
}): LocalWorkspaceProductStore {
  return initializeLocalWorkspaceProductStore({ stateDirectory, workspaceId });
}

export function initializeLocalWorkspaceProductStore({
  stateDirectory,
  workspaceId,
}: {
  stateDirectory: string;
  workspaceId: string;
}): LocalWorkspaceProductStore {
  const databasePath = workspaceProductDatabasePath({ stateDirectory, workspaceId });
  mkdirSync(join(stateDirectory, "data", "workspaces"), { recursive: true });
  return createProductStore(new Database(databasePath));
}

export function openLocalWorkspaceProductStore({
  stateDirectory,
  workspaceId,
}: {
  stateDirectory: string;
  workspaceId: string;
}): LocalWorkspaceProductStore | null {
  const databasePath = workspaceProductDatabasePath({ stateDirectory, workspaceId });
  if (!existsSync(databasePath)) {
    return null;
  }
  return createProductStore(new Database(databasePath));
}

export async function eraseLocalWorkspaceProductData({
  stateDirectory,
  workspaceId,
}: {
  stateDirectory: string;
  workspaceId: string;
}): Promise<void> {
  const databasePath = workspaceProductDatabasePath({ stateDirectory, workspaceId });
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-journal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ]);
}

function workspaceProductDatabasePath({ stateDirectory, workspaceId }: { stateDirectory: string; workspaceId: string }): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId)) {
    throw new Error("Workspace ID contains unsupported characters for local product storage.");
  }
  return join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`);
}

function createProductStore(database: Database): LocalWorkspaceProductStore {
  database.exec(PRODUCT_SCHEMA);
  ensureProductSchemaColumns(database);

  return {
    close: () => database.close(),
    createTemplate: (input) => createTemplate(database, input),
    updateTemplate: (input) => updateTemplate(database, input),
    deleteTemplate: (input) => deleteTemplate(database, input),
    ensureStarterInvoiceTemplate: (input) => ensureStarterInvoiceTemplate(database, input),
    createQueuedExtractionJob: (input) => createQueuedExtractionJob(database, input),
    failQueuedExtractionJob: (input) => failQueuedExtractionJob(database, input),
    claimExtractionJobForProcessing: (input) => claimExtractionJobForProcessing(database, input),
    completeExtractionJob: (input) => completeExtractionJob(database, input),
    failExtractionJob: (input) => failExtractionJob(database, input),
    requeueExtractionJob: (input) => requeueExtractionJob(database, input),
    recoverExtractionJobs: (input) => recoverExtractionJobs(database, input),
    getTemplate: (templateId) => getTemplate(database, templateId),
    deleteExtractionJob: (input) => deleteExtractionJob(database, input),
    getExtractionJob: (jobId) => getExtractionJob(database, jobId),
    getSubmissionTemplate: (templateId) => getSubmissionTemplate(database, templateId),
    listTemplates: () => listTemplates(database),
    countExtractionJobs: () => countExtractionJobs(database),
    listExtractionJobs: (input) => listExtractionJobs(database, input),
    markSourceFileCleaned: (input) => markSourceFileCleaned(database, input),
  };
}

function ensureProductSchemaColumns(database: Database): void {
  const jobColumns = database.query("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  const knownColumns = new Set(jobColumns.map((column) => column.name));
  if (!knownColumns.has("model_name")) {
    database.exec("ALTER TABLE jobs ADD COLUMN model_name TEXT");
  }
  if (!knownColumns.has("model_gateway_route")) {
    database.exec("ALTER TABLE jobs ADD COLUMN model_gateway_route TEXT");
  }
  if (!knownColumns.has("next_retry_at")) {
    database.exec("ALTER TABLE jobs ADD COLUMN next_retry_at TEXT");
  }
}

function ensureStarterInvoiceTemplate(database: Database, input: { createdAt: string }): void {
  const existing = database.query("SELECT id FROM templates WHERE id = ? LIMIT 1").get("tpl_starter_invoice");
  if (existing) {
    return;
  }

  createTemplate(database, {
    templateId: "tpl_starter_invoice",
    name: "Example Invoice",
    description: "Starter template that extracts key invoice fields for quick testing.",
    fields: STARTER_INVOICE_FIELDS,
    createdAt: input.createdAt,
  });
}

function createTemplate(
  database: Database,
  input: {
    templateId: string;
    name: string;
    description: string | null;
    fields: FieldDefinition[];
    createdAt: string;
  },
): { template_id: string; version: 1; status: "active" } {
  const create = database.transaction(() => {
    database.query(
      `INSERT INTO templates (id, name, description, status, current_version, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'active', 1, ?, ?, NULL)`,
    ).run(input.templateId, input.name, input.description, input.createdAt, input.createdAt);

    const insertField = database.query(
      `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, position)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
    );
    input.fields.forEach((field, position) => {
      insertField.run(
        input.templateId,
        field.id,
        field.name,
        field.description,
        field.data_type,
        position,
      );
    });
  });
  create();

  return { template_id: input.templateId, version: 1, status: "active" };
}

function listTemplates(database: Database): LocalWorkspaceTemplate[] {
  return database.query(
    `SELECT id, name, description, status, current_version, created_at, updated_at
     FROM templates
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC`,
  ).all() as LocalWorkspaceTemplate[];
}

function getTemplate(database: Database, templateId: string): LocalWorkspaceTemplateDetail | null {
  const template = database.query(
    `SELECT id, name, description, status, current_version, created_at, updated_at
     FROM templates
     WHERE id = ? AND deleted_at IS NULL`,
  ).get(templateId) as LocalWorkspaceTemplate | null;

  if (!template) {
    return null;
  }

  const fields = database.query(
    `SELECT field_id AS id, name, description, data_type, position
     FROM template_fields
     WHERE template_id = ? AND version = ?
     ORDER BY position ASC`,
  ).all(templateId, template.current_version) as Array<FieldDefinition & { position: number }>;

  return { ...template, fields };
}

function updateTemplate(
  database: Database,
  input: {
    templateId: string;
    name?: string;
    description?: string | null;
    fields?: FieldDefinition[];
    updatedAt: string;
  },
): { template_id: string; version: number; status: "active" } | null {
  const existing = database.query(
    `SELECT id, name, description, current_version
     FROM templates
     WHERE id = ? AND deleted_at IS NULL`,
  ).get(input.templateId) as Pick<LocalWorkspaceTemplate, "id" | "name" | "description" | "current_version"> | null;

  if (!existing) {
    return null;
  }

  const nextVersion = input.fields ? existing.current_version + 1 : existing.current_version;
  const nextName = input.name ?? existing.name;
  const nextDescription = input.description !== undefined ? input.description : existing.description;
  const update = database.transaction(() => {
    database.query(
      `UPDATE templates
       SET name = ?, description = ?, current_version = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(nextName, nextDescription, nextVersion, input.updatedAt, input.templateId);

    if (input.fields) {
      const insertField = database.query(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      input.fields.forEach((field, position) => {
        insertField.run(
          input.templateId,
          nextVersion,
          field.id,
          field.name,
          field.description,
          field.data_type,
          position,
        );
      });
    }
  });
  update();

  return { template_id: input.templateId, version: nextVersion, status: "active" };
}

function deleteTemplate(
  database: Database,
  input: { templateId: string; deletedAt: string },
): boolean {
  const result = database.query(
    `UPDATE templates
     SET status = 'deleted', deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
  ).run(input.deletedAt, input.deletedAt, input.templateId);

  return result.changes > 0;
}

function getSubmissionTemplate(
  database: Database,
  templateId: string,
): LocalWorkspaceSubmissionTemplate | null {
  const template = database.query(
    `SELECT id, current_version
     FROM templates
     WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
  ).get(templateId) as { id: string; current_version: number } | null;
  if (!template) {
    return null;
  }

  const fieldCount = database.query(
    `SELECT COUNT(*) AS count
     FROM template_fields
     WHERE template_id = ? AND version = ?`,
  ).get(template.id, template.current_version) as { count: number };
  if (fieldCount.count < 1) {
    return null;
  }

  return { template_id: template.id, template_version: template.current_version };
}

function createQueuedExtractionJob(
  database: Database,
  input: {
    jobId: string;
    templateId: string;
    templateVersion: number;
    sourceFileKey: string;
    sourceMimeType: string;
    sourceName: string | null;
    sourceFilePageCount: number | null;
    submittedAt: string;
  },
): LocalQueuedExtractionJob {
  const create = database.transaction(() => {
    database.query(
      `INSERT INTO source_files (key, job_id, mime_type, name, page_count, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      input.sourceFileKey,
      input.jobId,
      input.sourceMimeType,
      input.sourceName,
      input.sourceFilePageCount,
      input.submittedAt,
    );
    database.query(
      `INSERT INTO jobs (
         id, template_id, template_version, status,
         source_file_key, source_mime_type, source_name,
         created_at, updated_at, completed_at, error_code, error_message,
         current_attempt, completed_attempt, last_failed_attempt
       ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, 0)`,
    ).run(
      input.jobId,
      input.templateId,
      input.templateVersion,
      input.sourceFileKey,
      input.sourceMimeType,
      input.sourceName,
      input.submittedAt,
      input.submittedAt,
    );
  });
  create();

  return {
    job_id: input.jobId,
    status: "queued",
    source_name: input.sourceName,
    template_id: input.templateId,
    template_version: input.templateVersion,
  };
}

function failQueuedExtractionJob(
  database: Database,
  input: { jobId: string; failedAt: string; errorCode: string; errorMessage: string },
): boolean {
  const fail = database.transaction(() => {
    const result = database.query(
      `UPDATE jobs
       SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = 1
       WHERE id = ? AND status = 'queued'`,
    ).run(input.errorCode, input.errorMessage.slice(0, 2000), input.failedAt, input.jobId);
    if (result.changes > 0) {
      database.query(
        "UPDATE source_files SET deleted_at = ? WHERE job_id = ? AND deleted_at IS NULL",
      ).run(input.failedAt, input.jobId);
    }
    return result.changes > 0;
  });
  return fail();
}

function claimExtractionJobForProcessing(
  database: Database,
  input: { jobId: string; attempt: number; claimedAt: string },
): LocalClaimedExtractionJob | null {
  const claim = database.transaction(() => {
    const job = database.query(
      `SELECT id, template_id, template_version, source_file_key, source_mime_type, status, current_attempt
       FROM jobs
       WHERE id = ?`,
    ).get(input.jobId) as {
      id: string;
      template_id: string;
      template_version: number;
      source_file_key: string;
      source_mime_type: string;
      status: string;
      current_attempt: number;
    } | null;
    if (!job || job.status !== "queued" || job.current_attempt >= input.attempt) {
      return null;
    }

    const result = database.query(
      `UPDATE jobs
       SET status = 'processing', updated_at = ?, error_code = NULL, error_message = NULL, next_retry_at = NULL, current_attempt = ?
       WHERE id = ? AND status = 'queued' AND current_attempt < ?`,
    ).run(input.claimedAt, input.attempt, input.jobId, input.attempt);
    if (result.changes < 1) {
      return null;
    }

    const fields = database.query(
      `SELECT field_id AS id, name, description, data_type
       FROM template_fields
       WHERE template_id = ? AND version = ?
       ORDER BY position ASC`,
    ).all(job.template_id, job.template_version) as FieldDefinition[];

    return {
      job_id: job.id,
      template_id: job.template_id,
      template_version: job.template_version,
      source_file_key: job.source_file_key,
      source_mime_type: job.source_mime_type,
      fields,
    };
  });
  return claim();
}

function completeExtractionJob(
  database: Database,
  input: {
    jobId: string;
    attempt: number;
    completedAt: string;
    modelName: string;
    route: string;
    results: Array<{
      field_id: string;
      status: string;
      answer: unknown;
      normalized_value: string | null;
      confidence: number | null;
      evidence: string | null;
    }>;
  },
): boolean {
  const complete = database.transaction(() => {
    const job = database.query(
      "SELECT status, current_attempt FROM jobs WHERE id = ?",
    ).get(input.jobId) as { status: string; current_attempt: number } | null;
    if (!job || job.status !== "processing" || job.current_attempt !== input.attempt) {
      return false;
    }

    const insertResult = database.query(
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
    );
    input.results.forEach((row) => {
      insertResult.run(
        input.jobId,
        row.field_id,
        row.status,
        JSON.stringify(row.answer),
        row.normalized_value,
        row.confidence,
        row.evidence,
        input.completedAt,
        input.completedAt,
      );
    });

    const result = database.query(
      `UPDATE jobs
       SET status = 'completed', completed_at = ?, updated_at = ?, model_name = ?, model_gateway_route = ?, completed_attempt = ?
       WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
    ).run(
      input.completedAt,
      input.completedAt,
      input.modelName,
      input.route,
      input.attempt,
      input.jobId,
      input.attempt,
    );
    return result.changes > 0;
  });
  return complete();
}

function failExtractionJob(
  database: Database,
  input: { jobId: string; attempt: number; failedAt: string; errorCode: string; errorMessage: string },
): boolean {
  const result = database.query(
    `UPDATE jobs
     SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = ?
     WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
  ).run(
    input.errorCode,
    input.errorMessage.slice(0, 2000),
    input.failedAt,
    input.attempt,
    input.jobId,
    input.attempt,
  );
  return result.changes > 0;
}

function requeueExtractionJob(
  database: Database,
  input: { jobId: string; attempt: number; requeuedAt: string; errorCode: string; errorMessage: string },
): boolean {
  const result = database.query(
    `UPDATE jobs
     SET status = 'queued', error_code = ?, error_message = ?, updated_at = ?, next_retry_at = NULL, last_failed_attempt = ?
     WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
  ).run(
    input.errorCode,
    input.errorMessage.slice(0, 2000),
    input.requeuedAt,
    input.attempt,
    input.jobId,
    input.attempt,
  );
  return result.changes > 0;
}

function recoverExtractionJobs(
  database: Database,
  input: { maxAttempts: number; recoveredAt: string; staleProcessingBefore: string },
): LocalScheduledExtractionJob[] {
  const recover = database.transaction(() => {
    const scheduled: LocalScheduledExtractionJob[] = [];
    const queued = database.query(
      `SELECT id, template_id, template_version, current_attempt
       FROM jobs
       WHERE status = 'queued'
       ORDER BY updated_at ASC, id ASC`,
    ).all() as Array<{ id: string; template_id: string; template_version: number; current_attempt: number }>;
    for (const job of queued) {
      if (job.current_attempt >= input.maxAttempts) {
        database.query(
          `UPDATE jobs
           SET status = 'failed', error_code = 'retry_exhausted', error_message = 'Extraction retry limit reached', updated_at = ?, last_failed_attempt = ?
           WHERE id = ? AND status = 'queued'`,
        ).run(input.recoveredAt, job.current_attempt, job.id);
        continue;
      }
      scheduled.push({
        job_id: job.id,
        template_id: job.template_id,
        template_version: job.template_version,
        attempt: job.current_attempt + 1,
      });
    }

    const stale = database.query(
      `SELECT id, template_id, template_version, current_attempt
       FROM jobs
       WHERE status = 'processing' AND updated_at <= ?
       ORDER BY updated_at ASC, id ASC`,
    ).all(input.staleProcessingBefore) as Array<{ id: string; template_id: string; template_version: number; current_attempt: number }>;
    for (const job of stale) {
      if (job.current_attempt >= input.maxAttempts) {
        database.query(
          `UPDATE jobs
           SET status = 'failed', error_code = 'retry_exhausted', error_message = 'Extraction retry limit reached', updated_at = ?, last_failed_attempt = ?
           WHERE id = ? AND status = 'processing'`,
        ).run(input.recoveredAt, job.current_attempt, job.id);
        continue;
      }
      const result = database.query(
        `UPDATE jobs
         SET status = 'queued', error_code = 'stale_processing', error_message = 'Recovered stale processing job', updated_at = ?, next_retry_at = NULL, last_failed_attempt = ?
         WHERE id = ? AND status = 'processing'`,
      ).run(input.recoveredAt, job.current_attempt, job.id);
      if (result.changes > 0) {
        scheduled.push({
          job_id: job.id,
          template_id: job.template_id,
          template_version: job.template_version,
          attempt: job.current_attempt + 1,
        });
      }
    }
    return scheduled;
  });
  return recover();
}

function deleteExtractionJob(
  database: Database,
  input: { jobId: string },
): DeletedLocalWorkspaceExtractionJob | null {
  const remove = database.transaction(() => {
    const job = database.query(
      "SELECT id, status, source_file_key FROM jobs WHERE id = ? LIMIT 1",
    ).get(input.jobId) as { id: string; status: string; source_file_key: string } | null;
    if (!job) {
      return null;
    }
    database.query("DELETE FROM job_results WHERE job_id = ?").run(job.id);
    database.query("DELETE FROM source_files WHERE job_id = ?").run(job.id);
    database.query("DELETE FROM jobs WHERE id = ?").run(job.id);
    return {
      job_id: job.id,
      source_file_key: job.source_file_key,
      status: job.status as DeletedLocalWorkspaceExtractionJob["status"],
    } as DeletedLocalWorkspaceExtractionJob;
  });
  return remove();
}

function getExtractionJob(database: Database, jobId: string): LocalWorkspaceExtractionJob | null {
  const summary = readExtractionJobSummary(database, jobId);
  if (!summary) {
    return null;
  }

  const results = database.query(
    `SELECT r.field_id, f.name, f.data_type, r.status, r.answer_json, r.confidence, r.evidence_text
     FROM job_results r
     JOIN jobs j ON j.id = r.job_id
     JOIN template_fields f ON f.template_id = j.template_id
       AND f.version = j.template_version
       AND f.field_id = r.field_id
     WHERE r.job_id = ?
     ORDER BY f.position ASC`,
  ).all(jobId) as Array<{
    field_id: string;
    name: string;
    data_type: FieldDefinition["data_type"];
    status: string;
    answer_json: string | null;
    confidence: number | null;
    evidence_text: string | null;
  }>;

  return {
    ...summary,
    results: results.map((result) => ({
      field_id: result.field_id,
      name: result.name,
      data_type: result.data_type,
      status: result.status,
      answer: parseStoredAnswer(result.answer_json),
      confidence: result.confidence,
      evidence: result.evidence_text,
    })),
  };
}

function countExtractionJobs(database: Database): number {
  return (database.query("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
}

function listExtractionJobs(
  database: Database,
  input: {
    cursor?: { createdAt: string; jobId: string } | null;
    limit?: number;
    search?: string;
  } = {},
): LocalWorkspaceExtractionJobSummary[] {
  const select = `SELECT j.id AS job_id, j.status, j.source_name, j.source_mime_type,
                         s.page_count AS source_file_page_count, j.template_id, j.template_version,
                         j.error_code, j.error_message, j.created_at, j.updated_at, j.completed_at,
                         j.current_attempt, j.completed_attempt, j.last_failed_attempt
                  FROM jobs j
                  JOIN source_files s ON s.job_id = j.id`;
  const search = String(input.search || "").trim().toLowerCase();
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(`(LOWER(COALESCE(j.source_name, '')) LIKE ? ESCAPE '\\'
        OR LOWER(j.id) LIKE ? ESCAPE '\\'
        OR LOWER(j.template_id) LIKE ? ESCAPE '\\'
        OR LOWER(j.status) LIKE ? ESCAPE '\\')`);
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (input.cursor) {
    clauses.push("(j.created_at < ? OR (j.created_at = ? AND j.id < ?))");
    parameters.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.jobId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = Number.isSafeInteger(input.limit) && input.limit! > 0
    ? ` LIMIT ${input.limit}`
    : "";
  return database.query(
    `${select}${where} ORDER BY j.created_at DESC, j.id DESC${limit}`,
  ).all(...parameters) as LocalWorkspaceExtractionJobSummary[];
}

function markSourceFileCleaned(
  database: Database,
  input: { jobId: string; sourceFileKey: string; cleanedAt: string },
): boolean {
  const result = database.query(
    `UPDATE source_files
     SET deleted_at = COALESCE(deleted_at, ?)
     WHERE job_id = ? AND key = ?`,
  ).run(input.cleanedAt, input.jobId, input.sourceFileKey);
  return result.changes > 0;
}

function readExtractionJobSummary(database: Database, jobId: string): LocalWorkspaceExtractionJobSummary | null {
  return database.query(
    `SELECT j.id AS job_id, j.status, j.source_name, j.source_mime_type,
            s.page_count AS source_file_page_count, j.template_id, j.template_version,
            j.error_code, j.error_message, j.created_at, j.updated_at, j.completed_at,
            j.current_attempt, j.completed_attempt, j.last_failed_attempt
     FROM jobs j
     JOIN source_files s ON s.job_id = j.id
     WHERE j.id = ?`,
  ).get(jobId) as LocalWorkspaceExtractionJobSummary | null;
}

function parseStoredAnswer(answerJson: string | null): unknown {
  if (answerJson === null) {
    return null;
  }
  try {
    return JSON.parse(answerJson);
  } catch {
    return null;
  }
}

const PRODUCT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS product_schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
    current_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS template_fields (
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    field_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'date', 'object', 'array', 'array<object>')),
    position INTEGER NOT NULL,
    PRIMARY KEY (template_id, version, field_id)
  );

  CREATE INDEX IF NOT EXISTS idx_templates_deleted_created
    ON templates(deleted_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_template_fields_template_version_position
    ON template_fields(template_id, version, position);

  CREATE TABLE IF NOT EXISTS source_files (
    key TEXT PRIMARY KEY,
    job_id TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    name TEXT,
    page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_source_files_job
    ON source_files(job_id);

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    source_file_key TEXT NOT NULL,
    source_mime_type TEXT NOT NULL,
    source_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    error_code TEXT,
    error_message TEXT,
    current_attempt INTEGER NOT NULL DEFAULT 0,
    completed_attempt INTEGER NOT NULL DEFAULT 0,
    last_failed_attempt INTEGER NOT NULL DEFAULT 0,
    model_name TEXT,
    model_gateway_route TEXT,
    next_retry_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status_updated
    ON jobs(status, updated_at);

  CREATE TABLE IF NOT EXISTS job_results (
    job_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    status TEXT NOT NULL,
    answer_json TEXT,
    normalized_value TEXT,
    confidence REAL,
    evidence_text TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (job_id, field_id)
  );

  CREATE INDEX IF NOT EXISTS idx_job_results_job
    ON job_results(job_id);
`;

const STARTER_INVOICE_FIELDS: FieldDefinition[] = [
  { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
  { id: "invoice_date", name: "Invoice Date", description: "Date shown on the invoice.", data_type: "date" },
  { id: "vendor_name", name: "Vendor Name", description: "Name of the supplier issuing the invoice.", data_type: "string" },
  { id: "total_amount", name: "Total Amount", description: "Total amount due on the invoice.", data_type: "number" },
  { id: "currency", name: "Currency", description: "Currency code used for the totals (e.g. USD).", data_type: "string" },
];
