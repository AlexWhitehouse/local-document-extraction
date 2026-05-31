import { DurableObject } from "cloudflare:workers";
import type {
  ClaimedWorkspaceExtractionJob,
  ClaimWorkspaceExtractionJobForProcessingInput,
  CompleteWorkspaceExtractionJobInput,
  CreateQueuedWorkspaceExtractionJobInput,
  CreateWorkspaceTemplateInput,
  CreatedWorkspaceTemplate,
  DeleteWorkspaceExtractionJobInput,
  FailQueuedWorkspaceExtractionJobInput,
  FailWorkspaceExtractionJobInput,
  ListedWorkspaceExtractionJob,
  ListWorkspaceResidualSourceFilesForCleanupInput,
  ListWorkspaceExtractionJobsInput,
  ListWorkspaceExtractionJobsResult,
  MarkWorkspaceSourceFileCleanedInput,
  ListedWorkspaceTemplate,
  NoteExtractionWorkflowStartFailureInput,
  QueuedWorkspaceExtractionJob,
  StartExtractionWorkflowInput,
  UpdatedWorkspaceTemplate,
  UpdateWorkspaceTemplateInput,
  WorkspaceExtractionJobDeletionCandidate,
  WorkspaceProductStoreFailure,
  WorkspaceExtractionJobDetail,
  WorkspaceExtractionJobSummary,
  WorkspaceResidualSourceFile,
  WorkspaceSubmissionTemplate,
  WorkspaceTemplateDetail,
  WorkspaceTemplateField,
} from "./workspaceProductStoreClient";

const WORKSPACE_PRODUCT_SCHEMA_VERSION = 4;

type SchemaVersionRow = {
  version: number;
};

type TableColumnRow = {
  name: string;
};

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  current_version: number;
  created_at: string;
  updated_at: string;
};

type TemplateFieldRow = {
  id: string;
  name: string;
  description: string;
  data_type: WorkspaceTemplateField["data_type"];
  position: number;
};

type SubmissionTemplateRow = {
  id: string;
  current_version: number;
};

type ExtractionJobRow = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  template_id: string;
  template_version: number;
  source_name: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  current_attempt: number | null;
  completed_attempt: number | null;
  last_failed_attempt: number | null;
  sort_at: string;
};

