import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

type WorkspaceProductAnalyticsEventBase = {
  workspaceId: string;
};

export type LocalWorkspaceProductAnalyticsEvent =
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

type LocalProductAnalyticsLogger = {
  warn(message: string, error: unknown): void;
};

type SerializedAnalyticsEvent = Record<string, string | number>;

export type LocalProductAnalytics = {
  flush(): Promise<void>;
  record(event: LocalWorkspaceProductAnalyticsEvent): void;
};

export function createLocalProductAnalytics({
  append = appendJsonl,
  logger = console,
  now = () => new Date(),
  stateDirectory,
}: {
  append?: (path: string, content: string) => Promise<void>;
  logger?: LocalProductAnalyticsLogger;
  now?: () => Date;
  stateDirectory: string;
}): LocalProductAnalytics {
  let pendingWrites = Promise.resolve();

  return {
    flush: () => pendingWrites,
    record: (event) => {
      const occurredAt = now();
      const path = join(stateDirectory, "analytics", `${occurredAt.toISOString().slice(0, 10)}.jsonl`);
      const line = `${JSON.stringify(serializeEvent(event, occurredAt))}\n`;
      pendingWrites = pendingWrites
        .then(() => append(path, line))
        .catch((error) => {
          logger.warn("Local product analytics write failed", error);
        });
    },
  };
}

function serializeEvent(
  event: LocalWorkspaceProductAnalyticsEvent,
  occurredAt: Date,
): SerializedAnalyticsEvent {
  const record: SerializedAnalyticsEvent = {
    occurred_at: occurredAt.toISOString(),
    type: event.type,
    workspace_id: event.workspaceId,
    template_id: event.templateId,
    template_version: event.templateVersion,
    status: event.status,
  };

  if ("fieldCount" in event) {
    record.field_count = event.fieldCount;
  }
  if ("extractionJobId" in event) {
    record.extraction_job_id = event.extractionJobId;
    record.attempt = event.attempt;
    record.source_mime_type = event.sourceMimeType;
  }
  if ("sourceByteSize" in event) {
    record.source_byte_size = event.sourceByteSize;
  }
  if ("modelName" in event) {
    record.model_name = event.modelName;
  }
  if ("errorCode" in event) {
    record.error_code = event.errorCode;
  }

  return record;
}

async function appendJsonl(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, content, "utf8");
}
