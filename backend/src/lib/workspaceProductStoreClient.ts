import type { FieldDefinition } from "./types";

export type CreateWorkspaceTemplateInput = {
  templateId: string;
  name: string;
  description: string | null;
  fields: FieldDefinition[];
  createdAt: string;
  maxTemplates?: number | null;
  maxFieldsPerTemplate?: number | null;
};

export type CreatedWorkspaceTemplate = {
  template_id: string;
  version: number;
  status: "active";
};

export type WorkspaceProductStoreFailure = {
  error: {
    status: number;
    code: string;
    message: string;
  };
};

export type UpdateWorkspaceTemplateInput = {
  templateId: string;
  name?: string;
  description?: string | null;
  fields?: FieldDefinition[];
  updatedAt: string;
  maxFieldsPerTemplate?: number | null;
};

export type UpdatedWorkspaceTemplate = CreatedWorkspaceTemplate;

export type ListedWorkspaceTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived" | "deleted";
  current_version: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceTemplateField = FieldDefinition & {
  position: number;
};

export type WorkspaceTemplateDetail = ListedWorkspaceTemplate & {
  fields: WorkspaceTemplateField[];
};

export type WorkspaceSubmissionTemplate = {
  template_id: string;
  template_version: number;
};

export type WorkspacePlanLimitTemplateUsage = {
  template_id: string;
  top_level_template_fields: number;
  table_shaped_fields: number;
  max_table_columns_per_field: number;
};

export type WorkspacePlanLimitUsage = {
  active_template_count: number;
  templates: WorkspacePlanLimitTemplateUsage[];
};

export type WorkspacePlanLimitUsageInput = {
  templateId?: string;
};

export type CreateQueuedWorkspaceExtractionJobInput = {
  jobId: string;
  templateId: string;
  templateVersion: number;
  sourceFileKey: string;
  sourceMimeType: string;
  sourceName: string | null;
  sourceFilePageCount: number | null;
  submittedAt: string;
};

export type QueuedWorkspaceExtractionJob = {
  job_id: string;
  status: "queued";
  source_name: string | null;
  template_id: string;
  template_version: number;
};

export type FailQueuedWorkspaceExtractionJobInput = {
  jobId: string;
  failedAt: string;
  errorCode: string;
  errorMessage: string;
};

export type StartExtractionWorkflowInput = {
  jobId: string;
  attempt: number;
  startedAt: string;
  workflowInstanceId: string;
};

export type NoteExtractionWorkflowStartFailureInput = {
  jobId: string;
  failedAt: string;
  errorCode: string;
  errorMessage: string;
};

export type ClaimWorkspaceExtractionJobForProcessingInput = {
  jobId: string;
  attempt: number;
  claimedAt: string;
};

export type ClaimedWorkspaceExtractionJob = {
  job_id: string;
  template_id: string;
  template_version: number;
  source_file_key: string;
  source_mime_type: string;
  fields: FieldDefinition[];
};

export type CompletedWorkspaceExtractionResult = {
  field_id: string;
  status: string;
  answer: unknown;
  normalized_value: string | null;
  confidence: number | null;
  evidence: string | null;
};

export type CompleteWorkspaceExtractionJobInput = {
  jobId: string;
  attempt: number;
  completedAt: string;
  modelName: string;
  route: string;
  results: CompletedWorkspaceExtractionResult[];
};

export type FailWorkspaceExtractionJobInput = {
  jobId: string;
  attempt: number;
  failedAt: string;
  errorCode: string;
  errorMessage: string;
};

export type WorkspaceExtractionJobListCursor = {
  sort: string;
  id: string;
};

export type ListWorkspaceExtractionJobsInput = {
  limit: number;
  search: string;
  cursor: WorkspaceExtractionJobListCursor | null;
};

