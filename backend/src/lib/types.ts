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
  tenant_id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  current_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "retryable_failed";

export type FieldResultStatus = "ok" | "not_found" | "invalid_type" | "unreadable" | "error";

export type ExtractOptions = {
  include_confidence?: boolean;
  include_evidence?: boolean;
};

export type MarkdownDocument = {
  name: string;
  blob: Blob;
};

export type MarkdownConversionResult = {
  id: string;
  name: string;
  format: "markdown" | "error";
  mimetype: string;
  tokens?: number;
  data?: string;
  error?: string;
};

export type ToMarkdown = ((
  files: MarkdownDocument | MarkdownDocument[],
  conversionOptions?: Record<string, unknown>
) => Promise<MarkdownConversionResult | MarkdownConversionResult[]>) & {
  transform: (
    files: MarkdownDocument | MarkdownDocument[],
    conversionOptions?: Record<string, unknown>
  ) => Promise<MarkdownConversionResult | MarkdownConversionResult[]>;
  supported: () => Promise<Array<{ extension: string; mimeType: string }>>;
};

export type WorkersAiBinding = {
  run: (
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<unknown>;
  toMarkdown: ToMarkdown;
};

export type QueueJobMessage = {
  job_id: string;
  tenant_id: string;
  template_id: string;
  template_version: number;
  image_r2_key: string;
  enqueued_at: string;
};

export type Tenant = {
  id: string;
  api_key_hash: string;
  name: string | null;
  created_at: string;
  rate_limit_per_minute: number | null;
  max_templates: number | null;
  max_fields_per_template: number | null;
  max_image_bytes: number | null;
};

export interface Env {
  DB: D1Database;
  IMAGES_BUCKET: R2Bucket;
  JOBS_QUEUE: Queue<QueueJobMessage>;
  AI: WorkersAiBinding;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  AI_GATEWAY_PROVIDER?: string;
  AI_GATEWAY_TOKEN?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
  AI_GATEWAY_ROUTE?: string;
  MAX_IMAGE_BYTES?: string;
}
