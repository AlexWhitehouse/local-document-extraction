import { HttpError } from "./http";
import type { Env, Workspace } from "./types";

type R2KeyRow = {
  image_r2_key: string | null;
};

const R2_DELETE_CONCURRENCY = 25;

export async function deleteJobCascade(env: Env, workspace: Workspace, jobId: string): Promise<void> {
  const existing = await env.DB
    .prepare(
      `SELECT image_r2_key
       FROM jobs
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(jobId, workspace.id)
    .first<R2KeyRow>();

  if (!existing) {
    throw new HttpError(404, "not_found", "Job not found");
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_results WHERE job_id = ?").bind(jobId),
    env.DB.prepare("DELETE FROM jobs WHERE id = ? AND workspace_id = ?").bind(jobId, workspace.id),
  ]);

  await deleteR2Objects(env, [existing.image_r2_key]);
}

export async function deleteTemplateCascade(env: Env, workspace: Workspace, templateId: string): Promise<void> {
  const existing = await env.DB
    .prepare(
      `SELECT id
       FROM templates
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .bind(templateId, workspace.id)
    .first<{ id: string }>();

  if (!existing) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  const r2Keys = await env.DB
    .prepare(
      `SELECT image_r2_key
       FROM jobs
       WHERE workspace_id = ? AND template_id = ?`,
    )
    .bind(workspace.id, templateId)
    .all<R2KeyRow>();

  await env.DB.batch([
    env.DB
      .prepare(
        `DELETE FROM job_results
         WHERE job_id IN (
           SELECT id FROM jobs WHERE workspace_id = ? AND template_id = ?
         )`,
      )
      .bind(workspace.id, templateId),
    env.DB.prepare("DELETE FROM jobs WHERE workspace_id = ? AND template_id = ?").bind(workspace.id, templateId),
    env.DB.prepare("DELETE FROM template_fields WHERE template_id = ?").bind(templateId),
    env.DB.prepare("DELETE FROM templates WHERE id = ? AND workspace_id = ?").bind(templateId, workspace.id),
  ]);

  await deleteR2Objects(
    env,
    r2Keys.results.map((row) => row.image_r2_key),
  );
}

export async function deleteWorkspaceCascade(env: Env, workspaceId: string): Promise<void> {
  const r2Keys = await env.DB
    .prepare(
      `SELECT image_r2_key
       FROM jobs
       WHERE workspace_id = ?`,
    )
    .bind(workspaceId)
    .all<R2KeyRow>();

  await env.DB.batch([
    env.DB
      .prepare(
        `DELETE FROM job_results
         WHERE job_id IN (
           SELECT id FROM jobs WHERE workspace_id = ?
         )`,
      )
      .bind(workspaceId),
    env.DB.prepare("DELETE FROM jobs WHERE workspace_id = ?").bind(workspaceId),
    env.DB
      .prepare(
        `DELETE FROM template_fields
         WHERE template_id IN (
           SELECT id FROM templates WHERE workspace_id = ?
         )`,
      )
      .bind(workspaceId),
    env.DB.prepare("DELETE FROM templates WHERE workspace_id = ?").bind(workspaceId),
    env.DB.prepare("DELETE FROM workspace_invitations WHERE workspace_id = ?").bind(workspaceId),
    env.DB.prepare("DELETE FROM workspace_memberships WHERE workspace_id = ?").bind(workspaceId),
    env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspaceId),
  ]);

  await deleteR2Objects(
    env,
    r2Keys.results.map((row) => row.image_r2_key),
  );
}

async function deleteR2Objects(env: Env, keys: Array<string | null | undefined>): Promise<void> {
  const uniqueKeys = Array.from(
    new Set(keys.map((key) => String(key || "").trim()).filter(Boolean)),
  );

  for (let index = 0; index < uniqueKeys.length; index += R2_DELETE_CONCURRENCY) {
    const chunk = uniqueKeys.slice(index, index + R2_DELETE_CONCURRENCY);
    await Promise.all(chunk.map((key) => env.IMAGES_BUCKET.delete(key)));
  }
}
