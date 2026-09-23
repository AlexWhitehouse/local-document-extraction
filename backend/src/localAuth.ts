import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { admin } from "better-auth/plugins/admin";
import { defaultAc, userAc } from "better-auth/plugins/admin/access";
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
  isTrustedOrigin?(origin: string): boolean;
};

export type LocalSession = {
  id: string;
  email: string;
  name: string;
  role?: string;
  /** Revalidate the persisted session immediately before delivering live data. */
  isActive?: () => boolean;
};

export type LocalAuthSettings = {
  emailPasswordEnabled?: boolean;
  googleEnabled?: boolean;
  signupEnabled?: boolean;
  requireEmailVerification?: boolean;
  trustedOrigins?: string[];
  trustedIpHeaders?: string[];
  emailFrom?: { name: string; email: string };
};

export async function createLocalAuth({
  adminEmails = [],
  baseURL,
  database,
  googleClientId,
  googleClientSecret,
  emailPasswordEnabled = true,
  googleEnabled = false,
  signupEnabled = true,
  requireEmailVerification = false,
  trustedOrigins = [],
  trustedIpHeaders = [],
  emailFrom,
  logger = console,
  mailSink,
  secret,
}: LocalAuthSettings & {
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
  const socialProviders = googleEnabled && configuredGoogleClientId && configuredGoogleClientSecret
    ? {
        google: {
          clientId: configuredGoogleClientId,
          clientSecret: configuredGoogleClientSecret,
          disableSignUp: !signupEnabled,
          prompt: "select_account" as const,
        },
      }
    : undefined;
  const auth = betterAuth({
    advanced: {
      ipAddress: {
        ipAddressHeaders: trustedIpHeaders,
      },
    },
    appName: "Document Extraction",
    baseURL,
    database,
    secret,
    trustedOrigins: localTrustedOrigins(baseURL, trustedOrigins),
    emailAndPassword: {
      enabled: emailPasswordEnabled,
      disableSignUp: !signupEnabled,
      minPasswordLength: 8,
      requireEmailVerification,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await captureMail(mailSink, logger, {
          ...renderAccountPasswordResetEmail({ resetUrl: url, from: emailFrom }),
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
      sendOnSignUp: requireEmailVerification,
      sendOnSignIn: requireEmailVerification,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await captureMail(mailSink, logger, {
          ...renderAccountEmailVerificationEmail({ verificationUrl: url, from: emailFrom }),
          to: user.email,
          type: "account_email_verification",
        });
      },
    },
    ...(socialProviders ? { socialProviders } : {}),
    plugins: [admin({ roles: {
      admin: defaultAc.newRole({ user: ["list", "set-role", "ban", "impersonate"], session: [] }),
      user: userAc,
    } })],
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
    isTrustedOrigin: (origin) => localTrustedOrigins(baseURL, trustedOrigins).includes(origin),
    getSession: async (request) => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session?.user?.id) {
        return null;
      }

      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        isActive: () => Boolean(database.query(`SELECT 1 FROM session s JOIN user u ON u.id = s.userId
          WHERE s.id = ? AND s.userId = ? AND s.expiresAt > ?
          AND (u.banned IS NOT 1 OR (u.banExpires IS NOT NULL AND u.banExpires <= ?))`)
          .get(session.session.id, session.user.id, Date.now(), Date.now())),
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

  const path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, "");
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

async function captureMail(
  mailSink: LocalMailSink,
  logger: LocalAuthLogger,
  message: Parameters<LocalMailSink["capture"]>[0],
): Promise<void> {
  try { await mailSink.capture(message); }
  catch {
    const error = new Error("Transactional email delivery failed. Check the configured email provider.");
    logger.error("Transactional email delivery failed", error);
    throw error;
  }
}

export function localTrustedOrigins(baseURL: string, additionalOrigins: string[] = []): string[] {
  const url = new URL(baseURL);
  const localOrigins = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ? ["http://localhost:5173", "http://127.0.0.1:5173", ...["localhost", "127.0.0.1"].map((host) => `${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`)]
    : [];
  return [...new Set([url.origin, ...localOrigins, ...additionalOrigins])];
}
