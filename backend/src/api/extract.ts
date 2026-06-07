import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { InvalidPdfSourceFileError, countPdfSourceFilePages } from "../lib/sourceFilePageCount";
import { validateExtractRequest } from "../lib/validation";
import { disposeRpcResult } from "../lib/rpcDisposal";
import { summarizeWorkspaceBilling } from "../lib/workspaceBilling";
import { getWorkspaceBillingControl } from "../lib/workspaceBillingControl";
import {
  reconcileActivePlanOverrideIncludedCredits,
  type IncludedCreditGrantLedger,
} from "../lib/workspaceBillingIncludedCredits";
import { BillingReservationError } from "../lib/workspaceBillingLedger";
import { countAcceptedWorkspaceMemberships } from "../lib/workspaceBillingAuthority";
import { emitWorkspaceProductAnalytics } from "../lib/workspaceProductAnalytics";
import { getWorkspaceProductStore, isWorkspaceProductStoreFailure } from "../lib/workspaceProductStoreClient";
import type { AuthContext } from "../lib/auth";
import type { QueueJobMessage, Workspace } from "../lib/types";
import type {
  RefundCreditReservationInput,
  RecordEnterpriseUsageChargeInput,
  RecordNoBillingUsageInput,
  ReserveCreditsForDocumentSubmissionFailure,
  ReserveCreditsForDocumentSubmissionInput,
  ReserveCreditsForDocumentSubmissionResult,
} from "../lib/workspaceBillingLedger";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

type BillingLedgerRpc = IncludedCreditGrantLedger & {
  summarizeOwnerBilling(input: {
    billingPeriodStart: string;
    billingPeriodEnd: string;
    monthlyPageLimit: number | null;
  }): Promise<{
    credits: {
      included_available: number;
    };
  }>;
  reserveCreditsForDocumentSubmission(
    input: ReserveCreditsForDocumentSubmissionInput,
  ): Promise<ReserveCreditsForDocumentSubmissionResult>;
  recordNoBillingUsage(input: RecordNoBillingUsageInput): Promise<unknown>;
  recordEnterpriseUsageCharge(input: RecordEnterpriseUsageChargeInput): Promise<unknown>;
  refundCreditReservation(input: RefundCreditReservationInput): Promise<unknown>;
};

export async function createExtractionJob(request: Request, env: Env, authContext: AuthContext): Promise<Response> {
  const workspace = authContext.workspace;
  const maxSourceFileBytes = workspace.max_source_file_bytes || Number(env.MAX_SOURCE_FILE_BYTES || 10 * 1024 * 1024);
  const { templateId, source } = await validateExtractRequest(request, maxSourceFileBytes);

  const productStore = getWorkspaceProductStore(env, workspace.id);
  const template = await productStore.validateTemplateForDocumentSubmission(templateId);
  let selectedTemplateId: string;
  let version: number;
  try {
    if (isWorkspaceProductStoreFailure(template)) {
      throw new HttpError(template.error.status, template.error.code, template.error.message);
    }
    selectedTemplateId = template.template_id;
    version = Number(template.template_version);
  } finally {
    disposeRpcResult(template);
  }

  await assertPlanLimitsAllowDocumentSubmission(env, productStore, workspace, selectedTemplateId);

  const jobId = newId("job");
  const ext = EXT_BY_MIME[source.type] || "bin";
  const objectKey = `workspaces/${workspace.id}/jobs/${jobId}/source.${ext}`;
  const sourceName = source.name?.trim() ? source.name.trim() : null;
  const now = nowIso();

  const sourceBytes = await source.arrayBuffer();
  const sourceFilePageCount = await countSourceFilePagesForSubmission(source.type, sourceBytes);
  const billableDocumentPages = getBillableDocumentPages(source.type, sourceFilePageCount);
  await reservePrepaidSubmissionCredits(env, workspace, {
    authContext,
    jobId,
    templateId: selectedTemplateId,
    templateVersion: version,
    billableDocumentPages,
    submittedAt: now,
  });

  try {
    await env.SOURCE_FILES_BUCKET.put(objectKey, sourceBytes, {
      httpMetadata: {
        contentType: source.type
      }
    });
  } catch (error) {
    await refundPrepaidSubmissionCredits(env, workspace.id, jobId, "Source file storage failed");
    throw error;
  }

  try {
    const queued = await productStore.createQueuedExtractionJob({
      jobId,
      templateId: selectedTemplateId,
      templateVersion: version,
      sourceFileKey: objectKey,
      sourceMimeType: source.type,
      sourceName,
      sourceFilePageCount,
      submittedAt: now,
    });
    try {
      if (isWorkspaceProductStoreFailure(queued)) {
        throw new HttpError(queued.error.status, queued.error.code, queued.error.message);
      }
    } finally {
      disposeRpcResult(queued);
    }
  } catch (error) {
    await env.SOURCE_FILES_BUCKET.delete(objectKey);
    await refundPrepaidSubmissionCredits(env, workspace.id, jobId, "Queued Extraction job creation failed");
    throw error;
  }

  const message: QueueJobMessage = {
    job_id: jobId,
    attempt: 1,
    workspace_id: workspace.id,
    template_id: selectedTemplateId,
    template_version: version,
    enqueued_at: now
  };

  try {
    await env.EXTRACTION_JOBS_QUEUE.send(message, { contentType: "json" });
  } catch (error) {
    try {
      await productStore.failQueuedExtractionJob({
        jobId,
        failedAt: nowIso(),
        errorCode: "queue_send_failed",
        errorMessage: errorMessage(error),
      });
    } finally {
      await env.SOURCE_FILES_BUCKET.delete(objectKey);
      await refundPrepaidSubmissionCredits(env, workspace.id, jobId, "Queue send failed");
    }
    throw error;
  }

  emitWorkspaceProductAnalytics(env, {
    type: "document_submitted",
    workspaceId: workspace.id,
    templateId: selectedTemplateId,
    templateVersion: version,
    extractionJobId: jobId,
    status: "queued",
    attempt: 1,
    sourceMimeType: source.type,
    sourceByteSize: sourceBytes.byteLength,
  });

  return json(
    {
      job_id: jobId,
      status: "queued",
      source_name: sourceName,
      template_id: selectedTemplateId,
      template_version: version
    },
    202
  );
}

