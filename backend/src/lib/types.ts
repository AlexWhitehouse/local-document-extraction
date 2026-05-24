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
  api_key_hash: string | null;
  name: string | null;
  created_at: string;
  created_by_user_id: string | null;
  rate_limit_per_minute: number | null;
  max_templates: number | null;
  max_fields_per_template: number | null;
  max_source_file_bytes: number | null;
};

export type WorkspaceMembershipRole = "owner" | "admin" | "member";
