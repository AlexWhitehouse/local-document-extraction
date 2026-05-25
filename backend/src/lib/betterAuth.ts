import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { renderAccountEmailVerificationEmail } from "./email/accountEmailVerification";
import { scheduleTransactionalEmailSend } from "./email/transactionalEmail";
import { createStarterInvoiceTemplate } from "./starterTemplateAdapter";
import { bootstrapWorkspaceForNewUser } from "./workspacePolicy";

type AuthEnv = Env & {
  BETTER_AUTH_URL?: string;
};

function trustedOriginsFromEnv(env: AuthEnv): string[] {
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

function resolveAuthBaseURL(env: AuthEnv, request: Request): string {
  const requestOrigin = new URL(request.url).origin;
  if (isLocalOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return normalizeAuthOrigin(env.BETTER_AUTH_URL || requestOrigin);
}

function normalizeAuthOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
    url.protocol = "https:";
  }
  return url.origin;
}

function isLocalOrigin(origin: string): boolean {
  return isLocalHostname(new URL(origin).hostname);
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function createAuth(env: AuthEnv, request: Request, ctx?: ExecutionContext) {
  const baseURL = resolveAuthBaseURL(env, request);
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
      minPasswordLength: 8,
      requireEmailVerification: true,
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      })
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        scheduleTransactionalEmailSend({
          email: env.EMAIL,
          ctx,
          message: {
            ...renderAccountEmailVerificationEmail({ verificationUrl: url }),
            to: user.email,
          },
        });
      }
    },
    ...(socialProviders ? { socialProviders } : {}),
    plugins: [admin()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (user.emailVerified) {
              await bootstrapUserWorkspace(env, user.id, user.name);
            }
          }
        },
        update: {
          after: async (user) => {
            if (user.emailVerified) {
              await bootstrapUserWorkspace(env, user.id, user.name);
            }
          }
        }
      }
    }
  });
}

async function bootstrapUserWorkspace(env: Env, userId: string, userName: string) {
  await bootstrapWorkspaceForNewUser(env.DB, { userId, userName }, createStarterInvoiceTemplate(env.DB));
}
