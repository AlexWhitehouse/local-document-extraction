import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin } from "better-auth/plugins";
import type { Database } from "bun:sqlite";

import { renderAccountEmailVerificationEmail } from "./lib/email/accountEmailVerification";
import { renderAccountPasswordResetEmail } from "./lib/email/accountPasswordReset";
import type { LocalMailSink } from "./localMailSink";

type LocalAuthLogger = {
  error(message: string, error: unknown): void;
};

export type LocalAuth = {
  getSession(request: Request): Promise<LocalSession | null>;
  handler(request: Request): Promise<Response>;
};

export type LocalSession = {
  id: string;
  email: string;
  name: string;
  role?: string;
};

export async function createLocalAuth({
  adminEmails = [],
  baseURL,
  database,
  googleClientId,
  googleClientSecret,
  logger = console,
  mailSink,
  secret,
}: {
  adminEmails?: string[];
  baseURL: string;
  database: Database;
  googleClientId?: string;
  googleClientSecret?: string;
  logger?: LocalAuthLogger;
  mailSink: LocalMailSink;
  secret: string;
}): Promise<LocalAuth> {
  const configuredAdminEmails = new Set(adminEmails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  const configuredGoogleClientId = googleClientId?.trim();
  const configuredGoogleClientSecret = googleClientSecret?.trim();
  const socialProviders = configuredGoogleClientId && configuredGoogleClientSecret
    ? {
        google: {
          clientId: configuredGoogleClientId,
          clientSecret: configuredGoogleClientSecret,
          prompt: "select_account" as const,
        },
      }
    : undefined;
  const auth = betterAuth({
    appName: "Document Extraction",
    baseURL,
    database,
    secret,
    trustedOrigins: localTrustedOrigins(baseURL),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        captureMail(mailSink, logger, {
          ...renderAccountPasswordResetEmail({ resetUrl: url }),
          to: user.email,
          type: "account_password_reset",
        });
      },
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        captureMail(mailSink, logger, {
          ...renderAccountEmailVerificationEmail({ verificationUrl: url }),
          to: user.email,
          type: "account_email_verification",
        });
      },
    },
    ...(socialProviders ? { socialProviders } : {}),
    plugins: [admin()],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            if (configuredAdminEmails.has(user.email.trim().toLowerCase())) {
              database.query("UPDATE user SET role = 'admin' WHERE id = ?").run(user.id);
            }
          },
        },
      },
    },
  });

  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();

  const handler = async (request: Request): Promise<Response> => {
    const session = await auth.api.getSession({ headers: request.headers });
    const rejection = await validateLocalAdminAction(request, {
      id: session?.user?.id ?? undefined,
      role: session?.user?.role ?? undefined,
    });
    return rejection ?? auth.handler(request);
  };

  return {
    getSession: async (request) => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user?.id) {
        return null;
      }

      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        ...(typeof session.user.role === "string" ? { role: session.user.role } : {}),
      };
    },
    handler,
  };
}

async function validateLocalAdminAction(
  request: Request,
  sessionUser: { id?: string; role?: string },
): Promise<Response | null> {
  if (request.method !== "POST" || sessionUser.role !== "admin") {
    return null;
  }

  const path = new URL(request.url).pathname;
  if (path !== "/api/auth/admin/set-role" && path !== "/api/auth/admin/ban-user") {
    return null;
  }

  const body = await request.clone().json().catch(() => null) as { banReason?: unknown; role?: unknown; userId?: unknown } | null;
  if (path === "/api/auth/admin/set-role" && typeof body?.userId === "string" && body.userId === sessionUser.id) {
    return Response.json({
      code: "local_admin_self_role_change_not_allowed",
      message: "Application admins cannot change their own role.",
    }, { status: 400 });
  }

  if (path === "/api/auth/admin/set-role" && body?.role !== "admin" && body?.role !== "user") {
    return Response.json({
      code: "local_application_role_not_allowed",
      message: "Application roles must be admin or user.",
    }, { status: 400 });
  }

  if (path === "/api/auth/admin/ban-user" && (typeof body?.banReason !== "string" || !body.banReason.trim())) {
    return Response.json({
      code: "local_admin_ban_reason_required",
      message: "A ban reason is required.",
    }, { status: 400 });
  }

  return null;
}

function captureMail(
  mailSink: LocalMailSink,
  logger: LocalAuthLogger,
  message: Parameters<LocalMailSink["capture"]>[0],
): void {
  void mailSink.capture(message).catch((error) => {
    logger.error("Local transactional email capture failed", error);
  });
}

function localTrustedOrigins(baseURL: string): string[] {
  return [
    baseURL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8787",
    "http://127.0.0.1:8787",
  ];
}
