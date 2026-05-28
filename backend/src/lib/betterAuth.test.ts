import { beforeEach, describe, expect, it, vi } from "vitest";

const betterAuthMock = vi.hoisted(() => vi.fn());
const adminPluginMock = vi.hoisted(() => vi.fn(() => ({ id: "admin-plugin" })));

vi.mock("better-auth", () => ({
  betterAuth: betterAuthMock,
}));

vi.mock("better-auth/plugins", () => ({
  admin: adminPluginMock,
}));

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  WorkflowEntrypoint: class {},
}));

import { createAuth } from "./betterAuth";

describe("Better Auth Account email verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    betterAuthMock.mockReturnValue({ handler: vi.fn() });
  });

  it("schedules the Account email verification email when Better Auth starts verification", async () => {
    const send = vi.fn().mockResolvedValue({});
    const waitUntil = vi.fn();

    createAuth(
      createEnv({ EMAIL: { send } as unknown as Env["EMAIL"] }),
      new Request("https://extract.t3m.uk/api/auth/sign-up/email"),
      { waitUntil } as unknown as ExecutionContext,
    );

    const options = betterAuthMock.mock.calls[0][0];
    await options.emailVerification.sendVerificationEmail({
      user: { email: "ada@example.com" },
      url: "https://extract.t3m.uk/api/auth/verify-email?token=abc123&callbackURL=%2F",
      token: "abc123",
    });

    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({
      from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
      to: "ada@example.com",
      subject: "Verify your Document Extraction account",
      html: expect.stringContaining("https://extract.t3m.uk/api/auth/verify-email?token=abc123&callbackURL=%2F"),
      text: expect.stringContaining("https://extract.t3m.uk/api/auth/verify-email?token=abc123&callbackURL=%2F"),
    });
  });

  it("requires Account email verification for email/password access and resends on unverified sign-in", () => {
    createAuth(createEnv(), new Request("https://extract.t3m.uk/api/auth/sign-in/email"));

    const options = betterAuthMock.mock.calls[0][0];

    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
    });
    expect(options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
    });
  });

  it("schedules Account password reset email with one-hour expiry and session revocation", async () => {
    const send = vi.fn().mockResolvedValue({});
    const waitUntil = vi.fn();

    createAuth(
      createEnv({ EMAIL: { send } as unknown as Env["EMAIL"] }),
      new Request("https://extract.t3m.uk/api/auth/request-password-reset"),
      { waitUntil } as unknown as ExecutionContext,
    );

    const options = betterAuthMock.mock.calls[0][0];
    expect(options.emailAndPassword.resetPasswordTokenExpiresIn).toBe(60 * 60);
    expect(options.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);

    await options.emailAndPassword.sendResetPassword({
      user: { email: "ada@example.com" },
      url: "https://extract.t3m.uk/api/auth/reset-password/abc123?callbackURL=%2Freset-password",
      token: "abc123",
    });

    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith({
      from: { name: "Document Extraction", email: "no-reply@extract.t3m.uk" },
      to: "ada@example.com",
      subject: "Reset your Document Extraction password",
      html: expect.stringContaining("https://extract.t3m.uk/api/auth/reset-password/abc123?callbackURL=%2Freset-password"),
      text: expect.stringContaining("https://extract.t3m.uk/api/auth/reset-password/abc123?callbackURL=%2Freset-password"),
    });
  });

  it("configures Better Auth Application admin support without config-based admin user IDs", () => {
    createAuth(createEnv(), new Request("https://extract.t3m.uk/api/auth/session"));

    const options = betterAuthMock.mock.calls[0][0];

    expect(adminPluginMock).toHaveBeenCalledOnce();
    expect(adminPluginMock).toHaveBeenCalledWith();
    expect(options.plugins).toContainEqual({ id: "admin-plugin" });
  });

  it("includes Application admin fields in synthetic email/password user responses", () => {
    createAuth(createEnv(), new Request("https://extract.t3m.uk/api/auth/sign-in/email"));

    const options = betterAuthMock.mock.calls[0][0];
    const syntheticUser = options.emailAndPassword.customSyntheticUser({
      coreFields: {
        name: "Synthetic User",
        email: "synthetic@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      additionalFields: {},
      id: "synthetic_user",
    });

    expect(syntheticUser).toMatchObject({
      id: "synthetic_user",
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
    });
  });

  it("uses the local request origin for Account email verification links during local development", () => {
    createAuth(
      createEnv({ BETTER_AUTH_URL: "https://extract.t3m.uk" } as Partial<Env>),
      new Request("http://localhost:8787/api/auth/sign-up/email"),
    );

    const options = betterAuthMock.mock.calls[0][0];

    expect(options.baseURL).toBe("http://localhost:8787");
  });

  it("normalizes the configured production Account email verification origin to HTTPS", () => {
    createAuth(
      createEnv({ BETTER_AUTH_URL: "http://extract.t3m.uk" } as Partial<Env>),
      new Request("http://extract.t3m.uk/api/auth/sign-up/email"),
    );

    const options = betterAuthMock.mock.calls[0][0];

    expect(options.baseURL).toBe("https://extract.t3m.uk");
  });

  it("does not bootstrap a personal Workspace when an email/password account is created before Account email verification", async () => {
    const db = createWorkspaceBootstrapDb();

    createAuth(createEnv({ DB: db }), new Request("https://extract.t3m.uk/api/auth/sign-up/email"));

    const options = betterAuthMock.mock.calls[0][0];
    await options.databaseHooks.user.create.after({ id: "user_unverified", name: "Ada", emailVerified: false });

    expect(db.workspaces).toHaveLength(0);
    expect(db.memberships).toHaveLength(0);
  });

  it("bootstraps a personal Workspace after successful Account email verification", async () => {
    const db = createWorkspaceBootstrapDb();

    createAuth(createEnv({ DB: db }), new Request("https://extract.t3m.uk/api/auth/verify-email"));

    const options = betterAuthMock.mock.calls[0][0];
    await options.databaseHooks.user.update.after({ id: "user_verified", name: "Ada", emailVerified: true });

    expect(db.workspaces).toEqual([
      { id: expect.stringMatching(/^workspace_/), name: "Ada Workspace", created_by_user_id: "user_verified" },
    ]);
    expect(db.memberships).toEqual([
      { workspace_id: db.workspaces[0].id, user_id: "user_verified", role: "owner" },
    ]);
  });

  it("does not duplicate the personal Workspace when Account email verification is retried", async () => {
    const db = createWorkspaceBootstrapDb();

    createAuth(createEnv({ DB: db }), new Request("https://extract.t3m.uk/api/auth/verify-email"));

    const options = betterAuthMock.mock.calls[0][0];
    await options.databaseHooks.user.update.after({ id: "user_verified", name: "Ada", emailVerified: true });
    await options.databaseHooks.user.update.after({ id: "user_verified", name: "Ada", emailVerified: true });

    expect(db.workspaces).toHaveLength(1);
    expect(db.memberships).toEqual([
      { workspace_id: db.workspaces[0].id, user_id: "user_verified", role: "owner" },
    ]);
  });

  it("bootstraps a personal Workspace after Account email verification when the user only has a pending Workspace invitation", async () => {
    const db = createWorkspaceBootstrapDb({
      invitations: [{ email: "ada@example.com", status: "pending" }],
    });

    createAuth(createEnv({ DB: db }), new Request("https://extract.t3m.uk/api/auth/verify-email"));

    const options = betterAuthMock.mock.calls[0][0];
    await options.databaseHooks.user.update.after({
      id: "user_invited",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
    });

    expect(db.workspaces).toEqual([
      { id: expect.stringMatching(/^workspace_/), name: "Ada Workspace", created_by_user_id: "user_invited" },
    ]);
    expect(db.memberships).toEqual([
      { workspace_id: db.workspaces[0].id, user_id: "user_invited", role: "owner" },
    ]);
  });

  it("bootstraps a personal Workspace for a trusted social sign-in user with verified email", async () => {
    const send = vi.fn().mockResolvedValue({});
    const db = createWorkspaceBootstrapDb();

    createAuth(
      createEnv({
        DB: db,
        EMAIL: { send } as unknown as Env["EMAIL"],
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
      }),
      new Request("https://extract.t3m.uk/api/auth/callback/google"),
    );

    const options = betterAuthMock.mock.calls[0][0];
    await options.databaseHooks.user.create.after({
      id: "user_google",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
    });

    expect(options.socialProviders).toHaveProperty("google");
    expect(send).not.toHaveBeenCalled();
    expect(db.workspaces).toEqual([
      { id: expect.stringMatching(/^workspace_/), name: "Ada Workspace", created_by_user_id: "user_google" },
    ]);
    expect(db.memberships).toEqual([
      { workspace_id: db.workspaces[0].id, user_id: "user_google", role: "owner" },
    ]);
  });
});

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    BETTER_AUTH_SECRET: "test-secret",
    DB: {} as D1Database,
    WORKSPACE_PRODUCT_STORE: createProductStoreBinding(),
    ...overrides,
  } as Env;
}

