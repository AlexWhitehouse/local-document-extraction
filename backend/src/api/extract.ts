import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { InvalidPdfSourceFileError, countPdfSourceFilePages } from "../lib/sourceFilePageCount";
import { validateExtractRequest } from "../lib/validation";
import { emitWorkspaceProductAnalytics } from "../lib/workspaceProductAnalytics";
import { getWorkspaceProductStore, isWorkspaceProductStoreFailure } from "../lib/workspaceProductStoreClient";
import type { QueueJobMessage, Workspace } from "../lib/types";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

export async function createExtractionJob(request: Request, env: Env, workspace: Workspace): Promise<Response> {
  const maxSourceFileBytes = workspace.max_source_file_bytes || Number(env.MAX_SOURCE_FILE_BYTES || 10 * 1024 * 1024);
  const { templateId, source } = await validateExtractRequest(request, maxSourceFileBytes);

  const productStore = getWorkspaceProductStore(env, workspace.id);
  const template = await productStore.validateTemplateForDocumentSubmission(templateId);
  if (isWorkspaceProductStoreFailure(template)) {
    throw new HttpError(template.error.status, template.error.code, template.error.message);
  }

  const selectedTemplateId = template.template_id;
  const version = Number(template.template_version);

  const jobId = newId("job");
  const ext = EXT_BY_MIME[source.type] || "bin";
  const objectKey = `workspaces/${workspace.id}/jobs/${jobId}/source.${ext}`;
  const sourceName = source.name?.trim() ? source.name.trim() : null;
  const now = nowIso();

  const sourceBytes = await source.arrayBuffer();
  const sourceFilePageCount = await countSourceFilePagesForSubmission(source.type, sourceBytes);
  await env.SOURCE_FILES_BUCKET.put(objectKey, sourceBytes, {
    httpMetadata: {
      contentType: source.type
    }
  });

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
    if (isWorkspaceProductStoreFailure(queued)) {
      throw new HttpError(queued.error.status, queued.error.code, queued.error.message);
    }
  } catch (error) {
    await env.SOURCE_FILES_BUCKET.delete(objectKey);
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
