import { HttpError, json } from "../lib/http";
import { createQueuedExtractionJob } from "../lib/extractionJobLifecycle";
import { newId, nowIso } from "../lib/ids";
import { validateExtractRequest } from "../lib/validation";
import type { Env, QueueJobMessage, Workspace } from "../lib/types";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf"
};

export async function createExtractionJob(request: Request, env: Env, workspace: Workspace): Promise<Response> {
  const maxImageBytes = workspace.max_image_bytes || Number(env.MAX_IMAGE_BYTES || 10 * 1024 * 1024);
  const { templateId, source } = await validateExtractRequest(request, maxImageBytes);

  const template = await env.DB
    .prepare(
      `SELECT id, current_version, status, deleted_at
       FROM templates
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(templateId, workspace.id)
    .first<{ id: string; current_version: number; status: string; deleted_at: string | null }>();

  if (!template || template.deleted_at || template.status !== "active") {
    throw new HttpError(404, "template_not_found", "Template not found");
  }

  const version = Number(template.current_version);
  const hasFields = await env.DB
    .prepare(
      `SELECT 1 AS exists_flag
       FROM template_fields
       WHERE template_id = ? AND version = ?
       LIMIT 1`
    )
    .bind(templateId, version)
    .first<{ exists_flag: number }>();

  if (!hasFields) {
    throw new HttpError(400, "template_invalid", "Template has no fields");
  }

  const jobId = newId("job");
  const ext = EXT_BY_MIME[source.type] || "bin";
  const objectKey = `workspaces/${workspace.id}/jobs/${jobId}/source.${ext}`;
  const imageName = source.name?.trim() ? source.name.trim() : null;
  const now = nowIso();

  const sourceBytes = await source.arrayBuffer();
  await env.IMAGES_BUCKET.put(objectKey, sourceBytes, {
    httpMetadata: {
      contentType: source.type
    }
  });

  try {
    await createQueuedExtractionJob(env.DB, {
      jobId,
      workspaceId: workspace.id,
      templateId,
      templateVersion: version,
      sourceFileKey: objectKey,
      sourceMimeType: source.type,
      sourceName: imageName,
      submittedAt: now,
    });
  } catch (error) {
    await env.IMAGES_BUCKET.delete(objectKey);
    throw error;
  }

  const message: QueueJobMessage = {
    job_id: jobId,
    attempt: 1,
    workspace_id: workspace.id,
    template_id: templateId,
    template_version: version,
    image_r2_key: objectKey,
    enqueued_at: now
  };

  await env.JOBS_QUEUE.send(message, { contentType: "json" });

  return json(
    {
      job_id: jobId,
      status: "queued",
      image_name: imageName,
      template_id: templateId,
      template_version: version
    },
    202
  );
}
