import { HttpError } from "./http";
import type { Tenant } from "./types";

function hex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(digest);
}

export async function authenticate(request: Request, db: D1Database): Promise<Tenant> {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "unauthorized", "Missing bearer token");
  }

  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) {
    throw new HttpError(401, "unauthorized", "Missing API key");
  }

  const apiKeyHash = await sha256(apiKey);
  const tenant = await db
    .prepare("SELECT * FROM tenants WHERE api_key_hash = ? LIMIT 1")
    .bind(apiKeyHash)
    .first<Tenant>();

  if (!tenant) {
    throw new HttpError(401, "unauthorized", "Invalid API key");
  }

  return tenant;
}
