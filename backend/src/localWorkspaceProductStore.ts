import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import type { FieldDefinition } from "./lib/types";
import type { NormalizedModelField } from "./consumer/modelResultNormalizer";
import type { StoredWorkspaceModelConfiguration } from "./workspaceModelConfiguration";

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
  model_name: string | null;
  model_configuration_revision: number | null;
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

export type LocalWorkspaceExtractionJobExport = LocalWorkspaceExtractionJob & {
  template_name: string;
  fields: Array<FieldDefinition & { position: number }>;
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
  not_before?: string;
};

export type DeletedLocalWorkspaceExtractionJob = {
  job_id: string;
  source_file_key: string;
  status: LocalWorkspaceExtractionJobSummary["status"];
};

export type LocalRetainedTerminalSourceFile = {
  job_id: string;
  source_file_key: string;
};

export type LocalWorkspaceProductStore = {
  close(): void;
  getModelConfiguration(): StoredWorkspaceModelConfiguration | null;
  putModelConfiguration(input: {
    expectedRevision: number | null;
    configuration: Omit<StoredWorkspaceModelConfiguration, "revision" | "created_at" | "updated_at">;
    updatedAt: string;
  }): StoredWorkspaceModelConfiguration | null;
  clearModelConfiguration(expectedRevision: number): boolean;
  diagnostics(): {
    busyTimeoutMs: number;
    foreignKeys: boolean;
    journalMode: string;
    sqliteVersion: string;
    synchronous: number;
  };
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
  recordExtractionJobModel(input: {
    jobId: string;
    attempt: number;
    modelName: string;
    route: string;
    configurationRevision?: number;
  }): boolean;
  completeExtractionJob(input: {
    jobId: string;
    attempt: number;
    completedAt: string;
    modelName: string;
    route: string;
    results: NormalizedModelField[];
  }): boolean;
  failExtractionJob(input: {
    jobId: string;
    attempt: number;
    failedAt: string;
    errorCode: string;
    errorMessage: string;
    modelName?: string | null;
    route?: string | null;
  }): boolean;
  requeueExtractionJob(input: {
    jobId: string;
    attempt: number;
    requeuedAt: string;
    errorCode: string;
    errorMessage: string;
    modelName?: string | null;
    route?: string | null;
    nextRetryAt: string;
  }): boolean;
  recoverExtractionJobs(input: {
    limit?: number;
    maxAttempts: number;
    recoveredAt: string;
    staleProcessingBefore: string;
    isJobActive?: (jobId: string) => boolean;
  }): LocalScheduledExtractionJob[];
  getTemplate(templateId: string): LocalWorkspaceTemplateDetail | null;
  deleteExtractionJob(input: { jobId: string }): DeletedLocalWorkspaceExtractionJob | null;
  getExtractionJob(jobId: string): LocalWorkspaceExtractionJob | null;
  getExtractionJobResults(jobId: string): LocalWorkspaceExtractionResult[];
  getExtractionJobSummary(jobId: string): LocalWorkspaceExtractionJobSummary | null;
  getExtractionJobExport(jobId: string): LocalWorkspaceExtractionJobExport | null;
  getExtractionJobExports(jobIds: string[]): LocalWorkspaceExtractionJobExport[];
  getSubmissionTemplate(templateId: string): LocalWorkspaceSubmissionTemplate | null;
  listTemplates(): LocalWorkspaceTemplate[];
  countExtractionJobs(): number;
  listExtractionJobModels(): string[];
  listExtractionJobs(input?: {
    cursor?: { createdAt: string; jobId: string } | null;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    model?: string;
    search?: string;
  }): LocalWorkspaceExtractionJobSummary[];
  listRetainedTerminalSourceFiles(input: {
    failedBefore: string;
    limit?: number;
  }): LocalRetainedTerminalSourceFile[];
  markSourceFileCleaned(input: { jobId: string; sourceFileKey: string; cleanedAt: string }): boolean;
};

