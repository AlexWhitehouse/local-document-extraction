import { closeSync, constants as fsConstants, existsSync, fchmodSync, openSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Database, constants as sqliteConstants } from "bun:sqlite";

import type { FieldDefinition } from "./lib/types";
import { newId } from "./lib/ids";
import type { NormalizedModelField } from "./consumer/modelResultNormalizer";
import type { StoredWorkspaceModelConfiguration } from "./workspaceModelConfiguration";
import { assertRealStateDirectorySync, assertRegularStateFileSync, ensurePrivateStateDirectorySync } from "./localStatePaths";

export type LocalWorkspaceTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  current_version: number;
  created_at: string;
  updated_at: string;
};

type PositionedField = FieldDefinition & { position: number };

export type LocalWorkspaceTemplateDetail = LocalWorkspaceTemplate & {
  fields: PositionedField[];
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
  /** The original is kept for viewing and download (Source file retention), rather than only for processing. */
  source_retained: boolean;
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
  fields: PositionedField[];
};

export type LocalClaimedExtractionJob = {
  job_id: string;
  template_id: string;
  template_version: number;
  source_file_key: string;
  source_mime_type: string;
  source_retained: boolean;
  /** The original is retained in remote object storage; the local file is only a working copy. */
  source_retained_remotely: boolean;
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
  retained_object_key: string | null;
  status: LocalWorkspaceExtractionJobSummary["status"];
};

export type LocalRetainedSourceFile = {
  source_file_key: string;
  /** Remote object holding the original; null when the local file is the original. */
  retained_object_key: string | null;
  source_mime_type: string;
  source_name: string | null;
};

export type LocalRetainedTerminalSourceFile = {
  job_id: string;
  source_file_key: string;
  /** Set for deleted Documents whose remote original must be released before the intent clears. */
  retained_object_key: string | null;
};

/** A Saved Evaluation document: Workspace-owned, independent of any Extraction job. */
export type LocalEvaluationDocument = {
  id: string;
  name: string;
  source_name: string | null;
  source_mime_type: string;
  source_byte_size: number;
  source_page_count: number | null;
  /** Local original; null when the original is held in remote object storage. */
  source_file_key: string | null;
  retained_object_key: string | null;
  reference_json: string;
  /** Field names, types and verification only, so listings never parse whole Expected answer sets. */
  reference_fields_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by_user_id: string;
  created_by_name: string;
  updated_by_user_id: string;
  updated_by_name: string;
};

export type LocalEvaluationDocumentSummary = Omit<LocalEvaluationDocument, "reference_json">;

export type LocalEvaluationDocumentSource = Pick<LocalEvaluationDocument, "id" | "source_file_key" | "retained_object_key" | "source_mime_type" | "source_name" | "source_byte_size">;

/** Minimal idempotency record: no document or reference content, and never expired. */
export type LocalEvaluationDocumentSaveReceipt = {
  operation_id: string;
  digest: string;
  document_id: string;
  outcome: "saved" | "deleted";
};

export type LocalEvaluationDocumentDeletionIntent = {
  document_id: string;
  source_file_key: string | null;
  retained_object_key: string | null;
};

type EvaluationDocumentAuthor = { userId: string; name: string };

