import { beforeEach, describe, expect, it, vi } from "vitest";

const authHandlerMock = vi.hoisted(() => vi.fn());
const createAuthMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/betterAuth", () => ({
  createAuth: createAuthMock,
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

import worker from "./index";
import { hashWorkspaceApiKey } from "./lib/workspacePolicy";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    BETTER_AUTH_SECRET: "test-secret",
    DB: {} as D1Database,
    ...overrides,
  } as Env;
}

describe("auth request handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects weak email/password sign-up before normal auth handling", async () => {
    createAuthMock.mockReturnValue({ handler: authHandlerMock });
    authHandlerMock.mockResolvedValue(new Response(null, { status: 201 }));

    const response = await worker.fetch(
      new Request("https://example.com/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ada Lovelace",
          email: "ada@example.com",
          password: "password",
        }),
      }),
      createEnv(),
    );

    await expect(response.json()).resolves.toEqual({
      error: {
        code: "password_policy_not_met",
        message: "Password must meet all complexity requirements.",
      },
    });
    expect(response.status).toBe(400);
    expect(authHandlerMock).not.toHaveBeenCalled();
  });

  it("passes strong email/password sign-up to normal auth handling", async () => {
    createAuthMock.mockReturnValue({ handler: authHandlerMock });
    authHandlerMock.mockImplementation(async (request: Request) => {
      return Response.json(await request.json(), { status: 202 });
    });

    const body = {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "Strong1!",
    };

    const response = await worker.fetch(
      new Request("https://example.com/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      createEnv(),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(body);
    expect(authHandlerMock).toHaveBeenCalledOnce();
  });

  it("rejects weak Account password reset before normal auth handling", async () => {
    createAuthMock.mockReturnValue({ handler: authHandlerMock });
    authHandlerMock.mockResolvedValue(new Response(null, { status: 200 }));

    const response = await worker.fetch(
      new Request("https://example.com/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: "reset_token",
          newPassword: "password",
        }),
      }),
      createEnv(),
    );

    await expect(response.json()).resolves.toEqual({
      error: {
        code: "password_policy_not_met",
        message: "Password must meet all complexity requirements.",
      },
    });
    expect(response.status).toBe(400);
    expect(authHandlerMock).not.toHaveBeenCalled();
  });

  it("passes strong Account password reset to normal auth handling", async () => {
    createAuthMock.mockReturnValue({ handler: authHandlerMock });
    authHandlerMock.mockImplementation(async (request: Request) => {
      return Response.json(await request.json(), { status: 200 });
    });

    const body = {
      token: "reset_token",
      newPassword: "Strong1!",
    };

    const response = await worker.fetch(
      new Request("https://example.com/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(body);
    expect(authHandlerMock).toHaveBeenCalledOnce();
  });

  it("provides Worker scheduling context to auth request handling", async () => {
    createAuthMock.mockReturnValue({ handler: authHandlerMock });
    authHandlerMock.mockResolvedValue(new Response(null, { status: 202 }));
    const env = createEnv();
    const request = new Request("https://example.com/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "Strong1!" }),
    });
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

    const response = await worker.fetch(request, env, ctx);

    expect(response.status).toBe(202);
    expect(createAuthMock).toHaveBeenCalledWith(env, request, ctx);
  });

  it("rejects Workspace API-key-authenticated leave requests as session-only actions", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_123/leave", {
        method: "POST",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      createEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required",
      },
    });
  });

  it("accepts Workspace API keys on workspace-scoped product routes", async () => {
    const apiKey = "workspace-api-key";
    const apiKeyHash = await hashWorkspaceApiKey(apiKey);
    const db = createProductRouteDb(apiKeyHash);

    const response = await worker.fetch(
      new Request("https://example.com/v1/templates", {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      }),
      createEnv({
        DB: db,
        WORKSPACE_PRODUCT_STORE: createProductStoreBinding([
          {
            id: "template_1",
            name: "Invoices",
            description: null,
            status: "active",
            current_version: 1,
            created_at: "2026-05-01T00:00:00.000Z",
            updated_at: "2026-05-01T00:00:00.000Z",
          },
        ]),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      templates: [
        {
          id: "template_1",
          name: "Invoices",
          description: null,
          status: "active",
          current_version: 1,
          created_at: "2026-05-01T00:00:00.000Z",
          updated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
    expect(createAuthMock).not.toHaveBeenCalled();
  });

  it("rejects Workspace API keys on profile routes", async () => {
    createAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/profile", {
        method: "GET",
        headers: { authorization: "Bearer workspace-api-key" },
      }),
      createEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required",
      },
    });
  });
});

function createProductRouteDb(apiKeyHash: string): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM workspaces WHERE api_key_hash = ?")) {
            return params[0] === apiKeyHash
              ? {
                  id: "workspace_1",
                  api_key_hash: apiKeyHash,
                  name: "Research",
                  created_at: "2026-05-01T00:00:00.000Z",
                  created_by_user_id: "user_1",
                  rate_limit_per_minute: null,
                  max_templates: null,
                  max_fields_per_template: null,
                  max_source_file_bytes: null,
                }
              : null;
          }

          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
      })),
    })),
  } as unknown as D1Database;
}

function createProductStoreBinding(templates: Array<Record<string, unknown>>): Env["WORKSPACE_PRODUCT_STORE"] {
  return {
    getByName: vi.fn((workspaceId: string) => {
      expect(workspaceId).toBe("workspace_1");
      return {
        listTemplates: vi.fn(async () => templates),
      };
    }),
  } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
}
