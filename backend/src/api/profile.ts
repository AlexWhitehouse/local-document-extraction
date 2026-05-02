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
};

export async function getProfileForUser(env: Env, userId: string): Promise<Response> {
  const user = await findUserById(env, userId);
  return json(profileResponse(user));
}

export async function updateProfileForUser(request: Request, env: Env, userId: string): Promise<Response> {
  const existing = await findUserById(env, userId);
  const payload = parseJsonBody<UpdateProfileBody>(await request.text());

  const hasName = payload.name !== undefined;
  if (!hasName) {
    throw new HttpError(400, "empty_patch", "PATCH body must include name");
  }

  const nextName = normalizeName(payload.name);
  const nextUpdatedAt = nowIso();

  await env.DB
    .prepare("UPDATE user SET name = ?, updatedAt = ? WHERE id = ?")
    .bind(nextName, nextUpdatedAt, userId)
    .run();

  return json(
    profileResponse({
      ...existing,
      name: nextName,
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