export type LocalWorkspaceProductStore = {
  close(): void;
  /** Commits a complete save and its receipt together; an existing receipt wins and nothing is inserted. */
  insertEvaluationDocument(input: {
    document: Omit<LocalEvaluationDocument, "revision" | "updated_at" | "updated_by_user_id" | "updated_by_name" | "created_by_user_id" | "created_by_name">;
    author: EvaluationDocumentAuthor;
    operationId: string;
    digest: string;
  }): { inserted: true; document: LocalEvaluationDocument } | { inserted: false; receipt: LocalEvaluationDocumentSaveReceipt };
  /** Compare-and-swap on revision; a rename leaves the Expected answer set untouched. */
  updateEvaluationDocument(input: {
    documentId: string;
    expectedRevision: number;
    name?: string;
    reference?: { json: string; fieldsJson: string };
    author: EvaluationDocumentAuthor;
    updatedAt: string;
  }): { status: "updated" | "conflict"; document: LocalEvaluationDocument } | { status: "not_found" };
  /** Logical deletion: removes the entry, records source cleanup intent and marks its receipts deleted. */
  deleteEvaluationDocument(input: { documentId: string; deletedAt: string }): LocalEvaluationDocumentDeletionIntent | null;
  getEvaluationDocument(documentId: string): LocalEvaluationDocument | null;
  getEvaluationDocumentSource(documentId: string): LocalEvaluationDocumentSource | null;
  getEvaluationDocumentSaveReceipt(operationId: string): LocalEvaluationDocumentSaveReceipt | null;
  listEvaluationDocuments(input: {
    cursor?: { updatedAt: string; documentId: string } | null;
    search?: string;
    limit: number;
  }): LocalEvaluationDocumentSummary[];
  listEvaluationDocumentDeletionIntents(input: { limit: number }): LocalEvaluationDocumentDeletionIntent[];
  completeEvaluationDocumentDeletionIntent(documentId: string): void;
  hasEvaluationDocumentDeletionIntent(documentId: string): boolean;
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
    sourceRetained?: boolean;
    retainedObjectKey?: string | null;
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
  getTemplate(templateId: string, version?: number): LocalWorkspaceTemplateDetail | null;
  deleteExtractionJob(input: { jobId: string }): DeletedLocalWorkspaceExtractionJob | null;
  getExtractionJob(jobId: string): LocalWorkspaceExtractionJob | null;
  getExtractionJobResults(jobId: string): LocalWorkspaceExtractionResult[];
  getExtractionJobSummary(jobId: string): LocalWorkspaceExtractionJobSummary | null;
  /** The retained original for a job, or null when the job is absent or its original was not retained. */
  getRetainedSourceFile(jobId: string): LocalRetainedSourceFile | null;
  getExtractionJobExports(jobIds: string[]): LocalWorkspaceExtractionJobExport[];
  getSubmissionTemplate(templateId: string): LocalWorkspaceSubmissionTemplate | null;
  listTemplates(): LocalWorkspaceTemplate[];
  countExtractionJobs(): number;
  getExtractionJobCounts(): { total: number; status_counts: Record<LocalWorkspaceExtractionJobSummary["status"], number> };
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

type WorkspaceProductLocation = { stateDirectory: string; workspaceId: string };

export function createLocalWorkspaceProductStore({ stateDirectory, workspaceId }: WorkspaceProductLocation): LocalWorkspaceProductStore {
  workspaceProductDatabasePath({ stateDirectory, workspaceId });
  const directory = join(stateDirectory, "data", "workspaces");
  ensurePrivateStateDirectorySync(stateDirectory, { recursive: true });
  ensurePrivateStateDirectorySync(join(stateDirectory, "data"));
  ensurePrivateStateDirectorySync(directory);
  // Canonical parents keep SQLite NOFOLLOW compatible with OS /var aliases.
  const databasePath = join(realpathSync(directory), `${workspaceId}.sqlite`);
  protectProductFiles(databasePath);
  const file = openSync(databasePath, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW, 0o600);
  try { fchmodSync(file, 0o600); }
  finally { closeSync(file); }
  return openProtectedProductStore(databasePath);
}

export function openLocalWorkspaceProductStore({ stateDirectory, workspaceId }: WorkspaceProductLocation): LocalWorkspaceProductStore | null {
  workspaceProductDatabasePath({ stateDirectory, workspaceId });
  const directory = join(stateDirectory, "data", "workspaces");
  try {
    for (const path of [stateDirectory, join(stateDirectory, "data"), directory]) assertRealStateDirectorySync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const databasePath = join(realpathSync(directory), `${workspaceId}.sqlite`);
  assertRegularStateFileSync(databasePath);
  if (!existsSync(databasePath)) return null;
  ensurePrivateStateDirectorySync(directory);
  protectProductFiles(databasePath);
  return openProtectedProductStore(databasePath);
}

export async function eraseLocalWorkspaceProductData(location: WorkspaceProductLocation): Promise<void> {
  const databasePath = workspaceProductDatabasePath(location);
  await Promise.all(productDatabaseFiles(databasePath).map((path) => rm(path, { force: true })));
}

function productDatabaseFiles(databasePath: string): string[] {
  return [databasePath, `${databasePath}-journal`, `${databasePath}-shm`, `${databasePath}-wal`];
}

function protectProductFiles(databasePath: string): void {
  for (const file of productDatabaseFiles(databasePath)) {
    assertRegularStateFileSync(file);
    try {
      const descriptor = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try { fchmodSync(descriptor, 0o600); }
      finally { closeSync(descriptor); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function openProtectedProductStore(path: string): LocalWorkspaceProductStore {
  const database = new Database(path, sqliteConstants.SQLITE_OPEN_READWRITE | sqliteConstants.SQLITE_OPEN_NOFOLLOW);
  try { return createProductStore(database); }
  catch (error) { database.close(); throw error; }
}

function workspaceProductDatabasePath({ stateDirectory, workspaceId }: WorkspaceProductLocation): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId)) {
    throw new Error("Workspace ID contains unsupported characters for local product storage.");
  }
  return join(stateDirectory, "data", "workspaces", `${workspaceId}.sqlite`);
}

const JOB_SUMMARY_SELECT = `SELECT j.id AS job_id, j.status, j.source_name, j.source_mime_type,
    s.page_count AS source_file_page_count, (s.retained = 1 AND (s.retained_key IS NOT NULL OR s.deleted_at IS NULL)) AS source_retained,
    j.template_id, j.template_version,
    j.model_name, j.model_configuration_revision, j.error_code, j.error_message, j.created_at, j.updated_at, j.completed_at,
    j.current_attempt, j.completed_attempt, j.last_failed_attempt
  FROM jobs j
  JOIN source_files s ON s.job_id = j.id`;

const EVALUATION_DOCUMENT_SUMMARY_SELECT = `SELECT id, name, source_name, source_mime_type, source_byte_size, source_page_count,
    source_file_key, retained_object_key, reference_fields_json, revision, created_at, updated_at,
    created_by_user_id, created_by_name, updated_by_user_id, updated_by_name`;
const EVALUATION_DOCUMENT_SELECT = `${EVALUATION_DOCUMENT_SUMMARY_SELECT}, reference_json FROM evaluation_documents`;

const MAX_ERROR_MESSAGE_LENGTH = 2000;

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

  const readModelConfiguration = (): StoredWorkspaceModelConfiguration | null => {
    const row = database.query("SELECT gateway_url, model_name, credential_ciphertext, sequential_calls, supports_pdf_input, supports_structured_output, revision, created_at, updated_at FROM workspace_model_configuration WHERE singleton = 1").get() as StoredWorkspaceModelConfiguration | null;
    return row ? { ...row, sequential_calls: Boolean(row.sequential_calls), supports_pdf_input: Boolean(row.supports_pdf_input), supports_structured_output: Boolean(row.supports_structured_output) } : null;
  };

  const insertTemplateFields = (templateId: string, version: number, fields: FieldDefinition[]) => {
    const insertField = database.query(
      `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    fields.forEach((field, position) => {
      insertField.run(templateId, version, field.id, field.name, field.description, field.data_type, position);
    });
  };

  const readTemplateFields = (templateId: string, version: number) => database.query(
    `SELECT field_id AS id, name, description, data_type, position
     FROM template_fields
     WHERE template_id = ? AND version = ?
     ORDER BY position ASC`,
  ).all(templateId, version) as PositionedField[];

  const readJobSummary = (jobId: string) => {
    const row = database.query(`${JOB_SUMMARY_SELECT} WHERE j.id = ?`).get(jobId) as JobSummaryRow | null;
    return row && withRetainedFlag(row);
  };

  const readJobResults = (jobId: string): LocalWorkspaceExtractionResult[] => {
    const results = database.query(
      `SELECT r.field_id, f.name, f.data_type, r.status, r.answer_json, r.confidence, r.evidence_text
       FROM job_results r
       JOIN jobs j ON j.id = r.job_id
       JOIN template_fields f ON f.template_id = j.template_id
         AND f.version = j.template_version
         AND f.field_id = r.field_id
       WHERE r.job_id = ?
       ORDER BY f.position ASC`,
    ).all(jobId) as Array<Omit<LocalWorkspaceExtractionResult, "answer" | "evidence"> & {
      answer_json: string | null;
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
  };

  const readJob = (jobId: string): LocalWorkspaceExtractionJob | null => {
    const summary = readJobSummary(jobId);
    if (!summary) return null;
    return { ...summary, results: summary.status === "completed" ? readJobResults(jobId) : [] };
  };

  const createTemplate: LocalWorkspaceProductStore["createTemplate"] = (input) => {
    database.transaction(() => {
      database.query(
        `INSERT INTO templates (id, name, description, status, current_version, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 'active', 1, ?, ?, NULL)`,
      ).run(input.templateId, input.name, input.description, input.createdAt, input.createdAt);
      insertTemplateFields(input.templateId, 1, input.fields);
    })();
    return { template_id: input.templateId, version: 1, status: "active" };
  };

  const readEvaluationDocument = (documentId: string) =>
    database.query(`${EVALUATION_DOCUMENT_SELECT} WHERE id = ?`).get(documentId) as LocalEvaluationDocument | null;
  const readSaveReceipt = (operationId: string) => database.query(
    "SELECT operation_id, digest, document_id, outcome FROM evaluation_document_save_receipts WHERE operation_id = ?",
  ).get(operationId) as LocalEvaluationDocumentSaveReceipt | null;

  return {
    close: () => database.close(),
    insertEvaluationDocument: ({ document, author, operationId, digest }) => database.transaction(() => {
      // Concurrent retries of one operation race here; only the first commit creates an entry.
      const receipt = readSaveReceipt(operationId);
      if (receipt) return { inserted: false as const, receipt };
      database.query(
        `INSERT INTO evaluation_documents (id, name, source_name, source_mime_type, source_byte_size, source_page_count,
           source_file_key, retained_object_key, reference_json, reference_fields_json, revision, created_at, updated_at,
           created_by_user_id, created_by_name, updated_by_user_id, updated_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      ).run(document.id, document.name, document.source_name, document.source_mime_type, document.source_byte_size, document.source_page_count,
        document.source_file_key, document.retained_object_key, document.reference_json, document.reference_fields_json,
        document.created_at, document.created_at,
        author.userId, author.name, author.userId, author.name);
      database.query(
        "INSERT INTO evaluation_document_save_receipts (operation_id, digest, document_id, outcome, created_at) VALUES (?, ?, ?, 'saved', ?)",
      ).run(operationId, digest, document.id, document.created_at);
      return { inserted: true as const, document: readEvaluationDocument(document.id)! };
    }).immediate(),
    updateEvaluationDocument: (input) => database.transaction(() => {
      const assignments = ["revision = revision + 1", "updated_at = ?", "updated_by_user_id = ?", "updated_by_name = ?"];
      const parameters: Array<string | number> = [input.updatedAt, input.author.userId, input.author.name];
      if (input.name !== undefined) { assignments.push("name = ?"); parameters.push(input.name); }
      if (input.reference) {
        assignments.push("reference_json = ?", "reference_fields_json = ?");
        parameters.push(input.reference.json, input.reference.fieldsJson);
      }
      const updated = database.query(`UPDATE evaluation_documents SET ${assignments.join(", ")} WHERE id = ? AND revision = ?`)
        .run(...parameters, input.documentId, input.expectedRevision).changes > 0;
      const document = readEvaluationDocument(input.documentId);
      if (!document) return { status: "not_found" as const };
      return { status: updated ? "updated" as const : "conflict" as const, document };
    }).immediate(),
    deleteEvaluationDocument: ({ documentId, deletedAt }) => database.transaction(() => {
      const source = database.query("SELECT source_file_key, retained_object_key FROM evaluation_documents WHERE id = ?")
        .get(documentId) as Omit<LocalEvaluationDocumentDeletionIntent, "document_id"> | null;
      if (!source) return null;
      database.query(
        "INSERT OR REPLACE INTO evaluation_document_deletion_intents (document_id, source_file_key, retained_object_key, created_at) VALUES (?, ?, ?, ?)",
      ).run(documentId, source.source_file_key, source.retained_object_key, deletedAt);
      // A replayed save of this entry must not recreate it.
      database.query("UPDATE evaluation_document_save_receipts SET outcome = 'deleted' WHERE document_id = ?").run(documentId);
      database.query("DELETE FROM evaluation_documents WHERE id = ?").run(documentId);
      return { document_id: documentId, ...source };
    }).immediate(),
    getEvaluationDocument: readEvaluationDocument,
    getEvaluationDocumentSource: (documentId) => database.query(
      `SELECT id, source_file_key, retained_object_key, source_mime_type, source_name, source_byte_size
       FROM evaluation_documents WHERE id = ?`,
    ).get(documentId) as LocalEvaluationDocumentSource | null,
    getEvaluationDocumentSaveReceipt: readSaveReceipt,
    listEvaluationDocuments: ({ cursor, search, limit }) => {
      const clauses: string[] = [];
      const parameters: Array<string | number> = [];
      const term = (search ?? "").trim().toLowerCase();
      if (term) {
        const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
        clauses.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(source_name, '')) LIKE ? ESCAPE '\\')");
        parameters.push(pattern, pattern);
      }
      if (cursor) {
        clauses.push("(updated_at, id) < (?, ?)");
        parameters.push(cursor.updatedAt, cursor.documentId);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      return database.query(`${EVALUATION_DOCUMENT_SUMMARY_SELECT} FROM evaluation_documents${where} ORDER BY updated_at DESC, id DESC LIMIT ?`)
        .all(...parameters, limit) as LocalEvaluationDocumentSummary[];
    },
    listEvaluationDocumentDeletionIntents: ({ limit }) => database.query(
      "SELECT document_id, source_file_key, retained_object_key FROM evaluation_document_deletion_intents ORDER BY created_at, document_id LIMIT ?",
    ).all(limit) as LocalEvaluationDocumentDeletionIntent[],
    completeEvaluationDocumentDeletionIntent: (documentId) => {
      database.query("DELETE FROM evaluation_document_deletion_intents WHERE document_id = ?").run(documentId);
    },
    hasEvaluationDocumentDeletionIntent: (documentId) =>
      Boolean(database.query("SELECT 1 FROM evaluation_document_deletion_intents WHERE document_id = ?").get(documentId)),
    getModelConfiguration: readModelConfiguration,
    putModelConfiguration: (input) => database.transaction(() => {
      const current = readModelConfiguration();
      if ((current?.revision ?? null) !== input.expectedRevision) return null;
      // This counter survives a clear, so an old conditional update cannot match a recreated configuration.
      const { revision } = database.query(`INSERT INTO workspace_model_revision(singleton, revision) VALUES (1, 1)
        ON CONFLICT(singleton) DO UPDATE SET revision = revision + 1 RETURNING revision`).get() as { revision: number };
      const config = input.configuration;
      database.query(`INSERT OR REPLACE INTO workspace_model_configuration
        (singleton, gateway_url, model_name, credential_ciphertext, sequential_calls, supports_pdf_input, supports_structured_output, revision, created_at, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        config.gateway_url, config.model_name, config.credential_ciphertext,
        Number(config.sequential_calls), Number(config.supports_pdf_input), Number(config.supports_structured_output),
        revision, current?.created_at ?? input.updatedAt, input.updatedAt,
      );
      return readModelConfiguration();
    }).immediate(),
    clearModelConfiguration: (expectedRevision) => database.transaction(() => {
      if (readModelConfiguration()?.revision !== expectedRevision) return false;
      database.query("DELETE FROM workspace_model_configuration WHERE singleton = 1").run();
      return true;
    }).immediate(),
    diagnostics: () => {
      const pragma = <T>(sql: string) => database.query(sql).get() as T;
      return {
        busyTimeoutMs: pragma<{ timeout: number }>("PRAGMA busy_timeout").timeout,
        foreignKeys: pragma<{ foreign_keys: number }>("PRAGMA foreign_keys").foreign_keys === 1,
        journalMode: pragma<{ journal_mode: string }>("PRAGMA journal_mode").journal_mode,
        sqliteVersion: version,
        synchronous: pragma<{ synchronous: number }>("PRAGMA synchronous").synchronous,
      };
    },
    createTemplate,
    updateTemplate: (input) => {
      const existing = database.query(
        `SELECT name, description, current_version
         FROM templates
         WHERE id = ? AND deleted_at IS NULL`,
      ).get(input.templateId) as Pick<LocalWorkspaceTemplate, "name" | "description" | "current_version"> | null;
      if (!existing) return null;

      const nextVersion = input.fields ? existing.current_version + 1 : existing.current_version;
      database.transaction(() => {
        database.query(
          `UPDATE templates
           SET name = ?, description = ?, current_version = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        ).run(
          input.name ?? existing.name,
          input.description !== undefined ? input.description : existing.description,
          nextVersion,
          input.updatedAt,
          input.templateId,
        );
        if (input.fields) insertTemplateFields(input.templateId, nextVersion, input.fields);
      })();
      return { template_id: input.templateId, version: nextVersion, status: "active" };
    },
    deleteTemplate: (input) => database.query(
      `UPDATE templates
       SET status = 'deleted', deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(input.deletedAt, input.deletedAt, input.templateId).changes > 0,
    ensureStarterInvoiceTemplate: (input) => database.transaction(() => {
      // Bootstrap only an untouched Workspace. Include deleted Templates so retrying
      // bootstrap never recreates a starter that the user has edited or removed.
      if (database.query("SELECT id FROM templates LIMIT 1").get()) return;
      createTemplate({
        templateId: newId("tpl"),
        name: "Example Invoice",
        description: "Starter template that extracts key invoice fields for quick testing.",
        fields: STARTER_INVOICE_FIELDS,
        createdAt: input.createdAt,
      });
    }).immediate(),
    createQueuedExtractionJob: (input) => {
      database.transaction(() => {
        database.query(
          `INSERT INTO source_files (key, job_id, mime_type, name, page_count, created_at, deleted_at, retained, retained_key)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(input.sourceFileKey, input.jobId, input.sourceMimeType, input.sourceName, input.sourceFilePageCount, input.submittedAt,
          Number(Boolean(input.sourceRetained || input.retainedObjectKey)), input.retainedObjectKey ?? null);
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
      })();
      return {
        job_id: input.jobId,
        status: "queued",
        source_name: input.sourceName,
        template_id: input.templateId,
        template_version: input.templateVersion,
      };
    },
    failQueuedExtractionJob: (input) => database.query(
      `UPDATE jobs
       SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = 1
       WHERE id = ? AND status = 'queued'`,
    ).run(input.errorCode, input.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH), input.failedAt, input.jobId).changes > 0,
    claimExtractionJobForProcessing: (input) => database.transaction(() => {
      const job = database.query(
        `SELECT j.id, j.template_id, j.template_version, j.source_file_key, j.source_mime_type, s.retained AS source_retained,
           s.retained_key IS NOT NULL AS source_retained_remotely
         FROM jobs j
         JOIN source_files s ON s.job_id = j.id
         WHERE j.id = ?`,
      ).get(input.jobId) as Omit<LocalClaimedExtractionJob, "job_id" | "fields" | "source_retained" | "source_retained_remotely"> & { id: string; source_retained: number; source_retained_remotely: number } | null;
      if (!job) return null;

      const claimed = database.query(
        `UPDATE jobs
         SET status = 'processing', updated_at = ?, error_code = NULL, error_message = NULL, next_retry_at = NULL, current_attempt = ?, model_name = NULL, model_gateway_route = NULL, model_configuration_revision = NULL
         WHERE id = ? AND status = 'queued' AND current_attempt < ?
           AND (next_retry_at IS NULL OR next_retry_at <= ?)`,
      ).run(input.claimedAt, input.attempt, input.jobId, input.attempt, input.claimedAt);
      if (claimed.changes < 1) return null;

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
        source_retained: Boolean(job.source_retained),
        source_retained_remotely: Boolean(job.source_retained_remotely),
        fields,
      };
    })(),
    recordExtractionJobModel: (input) => database.query(
      `UPDATE jobs
       SET model_name = ?, model_gateway_route = ?, model_configuration_revision = ?
       WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
    ).run(input.modelName, input.route, input.configurationRevision ?? null, input.jobId, input.attempt).changes > 0,
    completeExtractionJob: (input) => database.transaction(() => {
      const job = database.query(
        "SELECT status, current_attempt FROM jobs WHERE id = ?",
      ).get(input.jobId) as { status: string; current_attempt: number } | null;
      if (!job || job.status !== "processing" || job.current_attempt !== input.attempt) return false;

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
      for (const row of input.results) {
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
      }

      return database.query(
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
      ).changes > 0;
    })(),
    failExtractionJob: (input) => database.query(
      `UPDATE jobs
       SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?, last_failed_attempt = ?,
           model_name = COALESCE(?, model_name), model_gateway_route = COALESCE(?, model_gateway_route)
       WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
    ).run(
      input.errorCode,
      input.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      input.failedAt,
      input.attempt,
      input.modelName ?? null,
      input.route ?? null,
      input.jobId,
      input.attempt,
    ).changes > 0,
    requeueExtractionJob: (input) => database.query(
      `UPDATE jobs
       SET status = 'queued', error_code = ?, error_message = ?, updated_at = ?, next_retry_at = ?, last_failed_attempt = ?,
           model_name = COALESCE(?, model_name), model_gateway_route = COALESCE(?, model_gateway_route)
       WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
    ).run(
      input.errorCode,
      input.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
      input.requeuedAt,
      input.nextRetryAt,
      input.attempt,
      input.modelName ?? null,
      input.route ?? null,
      input.jobId,
      input.attempt,
    ).changes > 0,
    recoverExtractionJobs: (input) => database.transaction(() => {
      const limit = input.limit ?? 1_000;
      const scheduled: LocalScheduledExtractionJob[] = [];
      type RecoverableJob = { id: string; template_id: string; template_version: number; current_attempt: number };
      const exhaustRetries = (job: RecoverableJob, status: "queued" | "processing") => database.query(
        `UPDATE jobs
         SET status = 'failed', error_code = 'retry_exhausted', error_message = 'Extraction retry limit reached', updated_at = ?, last_failed_attempt = ?
         WHERE id = ? AND status = ?`,
      ).run(input.recoveredAt, job.current_attempt, job.id, status);
      const schedule = (job: RecoverableJob, notBefore?: string | null) => scheduled.push({
        job_id: job.id,
        template_id: job.template_id,
        template_version: job.template_version,
        attempt: job.current_attempt + 1,
        ...(notBefore ? { not_before: notBefore } : {}),
      });

      const queued = database.query(
        `SELECT id, template_id, template_version, current_attempt, next_retry_at
         FROM jobs INDEXED BY idx_jobs_runnable
         WHERE status = 'queued'
         ORDER BY COALESCE(next_retry_at, updated_at) ASC, id ASC
         LIMIT ?`,
      ).all(limit) as Array<RecoverableJob & { next_retry_at: string | null }>;
      for (const job of queued) {
        if (job.current_attempt >= input.maxAttempts) exhaustRetries(job, "queued");
        else schedule(job, job.next_retry_at);
      }

      const stale = database.query(
        `SELECT id, template_id, template_version, current_attempt
         FROM jobs
         WHERE status = 'processing' AND updated_at <= ?
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`,
      ).all(input.staleProcessingBefore, limit) as RecoverableJob[];
      for (const job of stale) {
        if (input.isJobActive?.(job.id)) continue;
        if (job.current_attempt >= input.maxAttempts) {
          exhaustRetries(job, "processing");
          continue;
        }
        const requeued = database.query(
          `UPDATE jobs
           SET status = 'queued', error_code = 'stale_processing', error_message = 'Recovered stale processing job', updated_at = ?, next_retry_at = NULL, last_failed_attempt = ?
           WHERE id = ? AND status = 'processing'`,
        ).run(input.recoveredAt, job.current_attempt, job.id);
        if (requeued.changes > 0) schedule(job);
      }
      return scheduled;
    })(),
    getTemplate: (templateId, version) => {
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) return null;
      const template = database.query(
        `SELECT id, name, description, status, current_version, created_at, updated_at
         FROM templates
         WHERE id = ? AND deleted_at IS NULL`,
      ).get(templateId) as LocalWorkspaceTemplate | null;
      if (!template) return null;
      const fields = readTemplateFields(templateId, version ?? template.current_version);
      if (version !== undefined && !fields.length) return null;
      return { ...template, fields };
    },
    deleteExtractionJob: (input) => database.transaction(() => {
      const job = database.query(
        `SELECT j.id AS job_id, j.status, j.source_file_key, s.retained_key AS retained_object_key
         FROM jobs j LEFT JOIN source_files s ON s.job_id = j.id WHERE j.id = ? LIMIT 1`,
      ).get(input.jobId) as DeletedLocalWorkspaceExtractionJob | null;
      if (!job) return null;
      // Commit cleanup intent with logical deletion so crashes and unlink errors
      // cannot lose the only pointer to a local Source binary or remote original.
      database.query("INSERT OR REPLACE INTO source_file_deletion_intents (job_id, source_file_key, retained_key) VALUES (?, ?, ?)")
        .run(job.job_id, job.source_file_key, job.retained_object_key ?? null);
      database.query("DELETE FROM job_results WHERE job_id = ?").run(job.job_id);
      database.query("DELETE FROM source_files WHERE job_id = ?").run(job.job_id);
      database.query("DELETE FROM jobs WHERE id = ?").run(job.job_id);
      return job;
    })(),
    getExtractionJob: readJob,
    getExtractionJobResults: readJobResults,
    getExtractionJobSummary: readJobSummary,
    getRetainedSourceFile: (jobId) => database.query(
      `SELECT key AS source_file_key, retained_key AS retained_object_key, mime_type AS source_mime_type, name AS source_name
       FROM source_files
       WHERE job_id = ? AND retained = 1 AND (retained_key IS NOT NULL OR deleted_at IS NULL)
       LIMIT 1`,
    ).get(jobId) as LocalRetainedSourceFile | null,
    getExtractionJobExports: (jobIds) => database.transaction(() => {
      if (!jobIds.length) return [];
      const placeholders = jobIds.map(() => "?").join(",");
      const size = database.query(`SELECT COALESCE(SUM(length(CAST(COALESCE(r.answer_json, '') AS BLOB)) + length(CAST(COALESCE(r.evidence_text, '') AS BLOB))), 0) AS bytes
        FROM job_results r JOIN jobs j ON j.id = r.job_id WHERE j.status = 'completed' AND r.job_id IN (${placeholders})`).get(...jobIds) as { bytes: number };
      if (size.bytes > 32 * 1024 * 1024) throw new RangeError("Selected results exceed the 32 MiB export limit; select fewer Documents");
      const templates = new Map<string, Pick<LocalWorkspaceExtractionJobExport, "fields" | "template_name">>();
      return jobIds.flatMap((id) => {
        const job = readJob(id);
        if (!job || (job.status !== "completed" && job.status !== "failed")) return [];
        const key = `${job.template_id}\u0000${job.template_version}`;
        let template = templates.get(key);
        if (!template) {
          const row = database.query("SELECT name FROM templates WHERE id = ?").get(job.template_id) as { name: string } | null;
          template = { template_name: row?.name || job.template_id, fields: readTemplateFields(job.template_id, job.template_version) };
          templates.set(key, template);
        }
        return [{ ...job, ...template }];
      });
    })(),
    getSubmissionTemplate: (templateId) => {
      const template = database.query(
        `SELECT id, current_version
         FROM templates
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
      ).get(templateId) as { id: string; current_version: number } | null;
      if (!template) return null;
      const { count } = database.query(
        `SELECT COUNT(*) AS count
         FROM template_fields
         WHERE template_id = ? AND version = ?`,
      ).get(template.id, template.current_version) as { count: number };
      if (count < 1) return null;
      return { template_id: template.id, template_version: template.current_version };
    },
    listTemplates: () => database.query(
      `SELECT id, name, description, status, current_version, created_at, updated_at
       FROM templates
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC`,
    ).all() as LocalWorkspaceTemplate[],
    countExtractionJobs: () =>
      (database.query("SELECT count FROM job_totals WHERE singleton = 1").get() as { count: number }).count,
    getExtractionJobCounts: () => {
      const status_counts = { queued: 0, processing: 0, completed: 0, failed: 0 };
      const rows = database.query("SELECT status, count FROM job_status_totals").all() as Array<{ status: keyof typeof status_counts; count: number }>;
      for (const row of rows) status_counts[row.status] = row.count;
      return { total: Object.values(status_counts).reduce((sum, count) => sum + count, 0), status_counts };
    },
    listExtractionJobModels: () => (database.query(
      `SELECT DISTINCT model_name
       FROM jobs
       WHERE model_name IS NOT NULL AND TRIM(model_name) != ''
       ORDER BY model_name COLLATE NOCASE ASC`,
    ).all() as Array<{ model_name: string }>).map((row) => row.model_name),
    listExtractionJobs: (input = {}) => {
      const search = (input.search ?? "").trim().toLowerCase();
      const clauses: string[] = [];
      const parameters: Array<string | number> = [];
      if (search) {
        // FTS indexes stable metadata only. Status terms use the literal path so
        // lifecycle transitions do not rewrite the search index. Searches too short
        // for trigrams, or containing NUL, use only the literal path.
        if ([...search].length >= 3 && !search.includes("\u0000")
          && !["queued", "processing", "completed", "failed"].some((status) => status.includes(search))) {
          const candidates = database.query("SELECT rowid FROM job_search WHERE job_search MATCH ? LIMIT 1001")
            .all(`"${search.replaceAll('"', '""')}"`) as { rowid: number }[];
          if (!candidates.length) return [];
          // Broad terms should read a page in date order rather than
          // materialize and sort a huge list of matching FTS row IDs.
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
      // The limit is interpolated, so only a positive safe integer may reach the SQL text.
      const limit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? ` LIMIT ${input.limit}` : "";
      return (database.query(
        `${JOB_SUMMARY_SELECT}${where} ORDER BY j.created_at DESC, j.id DESC${limit}`,
      ).all(...parameters) as JobSummaryRow[]).map(withRetainedFlag);
    },
    listRetainedTerminalSourceFiles: (input) => {
      const limit = input.limit ?? 1_000;
      const deleted = database.query("SELECT job_id, source_file_key, retained_key AS retained_object_key FROM source_file_deletion_intents ORDER BY job_id LIMIT ?")
        .all(limit) as LocalRetainedTerminalSourceFile[];
      if (deleted.length === limit) return deleted;
      const terminal = database.query(
        `SELECT j.id AS job_id, s.key AS source_file_key, NULL AS retained_object_key
         FROM source_files s
         CROSS JOIN jobs j ON j.id = s.job_id
         WHERE s.deleted_at IS NULL
           AND ((s.retained = 0 AND (j.status = 'completed' OR (j.status = 'failed' AND j.updated_at <= ?)))
             -- A remotely retained original needs no local working copy once processing ends.
             OR (s.retained_key IS NOT NULL AND j.status IN ('completed', 'failed')))
         ORDER BY j.updated_at ASC, j.id ASC
         LIMIT ?`,
      ).all(input.failedBefore, limit - deleted.length) as LocalRetainedTerminalSourceFile[];
      return [...deleted, ...terminal];
    },
    markSourceFileCleaned: (input) => database.transaction(() => {
      const source = database.query(
        `UPDATE source_files
         SET deleted_at = COALESCE(deleted_at, ?)
         WHERE job_id = ? AND key = ?`,
      ).run(input.cleanedAt, input.jobId, input.sourceFileKey);
      const intent = database.query("DELETE FROM source_file_deletion_intents WHERE job_id = ? AND source_file_key = ?")
        .run(input.jobId, input.sourceFileKey);
      return source.changes > 0 || intent.changes > 0;
    })(),
  };
}

