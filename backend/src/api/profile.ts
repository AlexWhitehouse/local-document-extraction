import { HttpError, json } from "../lib/http";
import { nowIso } from "../lib/ids";
import { parseJsonBody } from "../lib/validation";
import type { Env } from "../lib/types";

type UserRow = {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  createdAt: string;
  updatedAt: string;
};

type UpdateProfileBody = {
  name?: unknown;
  email?: unknown;
};

export async function getProfileForUser(env: Env, userId: string): Promise<Response> {
  const user = await findUserById(env, userId);
  return json(profileResponse(user));
}

export async function updateProfileForUser(request: Request, env: Env, userId: string): Promise<Response> {
  const existing = await findUserById(env, userId);
  const payload = parseJsonBody<UpdateProfileBody>(await request.text());

  const hasName = payload.name !== undefined;
  const hasEmail = payload.email !== undefined;
  if (!hasName && !hasEmail) {
    throw new HttpError(400, "empty_patch", "PATCH body must include name or email");
  }

  const nextName = hasName ? normalizeName(payload.name) : existing.name;
  const nextEmail = hasEmail ? normalizeEmail(payload.email) : existing.email;
  const nextUpdatedAt = nowIso();

  try {
    await env.DB
      .prepare("UPDATE user SET name = ?, email = ?, updatedAt = ? WHERE id = ?")
      .bind(nextName, nextEmail, nextUpdatedAt, userId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed: user.email")) {
      throw new HttpError(409, "email_in_use", "Email is already in use");
    }
    throw error;
  }

  return json(
    profileResponse({
      ...existing,
      name: nextName,
      email: nextEmail,
      updatedAt: nextUpdatedAt
    })
  );
}

async function findUserById(env: Env, userId: string): Promise<UserRow> {
  const user = await env.DB
    .prepare("SELECT id, name, email, emailVerified, createdAt, updatedAt FROM user WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<UserRow>();

  if (!user) {
    throw new HttpError(404, "not_found", "User not found");
  }

  return user;
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, "invalid_name", "name must be a non-empty string");
  }
  return value.trim();
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_email", "email must be a valid address");
  }

  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new HttpError(400, "invalid_email", "email must be a valid address");
  }

  return email;
}

function profileResponse(user: UserRow) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    email_verified: Boolean(user.emailVerified),
    created_at: user.createdAt,
    updated_at: user.updatedAt
  };
}
