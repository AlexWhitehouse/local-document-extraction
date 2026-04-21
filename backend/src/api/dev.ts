import { HttpError, json } from "../lib/http";
import { newId, nowIso } from "../lib/ids";
import { parseJsonBody } from "../lib/validation";
import type { Env } from "../lib/types";

type CreateTenantBody = {
  tenant_id?: unknown;
  api_key?: unknown;
  name?: unknown;
  max_image_bytes?: unknown;
};

type RotateApiKeyBody = {
  api_key?: unknown;
};

export async function createDevTenant(request: Request, db: D1Database): Promise<Response> {
  const payload = parseJsonBody<CreateTenantBody>(await request.text());

  const tenantId =
    typeof payload.tenant_id === "string" && payload.tenant_id.trim().length > 0
      ? payload.tenant_id.trim()
      : newId("tenant");
  const apiKey =
    typeof payload.api_key === "string" && payload.api_key.trim().length > 0
      ? payload.api_key.trim()
      : newId("key");
  const name =
    payload.name === undefined || payload.name === null
      ? null
      : typeof payload.name === "string"
        ? payload.name.trim()
        : null;

  if (payload.name !== undefined && payload.name !== null && typeof payload.name !== "string") {
    throw new HttpError(400, "invalid_name", "name must be a string");
  }

  let maxImageBytes: number | null = null;
  if (payload.max_image_bytes !== undefined && payload.max_image_bytes !== null) {
    if (typeof payload.max_image_bytes !== "number" || !Number.isInteger(payload.max_image_bytes) || payload.max_image_bytes <= 0) {
      throw new HttpError(400, "invalid_max_image_bytes", "max_image_bytes must be a positive integer");
    }
    maxImageBytes = payload.max_image_bytes;
  }

  const now = nowIso();
  const apiKeyHash = await sha256(apiKey);

  try {
    await db
      .prepare(
        `INSERT INTO tenants (id, api_key_hash, name, created_at, max_image_bytes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(tenantId, apiKeyHash, name, now, maxImageBytes)
      .run();
  } catch (error) {
    const message = String(error);
    if (message.toLowerCase().includes("unique")) {
      throw new HttpError(409, "tenant_conflict", `Could not create tenant: ${message}`);
    }
    throw new HttpError(500, "tenant_create_failed", `Could not create tenant: ${message}`);
  }

  return json(
    {
      tenant_id: tenantId,
      api_key: apiKey,
      name,
      created_at: now,
      max_image_bytes: maxImageBytes
    },
    201
  );
}

export async function resetDevData(env: Env): Promise<Response> {
  const deleted_objects = await deleteAllBucketObjects(env.IMAGES_BUCKET);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM job_results"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM template_fields"),
    env.DB.prepare("DELETE FROM templates"),
    env.DB.prepare("DELETE FROM tenants")
  ]);

  return json({
    ok: true,
    deleted_objects,
    reset_at: nowIso()
  });
}

export async function rotateDevTenantApiKey(
  request: Request,
  db: D1Database,
  tenantId: string,
): Promise<Response> {
  const payload = parseJsonBody<RotateApiKeyBody>(await request.text());
  const nextApiKey =
    typeof payload.api_key === "string" && payload.api_key.trim().length > 0
      ? payload.api_key.trim()
      : newId("key");

  const tenant = await db
    .prepare("SELECT id FROM tenants WHERE id = ? LIMIT 1")
    .bind(tenantId)
    .first<{ id: string }>();

  if (!tenant) {
    throw new HttpError(404, "not_found", "Tenant not found");
  }

  const apiKeyHash = await sha256(nextApiKey);
  try {
    await db
      .prepare("UPDATE tenants SET api_key_hash = ? WHERE id = ?")
      .bind(apiKeyHash, tenantId)
      .run();
  } catch (error) {
    const message = String(error);
    if (message.toLowerCase().includes("unique")) {
      throw new HttpError(409, "tenant_conflict", `Could not rotate API key: ${message}`);
    }
    throw new HttpError(500, "tenant_update_failed", `Could not rotate API key: ${message}`);
  }

  return json({
    tenant_id: tenantId,
    api_key: nextApiKey,
    rotated_at: nowIso()
  });
}

async function deleteAllBucketObjects(bucket: R2Bucket): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const listed = await bucket.list({ cursor });
    for (const object of listed.objects) {
      await bucket.delete(object.key);
      deleted += 1;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return deleted;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

function bytesToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