/** SQLite returns `source_retained` as 0/1. */
type JobSummaryRow = Omit<LocalWorkspaceExtractionJobSummary, "source_retained"> & { source_retained: number };

function withRetainedFlag(row: JobSummaryRow): LocalWorkspaceExtractionJobSummary {
  return { ...row, source_retained: Boolean(row.source_retained) };
}

function parseStoredAnswer(answerJson: string | null): unknown {
  if (answerJson === null) return null;
  try {
    return JSON.parse(answerJson);
  } catch {
    return null;
  }
}

function ensureProductSchemaColumns(database: Database): void {
  const knownColumns = new Set((database.query("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((column) => column.name));
  for (const [name, type] of [
    ["model_name", "TEXT"],
    ["model_gateway_route", "TEXT"],
    ["next_retry_at", "TEXT"],
    ["model_configuration_revision", "INTEGER"],
  ]) {
    if (!knownColumns.has(name)) database.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_jobs_model_created_id ON jobs(model_name, created_at DESC, id DESC)");
}

function migrateProductSchema(database: Database): void {
  database.transaction(() => {
    const applied = new Set(
      (database.query("SELECT version FROM product_schema_version").all() as Array<{ version: number }>).map((row) => row.version),
    );
    for (const [version, sql] of PRODUCT_MIGRATIONS) {
      if (applied.has(version)) continue;
      database.exec(sql);
      database.query("INSERT INTO product_schema_version(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    }
  }).immediate();
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

  CREATE TABLE IF NOT EXISTS source_file_deletion_intents (
    job_id TEXT PRIMARY KEY,
    source_file_key TEXT NOT NULL
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

const PRODUCT_MIGRATIONS: Array<[version: number, sql: string]> = [
  [1, `
    DROP INDEX IF EXISTS idx_source_files_job;
    DROP INDEX IF EXISTS idx_job_results_job;
    DROP INDEX IF EXISTS idx_jobs_status_updated;
    CREATE INDEX IF NOT EXISTS idx_jobs_active_updated_id
      ON jobs(status, updated_at, id)
      WHERE status = 'queued' OR status = 'processing';
  `],
  [2, `
    CREATE INDEX IF NOT EXISTS idx_jobs_terminal_cleanup_updated_id
      ON jobs(status, updated_at, id)
      WHERE status = 'completed' OR status = 'failed';
  `],
  [3, `
    CREATE TABLE workspace_model_configuration (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      gateway_url TEXT NOT NULL, model_name TEXT NOT NULL, credential_ciphertext TEXT NOT NULL,
      sequential_calls INTEGER NOT NULL CHECK (sequential_calls IN (0, 1)),
      supports_pdf_input INTEGER NOT NULL CHECK (supports_pdf_input IN (0, 1)),
      supports_structured_output INTEGER NOT NULL CHECK (supports_structured_output IN (0, 1)),
      revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE workspace_model_revision (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL);
  `],
  [4, `
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
  `],
  [5, `
    CREATE TABLE job_status_totals (status TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK (count >= 0));
    INSERT INTO job_status_totals SELECT status, COUNT(*) FROM jobs GROUP BY status;
    INSERT OR IGNORE INTO job_status_totals VALUES ('queued', 0), ('processing', 0), ('completed', 0), ('failed', 0);
    CREATE TRIGGER jobs_status_count_insert AFTER INSERT ON jobs BEGIN
      UPDATE job_status_totals SET count = count + 1 WHERE status = new.status;
    END;
    CREATE TRIGGER jobs_status_count_delete AFTER DELETE ON jobs BEGIN
      UPDATE job_status_totals SET count = count - 1 WHERE status = old.status;
    END;
    CREATE TRIGGER jobs_status_count_update AFTER UPDATE OF status ON jobs WHEN old.status IS NOT new.status BEGIN
      UPDATE job_status_totals SET count = count - 1 WHERE status = old.status;
      UPDATE job_status_totals SET count = count + 1 WHERE status = new.status;
    END;
  `],
  // Existing jobs predate Source file retention: none of their originals were retained.
  [6, `
    ALTER TABLE source_files ADD COLUMN retained INTEGER NOT NULL DEFAULT 0 CHECK (retained IN (0, 1));
    DROP INDEX IF EXISTS idx_sources_uncleaned;
    CREATE INDEX idx_sources_uncleaned ON source_files(job_id, key) WHERE deleted_at IS NULL AND retained = 0;
  `],
  // Remote originals: the local key stays the working copy; retained_key names the retained object.
  [7, `
    ALTER TABLE source_files ADD COLUMN retained_key TEXT;
    ALTER TABLE source_file_deletion_intents ADD COLUMN retained_key TEXT;
    DROP INDEX IF EXISTS idx_sources_uncleaned;
    CREATE INDEX idx_sources_uncleaned ON source_files(job_id, key)
      WHERE deleted_at IS NULL AND (retained = 0 OR retained_key IS NOT NULL);
  `],
  // Saved Evaluation documents own their originals independently of jobs; receipts make saves idempotent.
  [8, `
    CREATE TABLE evaluation_documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_name TEXT,
      source_mime_type TEXT NOT NULL,
      source_byte_size INTEGER NOT NULL CHECK (source_byte_size > 0),
      source_page_count INTEGER CHECK (source_page_count IS NULL OR source_page_count > 0),
      source_file_key TEXT,
      retained_object_key TEXT,
      reference_json TEXT NOT NULL,
      reference_fields_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      updated_by_user_id TEXT NOT NULL,
      updated_by_name TEXT NOT NULL,
      CHECK (source_file_key IS NOT NULL OR retained_object_key IS NOT NULL)
    );
    CREATE INDEX idx_evaluation_documents_updated_id ON evaluation_documents(updated_at DESC, id DESC);
    CREATE TABLE evaluation_document_save_receipts (
      operation_id TEXT PRIMARY KEY,
      digest TEXT NOT NULL,
      document_id TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('saved', 'deleted')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_evaluation_document_save_receipts_document ON evaluation_document_save_receipts(document_id);
    CREATE TABLE evaluation_document_deletion_intents (
      document_id TEXT PRIMARY KEY,
      source_file_key TEXT,
      retained_object_key TEXT,
      created_at TEXT NOT NULL
    );
  `],
];

const STARTER_INVOICE_FIELDS: FieldDefinition[] = [
  { id: "invoice_number", name: "Invoice Number", description: "Unique invoice identifier.", data_type: "string" },
  { id: "invoice_date", name: "Invoice Date", description: "Date shown on the invoice.", data_type: "date" },
  { id: "vendor_name", name: "Vendor Name", description: "Name of the supplier issuing the invoice.", data_type: "string" },
  { id: "total_amount", name: "Total Amount", description: "Total amount due on the invoice.", data_type: "number" },
  { id: "currency", name: "Currency", description: "Currency code used for the totals (e.g. USD).", data_type: "string" },
];
