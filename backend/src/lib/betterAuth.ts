import { betterAuth } from "better-auth";
import { createStarterInvoiceTemplate } from "./starterTemplateAdapter";
import { bootstrapWorkspaceForNewUser } from "./workspacePolicy";
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
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
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
      enabled: true,
      minPasswordLength: 8
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
  await bootstrapWorkspaceForNewUser(env.DB, { userId, userName }, createStarterInvoiceTemplate(env.DB));
}