export class WorkspaceProductStore extends DurableObject<Env> {
  private schemaReady = false;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      type: "workspace_live_update",
      connected_at: new Date().toISOString(),
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async createTemplate(input: CreateWorkspaceTemplateInput): Promise<CreatedWorkspaceTemplate | WorkspaceProductStoreFailure> {
    this.ensureSchema();

    const fieldLimitFailure = enforceFieldLimit(input.fields.length, input.maxFieldsPerTemplate);
    if (fieldLimitFailure) {
      return fieldLimitFailure;
    }

    if (isLimitConfigured(input.maxTemplates)) {
      const currentTemplates = this.ctx.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM templates WHERE deleted_at IS NULL")
        .one();
      if (Number(currentTemplates.count) >= input.maxTemplates) {
        return workspaceProductStoreFailure(
          400,
          "template_limit_exceeded",
          "Workspace Template limit reached",
        );
      }
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO templates (id, name, description, status, current_version, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, 'active', 1, ?, ?, NULL)`,
        input.templateId,
        input.name,
        input.description,
        input.createdAt,
        input.createdAt,
      );

      input.fields.forEach((field, index) => {
        this.ctx.storage.sql.exec(
          `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
           VALUES (?, 1, ?, ?, ?, ?, 1, ?)`,
          input.templateId,
          field.id,
          field.name,
          field.description,
          field.data_type,
          index,
        );
      });
    });

    return {
      template_id: input.templateId,
      version: 1,
      status: "active",
    };
  }

  async listTemplates(): Promise<ListedWorkspaceTemplate[]> {
    this.ensureSchema();

    return this.ctx.storage.sql
      .exec<TemplateRow>(
        `SELECT id, name, description, status, current_version, created_at, updated_at
         FROM templates
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC`,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        current_version: Number(row.current_version),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
  }

  async getTemplate(templateId: string): Promise<WorkspaceTemplateDetail | null> {
    this.ensureSchema();

    const template = this.ctx.storage.sql
      .exec<TemplateRow>(
        `SELECT id, name, description, status, current_version, created_at, updated_at
         FROM templates
         WHERE id = ? AND deleted_at IS NULL`,
        templateId,
      )
      .toArray()[0];

    if (!template) {
      return null;
    }

    const version = Number(template.current_version);
    const fields = this.ctx.storage.sql
      .exec<TemplateFieldRow>(
        `SELECT field_id AS id, name, description, data_type, position
         FROM template_fields
         WHERE template_id = ? AND version = ?
         ORDER BY position ASC`,
        templateId,
        version,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        data_type: row.data_type,
        position: Number(row.position),
      }));

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      status: template.status,
      current_version: version,
      created_at: template.created_at,
      updated_at: template.updated_at,
      fields,
    };
  }

  async updateTemplate(input: UpdateWorkspaceTemplateInput): Promise<UpdatedWorkspaceTemplate | WorkspaceProductStoreFailure | null> {
    this.ensureSchema();

    const existing = this.ctx.storage.sql
      .exec<Pick<TemplateRow, "id" | "name" | "description" | "current_version">>(
        `SELECT id, name, description, current_version
         FROM templates
         WHERE id = ? AND deleted_at IS NULL`,
        input.templateId,
      )
      .toArray()[0];

    if (!existing) {
      return null;
    }

    if (input.fields) {
      const fieldLimitFailure = enforceFieldLimit(input.fields.length, input.maxFieldsPerTemplate);
      if (fieldLimitFailure) {
        return fieldLimitFailure;
      }
    }

    const nextVersion = input.fields ? Number(existing.current_version) + 1 : Number(existing.current_version);
    const nextName = input.name ?? existing.name;
    const nextDescription = input.description !== undefined ? input.description : existing.description;

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE templates
         SET name = ?, description = ?, current_version = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
        nextName,
        nextDescription,
        nextVersion,
        input.updatedAt,
        input.templateId,
      );

      input.fields?.forEach((field, index) => {
        this.ctx.storage.sql.exec(
          `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          input.templateId,
          nextVersion,
          field.id,
          field.name,
          field.description,
          field.data_type,
          index,
        );
      });
    });

    return {
      template_id: input.templateId,
      version: nextVersion,
      status: "active",
    };
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    this.ensureSchema();

    const existing = this.ctx.storage.sql
      .exec<Pick<TemplateRow, "id">>(
        `SELECT id
         FROM templates
         WHERE id = ? AND deleted_at IS NULL`,
        templateId,
      )
      .toArray()[0];

    if (!existing) {
      return false;
    }

    const deletedAt = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE templates
       SET status = 'deleted', deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
      deletedAt,
      deletedAt,
      templateId,
    );

    return true;
  }

  async validateTemplateForDocumentSubmission(templateId: string): Promise<WorkspaceSubmissionTemplate | WorkspaceProductStoreFailure> {
    this.ensureSchema();

    const template = this.ctx.storage.sql
      .exec<SubmissionTemplateRow>(
        `SELECT id, current_version
         FROM templates
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
        templateId,
      )
      .toArray()[0];

    if (!template) {
      return workspaceProductStoreFailure(404, "template_not_found", "Template not found");
    }

    const version = Number(template.current_version);
    const fields = this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM template_fields
         WHERE template_id = ? AND version = ?`,
        templateId,
        version,
      )
      .one();

    if (Number(fields.count) < 1) {
      return workspaceProductStoreFailure(400, "template_invalid", "Template has no fields");
    }

    return {
      template_id: template.id,
      template_version: version,
    };
  }

  async createQueuedExtractionJob(input: CreateQueuedWorkspaceExtractionJobInput): Promise<QueuedWorkspaceExtractionJob | WorkspaceProductStoreFailure> {
    this.ensureSchema();

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT INTO source_files (key, job_id, mime_type, name, page_count, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        input.sourceFileKey,
        input.jobId,
        input.sourceMimeType,
        input.sourceName,
        input.sourceFilePageCount,
        input.submittedAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO jobs (
           id, template_id, template_version, status,
           source_file_key, source_mime_type, source_name,
           created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
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

    this.broadcastExtractionJobLifecycle(input.jobId);

    return {
      job_id: input.jobId,
      status: "queued",
      source_name: input.sourceName,
      template_id: input.templateId,
      template_version: input.templateVersion,
    };
  }

  async failQueuedExtractionJob(input: FailQueuedWorkspaceExtractionJobInput): Promise<boolean> {
    if (!this.ensureExistingSchema()) {
      return false;
    }

    let changed = 0;
    this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql.exec(
        `UPDATE jobs
         SET status = 'failed',
             error_code = ?,
             error_message = ?,
             updated_at = ?,
             last_failed_attempt = CASE WHEN last_failed_attempt = 0 THEN 1 ELSE last_failed_attempt END
         WHERE id = ? AND status = 'queued'`,
        input.errorCode,
        input.errorMessage.slice(0, 2000),
        input.failedAt,
        input.jobId,
      );
      changed = Number(result.rowsWritten || 0);

      this.ctx.storage.sql.exec(
        `UPDATE source_files
         SET deleted_at = ?
         WHERE job_id = ? AND deleted_at IS NULL`,
        input.failedAt,
        input.jobId,
      );
    });

    if (changed > 0) {
      this.broadcastExtractionJobLifecycle(input.jobId);
    }

    return changed > 0;
  }

  async startExtractionWorkflow(input: StartExtractionWorkflowInput): Promise<boolean> {
    if (!this.ensureExistingSchema()) {
      return false;
    }

    const result = this.ctx.storage.sql.exec(
      `UPDATE jobs
       SET workflow_instance_id = ?,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'queued'
         AND workflow_instance_id IS NULL
         AND current_attempt < ?`,
      input.workflowInstanceId,
      input.startedAt,
      input.jobId,
      input.attempt,
    );

    return Number(result.rowsWritten || 0) > 0;
  }

  async noteExtractionWorkflowStartFailure(input: NoteExtractionWorkflowStartFailureInput): Promise<void> {
    if (!this.ensureExistingSchema()) {
      return;
    }

    this.ctx.storage.sql.exec(
      `UPDATE jobs
       SET error_code = ?,
           error_message = ?,
           updated_at = ?,
           workflow_instance_id = NULL
       WHERE id = ? AND status = 'queued'`,
      input.errorCode,
      input.errorMessage.slice(0, 2000),
      input.failedAt,
      input.jobId,
    );
  }

  async claimExtractionJobForProcessing(input: ClaimWorkspaceExtractionJobForProcessingInput): Promise<ClaimedWorkspaceExtractionJob | null> {
    if (!this.ensureExistingSchema()) {
      return null;
    }

    let claimed: ClaimedWorkspaceExtractionJob | null = null;

    this.ctx.storage.transactionSync(() => {
      const job = this.ctx.storage.sql
        .exec<{
          id: string;
          template_id: string;
          template_version: number;
          status: string;
          source_file_key: string;
          source_mime_type: string;
          current_attempt: number;
        }>(
          `SELECT id, template_id, template_version, status, source_file_key, source_mime_type, current_attempt
           FROM jobs
           WHERE id = ?`,
          input.jobId,
        )
        .toArray()[0];

      if (!job || job.status !== "queued" || Number(job.current_attempt || 0) >= input.attempt) {
        return;
      }

      const result = this.ctx.storage.sql.exec(
        `UPDATE jobs
         SET status = 'processing',
             updated_at = ?,
             error_code = NULL,
             error_message = NULL,
             workflow_started_at = ?,
             current_attempt = ?
         WHERE id = ? AND status = 'queued' AND current_attempt < ?`,
        input.claimedAt,
        input.claimedAt,
        input.attempt,
        input.jobId,
        input.attempt,
      );

      if (Number(result.rowsWritten || 0) < 1) {
        return;
      }

      const fields = this.ctx.storage.sql
        .exec<TemplateFieldRow>(
          `SELECT field_id AS id, name, description, data_type, position
           FROM template_fields
           WHERE template_id = ? AND version = ?
           ORDER BY position ASC`,
          job.template_id,
          Number(job.template_version),
        )
        .toArray()
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          data_type: row.data_type,
        }));

      claimed = {
        job_id: job.id,
        template_id: job.template_id,
        template_version: Number(job.template_version),
        source_file_key: job.source_file_key,
        source_mime_type: job.source_mime_type,
        fields,
      };
    });

    if (claimed) {
      this.broadcastExtractionJobLifecycle(input.jobId);
    }

    return claimed;
  }

  async completeExtractionJob(input: CompleteWorkspaceExtractionJobInput): Promise<boolean> {
    if (!this.ensureExistingSchema()) {
      return false;
    }

    let completed = false;

    this.ctx.storage.transactionSync(() => {
      const job = this.ctx.storage.sql
        .exec<{ status: string; current_attempt: number }>(
          "SELECT status, current_attempt FROM jobs WHERE id = ?",
          input.jobId,
        )
        .toArray()[0];

      if (
        !job ||
        job.status !== "processing" ||
        Number(job.current_attempt || 0) !== input.attempt
      ) {
        return;
      }

      input.results.forEach((row) => {
        this.ctx.storage.sql.exec(
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

      const result = this.ctx.storage.sql.exec(
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
        input.completedAt,
        input.completedAt,
        input.modelName,
        input.route,
        input.attempt,
        input.jobId,
        input.attempt,
      );

      completed = Number(result.rowsWritten || 0) > 0;
    });

    if (completed) {
      this.broadcastExtractionJobLifecycle(input.jobId);
    }

    return completed;
  }

  async failExtractionJob(input: FailWorkspaceExtractionJobInput): Promise<boolean> {
    if (!this.ensureExistingSchema()) {
      return false;
    }

    const result = this.ctx.storage.sql.exec(
      `UPDATE jobs
       SET status = 'failed',
           error_code = ?,
           error_message = ?,
           updated_at = ?,
           last_failed_attempt = ?
       WHERE id = ? AND status = 'processing' AND current_attempt = ?`,
      input.errorCode,
      input.errorMessage.slice(0, 2000),
      input.failedAt,
      input.attempt,
      input.jobId,
      input.attempt,
    );

    const failed = Number(result.rowsWritten || 0) > 0;
    if (failed) {
      this.broadcastExtractionJobLifecycle(input.jobId);
    }

    return failed;
  }

  async listExtractionJobs(input: ListWorkspaceExtractionJobsInput): Promise<ListWorkspaceExtractionJobsResult> {
    this.ensureSchema();

    const filters = ["status IN ('queued', 'processing', 'completed', 'failed')"];
    const params: Array<string | number> = [];
    const search = input.search.trim().slice(0, 120);

    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      filters.push("(id LIKE ? ESCAPE '\\' OR source_name LIKE ? ESCAPE '\\' OR template_id LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern, pattern, pattern);
    }

    if (input.cursor) {
      filters.push("(COALESCE(updated_at, created_at) < ? OR (COALESCE(updated_at, created_at) = ? AND id < ?))");
      params.push(input.cursor.sort, input.cursor.sort, input.cursor.id);
    }

    const rows = this.ctx.storage.sql
      .exec<ExtractionJobRow>(
        `SELECT id, status, template_id, template_version, source_name, error_code, error_message,
                created_at, updated_at, completed_at, current_attempt, completed_attempt, last_failed_attempt,
                COALESCE(updated_at, created_at) AS sort_at
         FROM jobs
         WHERE ${filters.join(" AND ")}
         ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
         LIMIT ?`,
        ...params,
        input.limit + 1,
      )
      .toArray();

    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1] || null;

    return {
      jobs: page.map((row): ListedWorkspaceExtractionJob => ({
        job_id: row.id,
        status: row.status,
        source_name: row.source_name,
        template_id: row.template_id,
        template_version: Number(row.template_version),
        error_code: row.error_code,
        error_message: row.error_message,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        current_attempt: Number(row.current_attempt || 0),
        completed_attempt: Number(row.completed_attempt || 0),
        last_failed_attempt: Number(row.last_failed_attempt || 0),
        results: [],
      })),
      nextCursor: rows.length > input.limit && last ? { sort: last.sort_at, id: last.id } : null,
      has_more: rows.length > input.limit,
    };
  }

  async getExtractionJob(jobId: string): Promise<WorkspaceExtractionJobDetail | null> {
    this.ensureSchema();

    const job = this.ctx.storage.sql
      .exec<ExtractionJobRow>(
        `SELECT id, status, template_id, template_version, source_name, error_code, error_message,
                created_at, updated_at, completed_at, current_attempt, completed_attempt, last_failed_attempt,
                COALESCE(updated_at, created_at) AS sort_at
         FROM jobs
         WHERE id = ? AND status IN ('queued', 'processing', 'completed', 'failed')`,
        jobId,
      )
      .toArray()[0];

    if (!job) {
      return null;
    }

    const summary = {
      job_id: job.id,
      status: job.status,
      source_name: job.source_name,
      template_id: job.template_id,
      template_version: Number(job.template_version),
      error_code: job.error_code,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
      current_attempt: Number(job.current_attempt || 0),
      completed_attempt: Number(job.completed_attempt || 0),
      last_failed_attempt: Number(job.last_failed_attempt || 0),
    };

    if (job.status !== "completed") {
      return summary;
    }

    const results = this.ctx.storage.sql
      .exec<{
        field_id: string;
        name: string;
        data_type: WorkspaceTemplateField["data_type"];
        status: string;
        answer_json: string | null;
        confidence: number | null;
        evidence_text: string | null;
      }>(
        `SELECT
           r.field_id,
           f.name,
           f.data_type,
           r.status,
           r.answer_json,
           r.confidence,
           r.evidence_text
         FROM job_results r
         JOIN template_fields f
           ON f.template_id = ?
          AND f.version = ?
          AND f.field_id = r.field_id
         WHERE r.job_id = ?
         ORDER BY f.position ASC`,
        job.template_id,
        Number(job.template_version),
        job.id,
      )
      .toArray()
      .map((row) => ({
        field_id: row.field_id,
        name: row.name,
        data_type: row.data_type,
        status: row.status,
        answer: row.answer_json ? safeJsonParse(row.answer_json) : null,
        confidence: row.confidence,
        evidence: row.evidence_text,
      }));

    return { ...summary, results };
  }

  async getExtractionJobDeletionCandidate(jobId: string): Promise<WorkspaceExtractionJobDeletionCandidate | null> {
    this.ensureSchema();

    const job = this.ctx.storage.sql
      .exec<{ id: string; source_file_key: string | null }>(
        `SELECT id, source_file_key
         FROM jobs
         WHERE id = ?`,
        jobId,
      )
      .toArray()[0];

    if (!job) {
      return null;
    }

    return {
      job_id: job.id,
      source_file_key: job.source_file_key,
    };
  }

  async deleteExtractionJob(input: DeleteWorkspaceExtractionJobInput): Promise<boolean> {
    this.ensureSchema();

    let deleted = false;

    this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ id: string }>(
          "SELECT id FROM jobs WHERE id = ?",
          input.jobId,
        )
        .toArray()[0];

      if (!existing) {
        return;
      }

      this.ctx.storage.sql.exec(
        "DELETE FROM job_results WHERE job_id = ?",
        input.jobId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM source_files WHERE job_id = ?",
        input.jobId,
      );
      const result = this.ctx.storage.sql.exec(
        "DELETE FROM jobs WHERE id = ?",
        input.jobId,
      );
      deleted = Number(result.rowsWritten || 0) > 0;
    });

    return deleted;
  }

  async markSourceFileCleaned(input: MarkWorkspaceSourceFileCleanedInput): Promise<boolean> {
    if (!this.ensureExistingSchema()) {
      return false;
    }

    const result = this.ctx.storage.sql.exec(
      `UPDATE source_files
       SET deleted_at = COALESCE(deleted_at, ?)
       WHERE job_id = ? AND key = ?`,
      input.cleanedAt,
      input.jobId,
      input.sourceFileKey,
    );

    return Number(result.rowsWritten || 0) > 0;
  }

  async listResidualSourceFilesForCleanup(input: ListWorkspaceResidualSourceFilesForCleanupInput): Promise<WorkspaceResidualSourceFile[]> {
    if (!this.ensureExistingSchema()) {
      return [];
    }

    const limit = Math.max(1, Math.min(input.limit, 100));

    return this.ctx.storage.sql
      .exec<{ job_id: string; key: string }>(
        `SELECT job_id, key
         FROM source_files
         WHERE deleted_at IS NULL
         ORDER BY created_at ASC, key ASC
         LIMIT ?`,
        limit,
      )
      .toArray()
      .map((row) => ({
        job_id: row.job_id,
        source_file_key: row.key,
      }));
  }

  async eraseWorkspaceProductData(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1000, "Workspace deleted");
    }

    await this.ctx.storage.deleteAll();
    this.schemaReady = false;
  }

  private broadcastExtractionJobLifecycle(jobId: string): void {
    const job = this.readExtractionJobSummary(jobId);
    if (!job) {
      return;
    }

    const message = JSON.stringify({
      version: 1,
      events: [
        {
          type: "extraction_job_lifecycle",
          job,
        },
      ],
    });

    for (const socket of this.ctx.getWebSockets()) {
      socket.send(message);
    }
  }

  private readExtractionJobSummary(jobId: string): WorkspaceExtractionJobSummary | null {
    if (!this.ensureExistingSchema()) {
      return null;
    }

    const row = this.ctx.storage.sql
      .exec<ExtractionJobRow>(
        `SELECT id, status, template_id, template_version, source_name, error_code, error_message,
                created_at, updated_at, completed_at, current_attempt, completed_attempt, last_failed_attempt,
                COALESCE(updated_at, created_at) AS sort_at
         FROM jobs
         WHERE id = ? AND status IN ('queued', 'processing', 'completed', 'failed')`,
        jobId,
      )
      .toArray()[0];

    if (!row) {
      return null;
    }

    return {
      job_id: row.id,
      status: row.status,
      source_name: row.source_name,
      template_id: row.template_id,
      template_version: Number(row.template_version),
      error_code: row.error_code,
      error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      current_attempt: Number(row.current_attempt || 0),
      completed_attempt: Number(row.completed_attempt || 0),
      last_failed_attempt: Number(row.last_failed_attempt || 0),
    };
  }

  private ensureExistingSchema(): boolean {
    if (!this.hasProductSchema()) {
      return false;
    }

    this.ensureSchema();
    return true;
  }

  private hasProductSchema(): boolean {
    if (this.schemaReady) {
      return true;
    }

    const row = this.ctx.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_schema_migrations'",
      )
      .toArray()[0];

    return Boolean(row);
  }

  private ensureSchema(): void {
    if (this.schemaReady) {
      return;
    }

    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS product_schema_migrations (
         version INTEGER PRIMARY KEY,
         applied_at TEXT NOT NULL
       )`,
    );

    const current = this.ctx.storage.sql
      .exec<SchemaVersionRow>("SELECT COALESCE(MAX(version), 0) AS version FROM product_schema_migrations")
      .one();
    if (Number(current.version) >= WORKSPACE_PRODUCT_SCHEMA_VERSION) {
      this.schemaReady = true;
      return;
    }

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS templates (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           description TEXT,
           status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
           current_version INTEGER NOT NULL,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT
         )`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS template_fields (
           template_id TEXT NOT NULL,
           version INTEGER NOT NULL,
           field_id TEXT NOT NULL,
           name TEXT NOT NULL,
           description TEXT NOT NULL,
           data_type TEXT NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'date', 'object', 'array', 'array<object>')),
           required INTEGER NOT NULL,
           position INTEGER NOT NULL,
           PRIMARY KEY (template_id, version, field_id)
         )`,
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_templates_deleted_created ON templates(deleted_at, created_at)",
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_template_fields_template_version_position ON template_fields(template_id, version, position)",
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS source_files (
           key TEXT PRIMARY KEY,
           job_id TEXT NOT NULL UNIQUE,
           mime_type TEXT NOT NULL,
           name TEXT,
           page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
           created_at TEXT NOT NULL,
           deleted_at TEXT
         )`,
      );
      this.ensureSourceFilePageCountColumn();
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_source_files_job ON source_files(job_id)",
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS jobs (
           id TEXT PRIMARY KEY,
           template_id TEXT NOT NULL,
           template_version INTEGER NOT NULL,
           status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
           source_file_key TEXT NOT NULL,
           source_mime_type TEXT NOT NULL,
           source_name TEXT,
           workflow_instance_id TEXT,
           workflow_started_at TEXT,
           current_attempt INTEGER NOT NULL DEFAULT 0,
           completed_attempt INTEGER NOT NULL DEFAULT 0,
           last_failed_attempt INTEGER NOT NULL DEFAULT 0,
           model_name TEXT,
           ai_gateway_route TEXT,
           prompt_version TEXT,
           schema_version TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           completed_at TEXT,
           error_code TEXT,
           error_message TEXT
         )`,
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at)",
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS job_results (
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
         )`,
      );
      this.ctx.storage.sql.exec(
        "CREATE INDEX IF NOT EXISTS idx_job_results_job ON job_results(job_id)",
      );
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO product_schema_migrations (version, applied_at) VALUES (?, ?)",
        WORKSPACE_PRODUCT_SCHEMA_VERSION,
        new Date().toISOString(),
      );
    });
    this.schemaReady = true;
  }

  private ensureSourceFilePageCountColumn(): void {
    const columns = this.ctx.storage.sql
      .exec<TableColumnRow>("PRAGMA table_info(source_files)")
      .toArray();

    if (columns.some((column) => column.name === "page_count")) {
      return;
    }

    this.ctx.storage.sql.exec(
      "ALTER TABLE source_files ADD COLUMN page_count INTEGER CHECK (page_count IS NULL OR page_count > 0)",
    );
  }
}

function isLimitConfigured(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function workspaceProductStoreFailure(status: number, code: string, message: string): WorkspaceProductStoreFailure {
  return {
    error: {
      status,
      code,
      message,
    },
  };
}

function enforceFieldLimit(fieldCount: number, limit: number | null | undefined): WorkspaceProductStoreFailure | null {
  if (!isLimitConfigured(limit) || fieldCount <= limit) {
    return null;
  }

  return workspaceProductStoreFailure(
    400,
    "template_field_limit_exceeded",
    `Template fields exceed Workspace limit of ${limit}`,
  );
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