export function createLocalWorkspaceProductStore({
  stateDirectory,
  workspaceId,
}: {
  stateDirectory: string;
  workspaceId: string;
}): LocalWorkspaceProductStore {
  const databasePath = workspaceProductDatabasePath({ stateDirectory, workspaceId });
  const directory = join(stateDirectory, "data", "workspaces");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  closeSync(openSync(databasePath, "a", 0o600));
  protectProductFiles(databasePath);
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
  protectProductFiles(databasePath);
  return createProductStore(new Database(databasePath));
}

function protectProductFiles(path: string): void {
  chmodSync(dirname(path), 0o700);
  for (const file of [path, `${path}-journal`, `${path}-shm`, `${path}-wal`]) {
    try { chmodSync(file, 0o600); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
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
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 250");
  database.exec("PRAGMA synchronous = FULL");
  const { version } = database.query("SELECT sqlite_version() AS version").get() as { version: string };
  // SQLite 3.51.3 fixes the WAL-reset race. Retain rollback journaling on the
  // currently bundled 3.51.0; a qualified newer runtime can use WAL + FULL.
  const [major, minor, patch] = version.split(".").map(Number);
  if (major > 3 || (major === 3 && (minor > 51 || (minor === 51 && patch >= 3)))) {
    database.exec("PRAGMA journal_mode = WAL");
  }
  database.exec(PRODUCT_SCHEMA);
  ensureProductSchemaColumns(database);
  migrateProductSchema(database);

  return {
    close: () => database.close(),
    getModelConfiguration: () => readModelConfiguration(database),
    putModelConfiguration: (input) => database.transaction(() => {
      const current = readModelConfiguration(database);
      if ((current?.revision ?? null) !== input.expectedRevision) return null;
      const revision = nextModelRevision(database);
      const config = input.configuration;
      database.query(`INSERT OR REPLACE INTO workspace_model_configuration
        (singleton, gateway_url, model_name, credential_ciphertext, sequential_calls, supports_pdf_input, supports_structured_output, revision, created_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        config.gateway_url, config.model_name, config.credential_ciphertext,
        Number(config.sequential_calls), Number(config.supports_pdf_input), Number(config.supports_structured_output),
        revision, current?.created_at ?? input.updatedAt, input.updatedAt,
      );
      return readModelConfiguration(database);
    }).immediate(),
    clearModelConfiguration: (expectedRevision) => database.transaction(() => {
      if (readModelConfiguration(database)?.revision !== expectedRevision) return false;
      database.query("DELETE FROM workspace_model_configuration WHERE singleton = 1").run();
      return true;
    }).immediate(),
    diagnostics: () => productStoreDiagnostics(database),
    createTemplate: (input) => createTemplate(database, input),
    updateTemplate: (input) => updateTemplate(database, input),
    deleteTemplate: (input) => deleteTemplate(database, input),
    ensureStarterInvoiceTemplate: (input) => ensureStarterInvoiceTemplate(database, input),
    createQueuedExtractionJob: (input) => createQueuedExtractionJob(database, input),
    failQueuedExtractionJob: (input) => failQueuedExtractionJob(database, input),
    claimExtractionJobForProcessing: (input) => claimExtractionJobForProcessing(database, input),
    recordExtractionJobModel: (input) => recordExtractionJobModel(database, input),
    completeExtractionJob: (input) => completeExtractionJob(database, input),
    failExtractionJob: (input) => failExtractionJob(database, input),
    requeueExtractionJob: (input) => requeueExtractionJob(database, input),
    recoverExtractionJobs: (input) => recoverExtractionJobs(database, input),
    getTemplate: (templateId) => getTemplate(database, templateId),
    deleteExtractionJob: (input) => deleteExtractionJob(database, input),
    getExtractionJob: (jobId) => getExtractionJob(database, jobId),
    getExtractionJobResults: (jobId) => readExtractionJobResults(database, jobId),
    getExtractionJobSummary: (jobId) => readExtractionJobSummary(database, jobId),
    getExtractionJobExport: (jobId) => getExtractionJobExport(database, jobId),
    getExtractionJobExports: (jobIds) => database.transaction(() => {
      if (!jobIds.length) return [];
      const placeholders = jobIds.map(() => "?").join(",");
      const size = database.query(`SELECT COALESCE(SUM(length(CAST(COALESCE(r.answer_json, '') AS BLOB)) + length(CAST(COALESCE(r.evidence_text, '') AS BLOB))), 0) AS bytes
        FROM job_results r JOIN jobs j ON j.id = r.job_id WHERE j.status = 'completed' AND r.job_id IN (${placeholders})`).get(...jobIds) as { bytes: number };
      if (size.bytes > 32 * 1024 * 1024) throw new RangeError("Selected results exceed the 32 MiB export limit; select fewer Documents");
      const templates = new Map<string, Pick<LocalWorkspaceExtractionJobExport, "fields" | "template_name">>();
      return jobIds.flatMap((id) => {
        const job = getExtractionJobExport(database, id, templates);
        return job && (job.status === "completed" || job.status === "failed") ? [job] : [];
      });
    })(),
    getSubmissionTemplate: (templateId) => getSubmissionTemplate(database, templateId),
    listTemplates: () => listTemplates(database),
    countExtractionJobs: () => countExtractionJobs(database),
    listExtractionJobModels: () => listExtractionJobModels(database),
    listExtractionJobs: (input) => listExtractionJobs(database, input),
    listRetainedTerminalSourceFiles: (input) => listRetainedTerminalSourceFiles(database, input),
    markSourceFileCleaned: (input) => markSourceFileCleaned(database, input),
  };
}

function readModelConfiguration(database: Database): StoredWorkspaceModelConfiguration | null {
  const row = database.query("SELECT gateway_url, model_name, credential_ciphertext, sequential_calls, supports_pdf_input, supports_structured_output, revision, created_at, updated_at FROM workspace_model_configuration WHERE singleton = 1").get() as StoredWorkspaceModelConfiguration | null;
  return row ? { ...row, sequential_calls: Boolean(row.sequential_calls), supports_pdf_input: Boolean(row.supports_pdf_input), supports_structured_output: Boolean(row.supports_structured_output) } : null;
}

function nextModelRevision(database: Database): number {
  // This counter survives a clear, so an old conditional update cannot match a recreated configuration.
  return (database.query(`INSERT INTO workspace_model_revision(singleton, revision) VALUES (1, 1)
    ON CONFLICT(singleton) DO UPDATE SET revision = revision + 1 RETURNING revision`).get() as { revision: number }).revision;
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
  if (!knownColumns.has("model_configuration_revision")) {
    database.exec("ALTER TABLE jobs ADD COLUMN model_configuration_revision INTEGER");
  }
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_jobs_model_created_id
     ON jobs(model_name, created_at DESC, id DESC)`,
  );
}

function migrateProductSchema(database: Database): void {
  database.transaction(() => {
    const applied = new Set(
      (database.query("SELECT version FROM product_schema_version").all() as Array<{ version: number }>)
        .map((row) => row.version),
    );
    if (!applied.has(3)) {
      database.exec(`CREATE TABLE workspace_model_configuration (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        gateway_url TEXT NOT NULL, model_name TEXT NOT NULL, credential_ciphertext TEXT NOT NULL,
        sequential_calls INTEGER NOT NULL CHECK (sequential_calls IN (0, 1)),
        supports_pdf_input INTEGER NOT NULL CHECK (supports_pdf_input IN (0, 1)),
        supports_structured_output INTEGER NOT NULL CHECK (supports_structured_output IN (0, 1)),
        revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE workspace_model_revision (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL);`);
      database.query("INSERT INTO product_schema_version(version, applied_at) VALUES (3, ?)").run(new Date().toISOString());
    }
    if (!applied.has(1)) {
      database.exec("DROP INDEX IF EXISTS idx_source_files_job");
      database.exec("DROP INDEX IF EXISTS idx_job_results_job");
      database.exec("DROP INDEX IF EXISTS idx_jobs_status_updated");
      database.exec(
        `CREATE INDEX IF NOT EXISTS idx_jobs_active_updated_id
         ON jobs(status, updated_at, id)
         WHERE status = 'queued' OR status = 'processing'`,
      );
      database.query(
        `INSERT INTO product_schema_version(version, applied_at) VALUES (1, ?)`,
      ).run(new Date().toISOString());
    }
    if (!applied.has(2)) {
      database.exec(
        `CREATE INDEX IF NOT EXISTS idx_jobs_terminal_cleanup_updated_id
         ON jobs(status, updated_at, id)
         WHERE status = 'completed' OR status = 'failed'`,
      );
      database.query(
        `INSERT INTO product_schema_version(version, applied_at) VALUES (2, ?)`,
      ).run(new Date().toISOString());
    }
    if (!applied.has(4)) {
      database.exec(`
        CREATE INDEX idx_sources_uncleaned ON source_files(job_id, key) WHERE deleted_at IS NULL;
        CREATE INDEX idx_jobs_runnable ON jobs(COALESCE(next_retry_at, updated_at), id) WHERE status = 'queued';
        CREATE TABLE job_totals (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), count INTEGER NOT NULL);
        INSERT INTO job_totals SELECT 1, COUNT(*) FROM jobs;
        CREATE TRIGGER jobs_count_insert AFTER INSERT ON jobs BEGIN
          UPDATE job_totals SET count = count + 1 WHERE singleton = 1;
        END;
        CREATE TRIGGER jobs_count_delete AFTER DELETE ON jobs BEGIN
          UPDATE job_totals SET count = count - 1 WHERE singleton = 1;
        END;
        CREATE VIRTUAL TABLE job_search USING fts5(source_name, id, template_id,
          content='jobs', content_rowid='rowid', tokenize='trigram');
        INSERT INTO job_search(job_search) VALUES ('rebuild');
        CREATE TRIGGER jobs_search_insert AFTER INSERT ON jobs BEGIN
          INSERT INTO job_search(rowid, source_name, id, template_id)
            VALUES (new.rowid, new.source_name, new.id, new.template_id);
        END;
        CREATE TRIGGER jobs_search_delete AFTER DELETE ON jobs BEGIN
          INSERT INTO job_search(job_search, rowid, source_name, id, template_id)
            VALUES ('delete', old.rowid, old.source_name, old.id, old.template_id);
        END;
        CREATE TRIGGER jobs_search_update AFTER UPDATE OF source_name, id, template_id ON jobs
        WHEN old.source_name IS NOT new.source_name OR old.id IS NOT new.id
          OR old.template_id IS NOT new.template_id BEGIN
          INSERT INTO job_search(job_search, rowid, source_name, id, template_id)
            VALUES ('delete', old.rowid, old.source_name, old.id, old.template_id);
          INSERT INTO job_search(rowid, source_name, id, template_id)
            VALUES (new.rowid, new.source_name, new.id, new.template_id);
        END;
      `);
      database.query("INSERT INTO product_schema_version(version, applied_at) VALUES (4, ?)").run(new Date().toISOString());
    }
  }).immediate();
}

function productStoreDiagnostics(database: Database): {
  busyTimeoutMs: number;
  foreignKeys: boolean;
  journalMode: string;
  sqliteVersion: string;
  synchronous: number;
} {
  const sqliteVersion = database.query("SELECT sqlite_version() AS value").get() as { value: string };
  const journalMode = database.query("PRAGMA journal_mode").get() as { journal_mode: string };
  const synchronous = database.query("PRAGMA synchronous").get() as { synchronous: number };
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  const busyTimeout = database.query("PRAGMA busy_timeout").get() as { timeout: number };
  return {
    busyTimeoutMs: busyTimeout.timeout,
    foreignKeys: foreignKeys.foreign_keys === 1,
    journalMode: journalMode.journal_mode,
    sqliteVersion: sqliteVersion.value,
    synchronous: synchronous.synchronous,
  };
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
  const result = database.query(
    `UPDATE jobs
     SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = 1
     WHERE id = ? AND status = 'queued'`,
  ).run(input.errorCode, input.errorMessage.slice(0, 2000), input.failedAt, input.jobId);
  return result.changes > 0;
}

function claimExtractionJobForProcessing(
  database: Database,
  input: { jobId: string; attempt: number; claimedAt: string },
): LocalClaimedExtractionJob | null {
  const claim = database.transaction(() => {
    const job = database.query(
      `SELECT id, template_id, template_version, source_file_key, source_mime_type, status, current_attempt, next_retry_at
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
      next_retry_at: string | null;
    } | null;
    if (
      !job ||
      job.status !== "queued" ||
      job.current_attempt >= input.attempt ||
      (job.next_retry_at !== null && job.next_retry_at > input.claimedAt)
    ) {
      return null;
    }

    const result = database.query(
      `UPDATE jobs
       SET status = 'processing', updated_at = ?, error_code = NULL, error_message = NULL, next_retry_at = NULL, current_attempt = ?, model_name = NULL, model_gateway_route = NULL, model_configuration_revision = NULL
       WHERE id = ? AND status = 'queued' AND current_attempt < ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)`,
    ).run(
      input.claimedAt,
      input.attempt,
      input.jobId,
      input.attempt,
      input.claimedAt,
    );
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
    results: NormalizedModelField[];
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

function recordExtractionJobModel(
  database: Database,
  input: { jobId: string; attempt: number; modelName: string; route: string; configurationRevision?: number },
): boolean {
  const result = database.query(
    `UPDATE jobs
     SET model_name = ?, model_gateway_route = ?, model_configuration_revision = ?
     WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
  ).run(input.modelName, input.route, input.configurationRevision ?? null, input.jobId, input.attempt);
  return result.changes > 0;
}

function failExtractionJob(
  database: Database,
  input: {
    jobId: string;
    attempt: number;
    failedAt: string;
    errorCode: string;
    errorMessage: string;
    modelName?: string | null;
    route?: string | null;
  },
): boolean {
  const result = database.query(
    `UPDATE jobs
     SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = ?,
         model_name = COALESCE(?, model_name), model_gateway_route = COALESCE(?, model_gateway_route)
     WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
  ).run(
    input.errorCode,
    input.errorMessage.slice(0, 2000),
    input.failedAt,
    input.attempt,
    input.modelName ?? null,
    input.route ?? null,
    input.jobId,
    input.attempt,
  );
  return result.changes > 0;
}

function requeueExtractionJob(
  database: Database,
  input: {
    jobId: string;
    attempt: number;
    requeuedAt: string;
    errorCode: string;
    errorMessage: string;
    modelName?: string | null;
    route?: string | null;
    nextRetryAt: string;
  },
): boolean {
  const result = database.query(
    `UPDATE jobs
     SET status = 'queued', error_code = ?, error_message = ?, updated_at = ?, next_retry_at = ?, last_failed_attempt = ?,
         model_name = COALESCE(?, model_name), model_gateway_route = COALESCE(?, model_gateway_route)
     WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
  ).run(
    input.errorCode,
    input.errorMessage.slice(0, 2000),
    input.requeuedAt,
    input.nextRetryAt,
    input.attempt,
    input.modelName ?? null,
    input.route ?? null,
    input.jobId,
    input.attempt,
  );
  return result.changes > 0;
}

function recoverExtractionJobs(
  database: Database,
  input: { limit?: number; maxAttempts: number; recoveredAt: string; staleProcessingBefore: string; isJobActive?: (jobId: string) => boolean },
): LocalScheduledExtractionJob[] {
  const limit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? input.limit! : 1_000;
  const recover = database.transaction(() => {
    const scheduled: LocalScheduledExtractionJob[] = [];
    const queued = database.query(
      `SELECT id, template_id, template_version, current_attempt, next_retry_at
       FROM jobs INDEXED BY idx_jobs_runnable
       WHERE status = 'queued'
       ORDER BY COALESCE(next_retry_at, updated_at) ASC, id ASC
       LIMIT ?`,
    ).all(limit) as Array<{
      id: string;
      template_id: string;
      template_version: number;
      current_attempt: number;
      next_retry_at: string | null;
    }>;
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
        ...(job.next_retry_at ? { not_before: job.next_retry_at } : {}),
      });
    }

    const stale = database.query(
      `SELECT id, template_id, template_version, current_attempt
       FROM jobs
       WHERE status = 'processing' AND updated_at <= ?
       ORDER BY updated_at ASC, id ASC
       LIMIT ?`,
    ).all(input.staleProcessingBefore, limit) as Array<{ id: string; template_id: string; template_version: number; current_attempt: number }>;
    for (const job of stale) {
      if (input.isJobActive?.(job.id)) continue;
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

  return {
    ...summary,
    results: summary.status === "completed" ? readExtractionJobResults(database, jobId) : [],
  };
}

function readExtractionJobResults(database: Database, jobId: string): LocalWorkspaceExtractionResult[] {
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

  return results.map((result) => ({
    field_id: result.field_id,
    name: result.name,
    data_type: result.data_type,
    status: result.status,
    answer: parseStoredAnswer(result.answer_json),
    confidence: result.confidence,
    evidence: result.evidence_text,
  }));
}

function getExtractionJobExport(
  database: Database,
  jobId: string,
  templates = new Map<string, Pick<LocalWorkspaceExtractionJobExport, "fields" | "template_name">>(),
): LocalWorkspaceExtractionJobExport | null {
  const job = getExtractionJob(database, jobId);
  if (!job) {
    return null;
  }

  const key = `${job.template_id}\u0000${job.template_version}`;
  const cached = templates.get(key);
  if (cached) return { ...job, ...cached };

  const template = database.query(
    "SELECT name FROM templates WHERE id = ?",
  ).get(job.template_id) as { name: string } | null;
  const fields = database.query(
    `SELECT field_id AS id, name, description, data_type, position
     FROM template_fields
     WHERE template_id = ? AND version = ?
     ORDER BY position ASC`,
  ).all(job.template_id, job.template_version) as Array<
    FieldDefinition & { position: number }
  >;

  templates.set(key, { template_name: template?.name || job.template_id, fields });
  return {
    ...job,
    template_name: template?.name || job.template_id,
    fields,
  };
}

function countExtractionJobs(database: Database): number {
  return (database.query("SELECT count FROM job_totals WHERE singleton = 1").get() as { count: number }).count;
}

function listExtractionJobModels(database: Database): string[] {
  return database.query(
    `SELECT DISTINCT model_name
     FROM jobs
     WHERE model_name IS NOT NULL AND TRIM(model_name) != ''
     ORDER BY model_name COLLATE NOCASE ASC`,
  ).all().map((row) => String((row as { model_name: string }).model_name));
}

function listExtractionJobs(
  database: Database,
  input: {
    cursor?: { createdAt: string; jobId: string } | null;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    model?: string;
    search?: string;
  } = {},
): LocalWorkspaceExtractionJobSummary[] {
  const select = `SELECT j.id AS job_id, j.status, j.source_name, j.source_mime_type,
                         s.page_count AS source_file_page_count, j.template_id, j.template_version,
                         j.model_name, j.model_configuration_revision, j.error_code, j.error_message, j.created_at, j.updated_at, j.completed_at,
                         j.current_attempt, j.completed_attempt, j.last_failed_attempt
                  FROM jobs j
                  JOIN source_files s ON s.job_id = j.id`;
  const search = String(input.search || "").trim().toLowerCase();
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  if (search) {
    // FTS indexes stable metadata only. Status terms use the literal path so
    // lifecycle transitions do not rewrite the search index.
    // One/two-character and NUL-containing searches retain their original behavior.
    if ([...search].length >= 3 && !search.includes("\u0000")
      && !["queued", "processing", "completed", "failed"].some((status) => status.includes(search))) {
      const candidates = database.query("SELECT rowid FROM job_search WHERE job_search MATCH ? LIMIT 1001")
        .all(`"${search.replaceAll('"', '""')}"`) as { rowid: number }[];
      if (!candidates.length) return [];
      // Broad terms (e.g. "queued") should read a page in date order rather
      // than materialize and sort a million matching FTS row IDs.
      if (candidates.length <= 1000) {
        clauses.push(`j.rowid IN (${candidates.map(() => "?").join(",")})`);
        parameters.push(...candidates.map((row) => row.rowid));
      }
    }
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(`(LOWER(COALESCE(j.source_name, '')) LIKE ? ESCAPE '\\'
        OR LOWER(j.id) LIKE ? ESCAPE '\\'
        OR LOWER(j.template_id) LIKE ? ESCAPE '\\'
        OR LOWER(j.status) LIKE ? ESCAPE '\\')`);
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (input.dateFrom) {
    clauses.push("j.created_at >= ?");
    parameters.push(`${input.dateFrom}T00:00:00.000Z`);
  }
  if (input.dateTo) {
    clauses.push("j.created_at <= ?");
    parameters.push(`${input.dateTo}T23:59:59.999Z`);
  }
  if (input.model) {
    clauses.push("j.model_name = ?");
    parameters.push(input.model);
  }
  if (input.cursor) {
    clauses.push("(j.created_at, j.id) < (?, ?)");
    parameters.push(input.cursor.createdAt, input.cursor.jobId);
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

function listRetainedTerminalSourceFiles(
  database: Database,
  input: { failedBefore: string; limit?: number },
): LocalRetainedTerminalSourceFile[] {
  const limit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? input.limit! : 1_000;
  return database.query(
    `SELECT j.id AS job_id, s.key AS source_file_key
     FROM source_files s
     CROSS JOIN jobs j ON j.id = s.job_id
     WHERE s.deleted_at IS NULL
       AND (j.status = 'completed' OR (j.status = 'failed' AND j.updated_at <= ?))
     ORDER BY j.updated_at ASC, j.id ASC
     LIMIT ?`,
  ).all(input.failedBefore, limit) as LocalRetainedTerminalSourceFile[];
}

function readExtractionJobSummary(database: Database, jobId: string): LocalWorkspaceExtractionJobSummary | null {
  return database.query(
    `SELECT j.id AS job_id, j.status, j.source_name, j.source_mime_type,
            s.page_count AS source_file_page_count, j.template_id, j.template_version,
            j.model_name, j.model_configuration_revision, j.error_code, j.error_message, j.created_at, j.updated_at, j.completed_at,
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

  CREATE INDEX IF NOT EXISTS idx_jobs_active_updated_id
    ON jobs(status, updated_at, id)
    WHERE status = 'queued' OR status = 'processing';
  CREATE INDEX IF NOT EXISTS idx_jobs_terminal_cleanup_updated_id
    ON jobs(status, updated_at, id)
    WHERE status = 'completed' OR status = 'failed';
  CREATE INDEX IF NOT EXISTS idx_jobs_created_id
    ON jobs(created_at DESC, id DESC);

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

`;

const STARTER_INVOICE_FIELDS: FieldDefinition[] = [
  { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
  { id: "invoice_date", name: "Invoice Date", description: "Date shown on the invoice.", data_type: "date" },
  { id: "vendor_name", name: "Vendor Name", description: "Name of the supplier issuing the invoice.", data_type: "string" },
  { id: "total_amount", name: "Total Amount", description: "Total amount due on the invoice.", data_type: "number" },
  { id: "currency", name: "Currency", description: "Currency code used for the totals (e.g. USD).", data_type: "string" },
];
