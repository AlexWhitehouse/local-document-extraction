import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { deleteTemplateCascade } from "../lib/cascadeDelete";
import { parseJsonBody, validateTemplatePayload } from "../lib/validation";
import type { FieldDefinition, Workspace } from "../lib/types";

export async function createTemplate(request: Request, db: D1Database, workspace: Workspace): Promise<Response> {
  const payload = validateTemplatePayload(parseJsonBody(await request.text()));

  const templateId = newId("tpl");
  const now = nowIso();
  const fields = payload.fields || [];

  await db.batch([
    db
      .prepare(
        `INSERT INTO templates (id, workspace_id, name, description, status, current_version, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?, NULL)`
      )
      .bind(templateId, workspace.id, payload.name, payload.description || null, now, now),
    ...fieldInsertStatements(db, templateId, 1, fields)
  ]);

  return json({
    template_id: templateId,
    version: 1,
    status: "active"
  }, 201);
}

export async function listTemplates(db: D1Database, workspace: Workspace): Promise<Response> {
  const result = await db
    .prepare(
      `SELECT id, name, description, status, current_version, created_at, updated_at
       FROM templates
       WHERE workspace_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`
    )
    .bind(workspace.id)
    .all<Record<string, unknown>>();

  return json({ templates: result.results });
}

export async function getTemplate(db: D1Database, workspace: Workspace, id: string): Promise<Response> {
  const template = await db
    .prepare(
      `SELECT id, name, description, status, current_version, created_at, updated_at
       FROM templates
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`
    )
    .bind(id, workspace.id)
    .first<Record<string, unknown>>();

  if (!template) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  const version = Number(template.current_version);
  const fields = await db
    .prepare(
      `SELECT field_id AS id, name, description, data_type, required, position
       FROM template_fields
       WHERE template_id = ? AND version = ?
       ORDER BY position ASC`
    )
    .bind(id, version)
    .all<Record<string, unknown>>();

  return json({
    ...template,
    fields: fields.results.map((f) => ({
      ...f,
      required: Boolean(f.required)
    }))
  });
}

export async function updateTemplate(
  request: Request,
  db: D1Database,
  workspace: Workspace,
  id: string
): Promise<Response> {
  const existing = await db
    .prepare("SELECT id, name, description, current_version FROM templates WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
    .bind(id, workspace.id)
    .first<{ id: string; name: string; description: string | null; current_version: number }>();

  if (!existing) {
    throw new HttpError(404, "not_found", "Template not found");
  }

  const patch = validateTemplatePayload(parseJsonBody(await request.text()), true);
  const now = nowIso();
  const nextVersion = patch.fields ? Number(existing.current_version) + 1 : Number(existing.current_version);

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE templates
         SET name = ?, description = ?, current_version = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(
        patch.name ?? existing.name,
        patch.description !== undefined ? patch.description : existing.description,
        nextVersion,
        now,
        id,
        workspace.id
      )
  ];

  if (patch.fields) {
    statements.push(...fieldInsertStatements(db, id, nextVersion, patch.fields));
  }

  await db.batch(statements);

  return json({
    template_id: id,
    version: nextVersion,
    status: "active"
  });
}

export async function deleteTemplate(env: Env, workspace: Workspace, id: string): Promise<Response> {
  await deleteTemplateCascade(env, workspace, id);
  return new Response(null, { status: 204 });
}

function fieldInsertStatements(
  db: D1Database,
  templateId: string,
  version: number,
  fields: FieldDefinition[]
): D1PreparedStatement[] {
  return fields.map((field, index) =>
    db
      .prepare(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        templateId,
        version,
        field.id,
        field.name,
        field.description,
        field.data_type,
        field.required ? 1 : 0,
        index
      )
  );
}