function createProductStoreBinding(): Env["WORKSPACE_PRODUCT_STORE"] {
  return {
    getByName: () => ({
      createTemplate: async () => ({ template_id: "tpl_starter", version: 1, status: "active" }),
    }),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}

function createWorkspaceBootstrapDb(input: { invitations?: Array<{ email: string; status: string }> } = {}) {
  const state = {
    workspaces: [] as Array<{ id: string; name: string; created_by_user_id: string }>,
    memberships: [] as Array<{ workspace_id: string; user_id: string; role: string }>,
    invitations: input.invitations ?? [],
  };

  const db = {
    workspaces: state.workspaces,
    memberships: state.memberships,
    invitations: state.invitations,
    async batch(statements: D1PreparedStatement[]) {
      for (const statement of statements) {
        await statement.run();
      }
      return [];
    },
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first() {
              if (sql.includes("SELECT workspace_id FROM workspace_memberships")) {
                const userId = String(params[0]);
                return state.memberships.find((membership) => membership.user_id === userId) ?? null;
              }
              throw new Error(`Unhandled first SQL: ${sql}`);
            },
            async run() {
              if (sql.includes("INSERT INTO workspaces")) {
                const [id, , name, , createdByUserId] = params;
                state.workspaces.push({ id: String(id), name: String(name), created_by_user_id: String(createdByUserId) });
                return { success: true };
              }
              if (sql.includes("INSERT INTO workspace_memberships")) {
                const [workspaceId, userId] = params;
                state.memberships.push({ workspace_id: String(workspaceId), user_id: String(userId), role: "owner" });
                return { success: true };
              }
              if (sql.includes("INSERT INTO templates") || sql.includes("INSERT INTO template_fields")) {
                return { success: true };
              }
              throw new Error(`Unhandled run SQL: ${sql}`);
            },
          };
        },
      };
    },
  };

  return db as unknown as D1Database & typeof state;
}
