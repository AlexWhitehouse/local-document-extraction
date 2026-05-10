export type DataType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "object"
  | "array"
  | "array<object>";

export type FieldDefinition = {
  id: string;
  name: string;
  description: string;
  data_type: DataType;
  required?: boolean;
};

export type Template = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  current_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type FieldResultStatus = "ok" | "not_found" | "invalid_type" | "unreadable" | "error";

export type ExtractOptions = {
  include_confidence?: boolean;
  include_evidence?: boolean;
};

export type WorkersAiBinding = {
  run: (
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  gateway: (gatewayId: string) => {
    run: (data: {
      provider: string;
      endpoint: string;
      headers: Record<string, unknown>;
      query: unknown;
    }) => Promise<Response>;
  };
};

export type QueueJobMessage = {
  job_id: string;
  attempt: number;
  workspace_id: string;
  template_id: string;
  template_version: number;
  enqueued_at: string;
};

export type DocumentProcessingWorkflowParams = {
  job_id: string;
  attempt: number;
  workspace_id: string;
};

export type Workspace = {
  id: string;
  api_key_hash: string;
  name: string | null;
  created_at: string;
  created_by_user_id: string | null;
  rate_limit_per_minute: number | null;
  max_templates: number | null;
  max_fields_per_template: number | null;
  max_source_file_bytes: number | null;
};

export type WorkspaceMembershipRole = "owner" | "admin" | "member";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SOURCE_FILES_BUCKET: R2Bucket;
  EXTRACTION_JOBS_QUEUE: Queue<QueueJobMessage>;
  DOCUMENT_PROCESSING_WORKFLOW: Workflow<DocumentProcessingWorkflowParams>;
  AI: WorkersAiBinding;
  AI_GATEWAY_ID: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_TRUSTED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AI_MODEL?: string;
  MAX_SOURCE_FILE_BYTES?: string;
}
