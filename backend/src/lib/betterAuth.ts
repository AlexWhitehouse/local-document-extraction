import { betterAuth } from "better-auth";
import { newId, nowIso } from "./ids";
import type { Env } from "./types";

function trustedOriginsFromEnv(env: Env): string[] {
  const configured = (env.BETTER_AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return [
    ...configured,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8787",
    "http://127.0.0.1:8787"
  ];
}

export function createAuth(env: Env, request: Request) {
  const baseURL = env.BETTER_AUTH_URL || new URL(request.url).origin;
  const secret = env.BETTER_AUTH_SECRET || "local-secret-change-me-32-chars-min";
  const googleClientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const googleClientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  const socialProviders =
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            prompt: "select_account" as const
          }
        }
      : undefined;

  return betterAuth({
    appName: "imageextraction",
    database: env.DB,
    baseURL,
    secret,
    trustedOrigins: trustedOriginsFromEnv(env),
    emailAndPassword: {
      enabled: true
    },
    ...(socialProviders ? { socialProviders } : {}),
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await bootstrapUserWorkspace(env, user.id, user.name);
          }
        }
      }
    }
  });
}

async function bootstrapUserWorkspace(env: Env, userId: string, userName: string) {
  const existing = await env.DB
    .prepare("SELECT workspace_id FROM workspace_memberships WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<{ workspace_id: string }>();

  if (existing) {
    return;
  }

  const now = nowIso();
  const workspaceId = newId("workspace");
  const apiKey = newId("key");
  const templateId = newId("tpl");
  const apiKeyHash = await sha256(apiKey);
  const workspaceName = `${(userName || "New").trim() || "New"} Workspace`;

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO workspaces (id, api_key_hash, name, created_at, created_by_user_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(workspaceId, apiKeyHash, workspaceName, now, userId),
    env.DB
      .prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES (?, ?, 'owner', ?)`
      )
      .bind(workspaceId, userId, now),
    env.DB
      .prepare(
        `INSERT INTO templates (id, workspace_id, name, description, status, current_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`
      )
      .bind(
        templateId,
        workspaceId,
        "Example Invoice",
        "Starter template that extracts key invoice fields for quick testing.",
        now,
        now
      ),
    env.DB
      .prepare(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
         VALUES (?, 1, 'invoice_number', 'Invoice Number', 'Unique invoice identifier.', 'string', 1, 1)`
      )
      .bind(templateId),
    env.DB
      .prepare(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
         VALUES (?, 1, 'invoice_date', 'Invoice Date', 'Date shown on the invoice.', 'date', 1, 2)`
      )
      .bind(templateId),
    env.DB
      .prepare(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
         VALUES (?, 1, 'vendor_name', 'Vendor Name', 'Name of the supplier issuing the invoice.', 'string', 1, 3)`
      )
      .bind(templateId),
    env.DB
      .prepare(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
         VALUES (?, 1, 'total_amount', 'Total Amount', 'Total amount due on the invoice.', 'number', 1, 4)`
      )
      .bind(templateId),
    env.DB
      .prepare(
        `INSERT INTO template_fields (template_id, version, field_id, name, description, data_type, required, position)
         VALUES (?, 1, 'currency', 'Currency', 'Currency code used for the totals (e.g. USD).', 'string', 0, 5)`
      )
      .bind(templateId)
  ]);
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
