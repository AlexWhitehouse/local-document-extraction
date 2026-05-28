type WorkspaceProductAnalyticsEventBase = {
  workspaceId: string;
};

export type WorkspaceProductAnalyticsEvent =
  | (WorkspaceProductAnalyticsEventBase & {
      type: "template_created" | "template_updated";
      templateId: string;
      templateVersion: number;
      status: string;
      fieldCount: number;
    })
  | (WorkspaceProductAnalyticsEventBase & {
      type: "document_submitted";
      templateId: string;
      templateVersion: number;
      extractionJobId: string;
      status: "queued";
      attempt: number;
      sourceMimeType: string;
      sourceByteSize: number;
    })
  | (WorkspaceProductAnalyticsEventBase & {
      type: "extraction_completed";
      templateId: string;
      templateVersion: number;
      extractionJobId: string;
      status: "completed";
      attempt: number;
      sourceMimeType: string;
      sourceByteSize: number;
      modelName: string;
      fieldCount: number;
    })
  | (WorkspaceProductAnalyticsEventBase & {
      type: "extraction_failed";
      templateId: string;
      templateVersion: number;
      extractionJobId: string;
      status: "failed";
      attempt: number;
      sourceMimeType: string;
      errorCode: string;
      fieldCount: number;
    });

export function emitWorkspaceProductAnalytics(
  env: Pick<Env, "WORKSPACE_PRODUCT_ANALYTICS">,
  event: WorkspaceProductAnalyticsEvent,
): void {
  const binding = env.WORKSPACE_PRODUCT_ANALYTICS;
  if (!binding) {
    return;
  }

  try {
    binding.writeDataPoint(toDataPoint(event));
  } catch (error) {
    console.error("Workspace product analytics emission failed", error);
  }
}

function toDataPoint(event: WorkspaceProductAnalyticsEvent): AnalyticsEngineDataPoint {
  return {
    indexes: [event.workspaceId],
    blobs: [
      event.type,
      event.workspaceId,
      event.templateId,
      "extractionJobId" in event ? event.extractionJobId : "",
      event.status,
      "errorCode" in event ? event.errorCode : "",
      "sourceMimeType" in event ? event.sourceMimeType : "",
      "modelName" in event ? event.modelName : "",
    ],
    doubles: [
      "attempt" in event ? event.attempt : 0,
      "sourceByteSize" in event ? event.sourceByteSize : 0,
      "fieldCount" in event ? event.fieldCount : 0,
      0,
      event.templateVersion,
    ],
  };
}