async function assertPlanLimitsAllowDocumentSubmission(
  env: Env,
  productStore: ReturnType<typeof getWorkspaceProductStore>,
  workspace: Workspace,
  templateId: string,
): Promise<void> {
  const billing = await summarizeActiveWorkspaceBilling(env, workspace);
  const memberCount = await countAcceptedWorkspaceMemberships(env.DB, workspace.id);
  if (isLimitExceeded(memberCount, billing.plan_limits.members)) {
    throw new HttpError(
      402,
      "member_limit_exceeded",
      `Workspace has exceeded the ${billing.active_entitlement.display_name} plan limit of ${billing.plan_limits.members} members`,
    );
  }

  const usage = await productStore.summarizePlanLimitUsage?.({ templateId });
  if (!usage) {
    return;
  }

  try {
    if (isLimitExceeded(usage.active_template_count, billing.plan_limits.templates)) {
      throw new HttpError(
        402,
        "template_limit_exceeded",
        `Workspace has exceeded the ${billing.active_entitlement.display_name} plan limit of ${billing.plan_limits.templates} Templates`,
      );
    }

    const templateUsage = usage.templates.find((candidate) => candidate.template_id === templateId);
    if (
      templateUsage &&
      isLimitExceeded(templateUsage.top_level_template_fields, billing.plan_limits.top_level_template_fields)
    ) {
      throw new HttpError(
        402,
        "template_field_limit_exceeded",
        `Template has exceeded the ${billing.active_entitlement.display_name} plan limit of ${billing.plan_limits.top_level_template_fields} top-level fields`,
      );
    }
    if (
      templateUsage &&
      isLimitExceeded(templateUsage.table_shaped_fields, billing.plan_limits.table_shaped_fields)
    ) {
      throw new HttpError(
        402,
        "template_table_limit_exceeded",
        `Template has exceeded the ${billing.active_entitlement.display_name} plan limit of ${billing.plan_limits.table_shaped_fields} table-shaped field`,
      );
    }
    if (
      templateUsage &&
      isLimitExceeded(templateUsage.max_table_columns_per_field, billing.plan_limits.table_columns_per_field)
    ) {
      throw new HttpError(
        402,
        "template_table_column_limit_exceeded",
        `Template has exceeded the ${billing.active_entitlement.display_name} plan limit of ${billing.plan_limits.table_columns_per_field} table columns`,
      );
    }
  } finally {
    disposeRpcResult(usage);
  }
}

function isLimitExceeded(value: number, limit: number | null): boolean {
  return limit !== null && value > limit;
}

function getBillableDocumentPages(sourceMimeType: string, sourceFilePageCount: number | null): number {
  if (sourceMimeType === "application/pdf") {
    return Number(sourceFilePageCount || 0);
  }
  return 1;
}