export type WorkspaceExtractionJobSummary = {
  job_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  source_name: string | null;
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

export type ListedWorkspaceExtractionJob = WorkspaceExtractionJobSummary & {
  results: [];
};

export type WorkspaceExtractionJobResult = {
  field_id: string;
  name: string;
  data_type: FieldDefinition["data_type"];
  status: string;
  answer: unknown;
  confidence: number | null;
  evidence: string | null;
};

export type WorkspaceExtractionJobDetail =
  | WorkspaceExtractionJobSummary
  | (WorkspaceExtractionJobSummary & { results: WorkspaceExtractionJobResult[] });

export type ListWorkspaceExtractionJobsResult = {
  jobs: ListedWorkspaceExtractionJob[];
  nextCursor: WorkspaceExtractionJobListCursor | null;
  has_more: boolean;
};

export type WorkspaceExtractionJobDeletionCandidate = {
  job_id: string;
  source_file_key: string | null;
};

export type DeleteWorkspaceExtractionJobInput = {
  jobId: string;
  deletedAt: string;
};

export type MarkWorkspaceSourceFileCleanedInput = {
  jobId: string;
  sourceFileKey: string;
  cleanedAt: string;
};

export type ListWorkspaceResidualSourceFilesForCleanupInput = {
  limit: number;
};

export type WorkspaceResidualSourceFile = {
  job_id: string;
  source_file_key: string;
};

export interface WorkspaceProductStoreRpc {
  createTemplate(input: CreateWorkspaceTemplateInput): Promise<CreatedWorkspaceTemplate | WorkspaceProductStoreFailure>;
  listTemplates(): Promise<ListedWorkspaceTemplate[]>;
  getTemplate(templateId: string): Promise<WorkspaceTemplateDetail | null>;
  updateTemplate(input: UpdateWorkspaceTemplateInput): Promise<UpdatedWorkspaceTemplate | WorkspaceProductStoreFailure | null>;
  deleteTemplate(templateId: string): Promise<boolean>;
  summarizePlanLimitUsage?(input?: WorkspacePlanLimitUsageInput): Promise<WorkspacePlanLimitUsage>;
  validateTemplateForDocumentSubmission(templateId: string): Promise<WorkspaceSubmissionTemplate | WorkspaceProductStoreFailure>;
  createQueuedExtractionJob(input: CreateQueuedWorkspaceExtractionJobInput): Promise<QueuedWorkspaceExtractionJob | WorkspaceProductStoreFailure>;
  failQueuedExtractionJob(input: FailQueuedWorkspaceExtractionJobInput): Promise<boolean>;
  startExtractionWorkflow(input: StartExtractionWorkflowInput): Promise<boolean>;
  noteExtractionWorkflowStartFailure(input: NoteExtractionWorkflowStartFailureInput): Promise<void>;
  claimExtractionJobForProcessing(input: ClaimWorkspaceExtractionJobForProcessingInput): Promise<ClaimedWorkspaceExtractionJob | null>;
  completeExtractionJob(input: CompleteWorkspaceExtractionJobInput): Promise<boolean>;
  failExtractionJob(input: FailWorkspaceExtractionJobInput): Promise<boolean>;
  listExtractionJobs(input: ListWorkspaceExtractionJobsInput): Promise<ListWorkspaceExtractionJobsResult>;
  getExtractionJob(jobId: string): Promise<WorkspaceExtractionJobDetail | null>;
  getExtractionJobDeletionCandidate(jobId: string): Promise<WorkspaceExtractionJobDeletionCandidate | null>;
  deleteExtractionJob(input: DeleteWorkspaceExtractionJobInput): Promise<boolean>;
  markSourceFileCleaned(input: MarkWorkspaceSourceFileCleanedInput): Promise<boolean>;
  listResidualSourceFilesForCleanup(input: ListWorkspaceResidualSourceFilesForCleanupInput): Promise<WorkspaceResidualSourceFile[]>;
  eraseWorkspaceProductData(): Promise<void>;
}

export function isWorkspaceProductStoreFailure(value: unknown): value is WorkspaceProductStoreFailure {
  const error = (value as { error?: Partial<WorkspaceProductStoreFailure["error"]> } | null)?.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof error.status === "number" &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}

export function getWorkspaceProductStore(
  env: Pick<Env, "WORKSPACE_PRODUCT_STORE">,
  workspaceId: string,
): WorkspaceProductStoreRpc {
  return env.WORKSPACE_PRODUCT_STORE.getByName(workspaceId) as unknown as WorkspaceProductStoreRpc;
}