async function reservePrepaidSubmissionCredits(
  env: Env,
  workspace: Workspace,
  input: {
    authContext: AuthContext;
    jobId: string;
    templateId: string;
    templateVersion: number;
    billableDocumentPages: number;
    submittedAt: string;
  },
): Promise<void> {
  const ledger = getWorkspaceBillingLedger(env, workspace.id);
  const submittedAt = new Date(input.submittedAt);
  const billingControl = await getWorkspaceBillingControl(env.DB, workspace.id);
  const billing = summarizeWorkspaceBilling(workspace, billingControl, submittedAt);
  await reconcileActivePlanOverrideIncludedCredits({
    workspace,
    control: billingControl,
    ledger,
    now: submittedAt,
  });

  if (billing.active_entitlement.plan === "no_billing") {
    const result = await ledger.recordNoBillingUsage({
      workspaceId: workspace.id,
      extractionJobId: input.jobId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      billableDocumentPages: input.billableDocumentPages,
      billingPeriodStart: billing.current_period.start,
      billingPeriodEnd: billing.current_period.end,
      submittedAt: input.submittedAt,
      authMode: input.authContext.auth_mode,
      actorUserId: input.authContext.user_id,
      idempotencyKey: `no-billing-submission:${input.jobId}`,
    });
    disposeRpcResult(result);
    return;
  }
  if (
    billing.active_entitlement.plan === "enterprise_ramp_up" ||
    billing.active_entitlement.plan === "enterprise_annual"
  ) {
    const result = await ledger.recordEnterpriseUsageCharge({
      workspaceId: workspace.id,
      extractionJobId: input.jobId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      billableDocumentPages: input.billableDocumentPages,
      billingPeriodStart: billing.current_period.start,
      billingPeriodEnd: billing.current_period.end,
      submittedAt: input.submittedAt,
      authMode: input.authContext.auth_mode,
      actorUserId: input.authContext.user_id,
      idempotencyKey: `enterprise-submission:${input.jobId}`,
      amountMinor: billing.active_entitlement.plan === "enterprise_annual" ? 0 : undefined,
    });
    disposeRpcResult(result);
    return;
  }
  if (billing.current_period.monthly_page_limit === null) {
    throw new HttpError(500, "billing_entitlement_invalid", "Current billing entitlement is missing a Plan page limit");
  }

  try {
    const reservation = await ledger.reserveCreditsForDocumentSubmission({
      workspaceId: workspace.id,
      extractionJobId: input.jobId,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      billableDocumentPages: input.billableDocumentPages,
      billingPeriodStart: billing.current_period.start,
      billingPeriodEnd: billing.current_period.end,
      monthlyPageLimit: billing.current_period.monthly_page_limit,
      submittedAt: input.submittedAt,
      authMode: input.authContext.auth_mode,
      actorUserId: input.authContext.user_id,
      idempotencyKey: `submission:${input.jobId}`,
    });
    try {
      if (isBillingReservationFailure(reservation)) {
        throw new HttpError(402, reservation.error.code, reservation.error.message);
      }
    } finally {
      disposeRpcResult(reservation);
    }
  } catch (error) {
    if (error instanceof BillingReservationError) {
      throw new HttpError(402, error.code, error.message);
    }
    const reservationError = mapRemoteBillingReservationError(error);
    if (reservationError) {
      throw new HttpError(402, reservationError.code, reservationError.message);
    }
    throw error;
  }
}

async function refundPrepaidSubmissionCredits(
  env: Env,
  workspaceId: string,
  jobId: string,
  reason: string,
): Promise<void> {
  const ledger = getWorkspaceBillingLedger(env, workspaceId);
  const result = await ledger.refundCreditReservation({
    workspaceId,
    extractionJobId: jobId,
    reason,
    idempotencyKey: `refund:${jobId}`,
    occurredAt: nowIso(),
  });
  disposeRpcResult(result);
}

function isBillingReservationFailure(
  result: ReserveCreditsForDocumentSubmissionResult,
): result is ReserveCreditsForDocumentSubmissionFailure {
  const error = (result as { error?: { code?: unknown; message?: unknown } }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}

function getWorkspaceBillingLedger(env: Env, workspaceId: string): BillingLedgerRpc {
  const binding = env.WORKSPACE_BILLING_LEDGER;
  if (!binding) {
    throw new HttpError(500, "billing_ledger_unavailable", "Workspace billing ledger is not configured");
  }
  return binding.getByName(workspaceId) as unknown as BillingLedgerRpc;
}

function mapRemoteBillingReservationError(
  error: unknown,
): { code: BillingReservationError["code"]; message: string } | null {
  const message = error instanceof Error ? error.message : "";
  if (message === "Workspace has insufficient Credits for this Document") {
    return { code: "insufficient_credits", message };
  }
  if (message === "Workspace has exceeded remaining Plan page capacity") {
    return { code: "plan_page_limit_exceeded", message };
  }
  if (message === "Billable Document page count must be positive") {
    return { code: "insufficient_credits", message };
  }
  return null;
}

async function summarizeActiveWorkspaceBilling(
  env: Env,
  workspace: Workspace,
  now?: Date,
) {
  const billingControl = await getWorkspaceBillingControl(env.DB, workspace.id);
  return summarizeWorkspaceBilling(workspace, billingControl, now);
}

async function countSourceFilePagesForSubmission(sourceMimeType: string, sourceBytes: ArrayBuffer): Promise<number | null> {
  if (sourceMimeType !== "application/pdf") {
    return null;
  }

  try {
    return await countPdfSourceFilePages(sourceBytes);
  } catch (error) {
    if (error instanceof InvalidPdfSourceFileError) {
      throw new HttpError(400, error.code, error.message);
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
