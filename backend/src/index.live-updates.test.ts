import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/auth", () => ({
  authenticate: vi.fn(),
  requireSession: requireSessionMock,
}));

vi.mock("./lib/betterAuth", () => ({
  createAuth: vi.fn(),
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

describe("Workspace live update route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-WebSocket live update requests before invoking the Workspace product store", async () => {
    const productStoreBinding = {
      getByName: vi.fn(() => {
        throw new Error("Workspace product store should not receive invalid live update requests");
      }),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"];

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/live", {
        method: "GET",
      }),
      { WORKSPACE_PRODUCT_STORE: productStoreBinding } as Env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_websocket_upgrade",
        message: "Expected WebSocket upgrade",
      },
    });
    expect(productStoreBinding.getByName).not.toHaveBeenCalled();
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("proxies accepted Workspace live update sockets to the Workspace product store", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_test",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    const productStore = {
      fetch: vi.fn(async (_request: Request) => new Response("live accepted")),
    };
    const productStoreBinding = {
      getByName: vi.fn(() => productStore),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
    const env = {
      DB: createWorkspaceMembershipDb({
        id: "workspace_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        created_by_user_id: "user_test",
        api_key_hash: null,
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: null,
      }),
      WORKSPACE_PRODUCT_STORE: productStoreBinding,
    } as Env;

    const request = new Request("https://example.com/v1/workspaces/workspace_test/live", {
      method: "GET",
      headers: { upgrade: "websocket" },
    });
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("live accepted");
    expect(requireSessionMock).toHaveBeenCalledWith(request, env);
    expect(productStoreBinding.getByName).toHaveBeenCalledWith("workspace_test");
    const proxiedRequest = productStore.fetch.mock.calls[0]?.[0] as Request | undefined;
    expect(proxiedRequest?.url).toBe(request.url);
    expect(proxiedRequest?.method).toBe(request.method);
    expect(proxiedRequest?.headers.get("upgrade")).toBe("websocket");
  });

  it("proxies accepted Workspace live update sockets with private session identity metadata", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_test",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    const productStore = {
      fetch: vi.fn(async (_request: Request) => new Response("live accepted")),
    };
    const productStoreBinding = {
      getByName: vi.fn(() => productStore),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"];
    const env = {
      DB: createWorkspaceMembershipDb({
        id: "workspace_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        created_by_user_id: "user_owner",
        api_key_hash: null,
        rate_limit_per_minute: null,
        max_templates: null,
        max_fields_per_template: null,
        max_source_file_bytes: null,
      }),
      WORKSPACE_PRODUCT_STORE: productStoreBinding,
    } as Env;

    const request = new Request("https://example.com/v1/workspaces/workspace_test/live", {
      method: "GET",
      headers: { upgrade: "websocket" },
    });
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    const proxiedRequest = productStore.fetch.mock.calls[0]?.[0] as Request | undefined;
    expect(proxiedRequest?.headers.get("x-workspace-live-user-id")).toBe("user_test");
    expect(proxiedRequest?.headers.get("x-workspace-live-workspace-id")).toBe("workspace_test");
  });

  it("rejects Workspace API key live update requests", async () => {
    const productStoreBinding = {
      getByName: vi.fn(() => {
        throw new Error("Workspace product store should not receive API key live update requests");
      }),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"];

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/live", {
        method: "GET",
        headers: {
          authorization: "Bearer workspace-api-key",
          upgrade: "websocket",
        },
      }),
      { WORKSPACE_PRODUCT_STORE: productStoreBinding } as Env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "unsupported_auth_mode",
        message: "Workspace API keys cannot open live updates",
      },
    });
    expect(productStoreBinding.getByName).not.toHaveBeenCalled();
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("rejects non-GET live update requests before invoking the Workspace product store", async () => {
    const productStoreBinding = {
      getByName: vi.fn(() => {
        throw new Error("Workspace product store should not receive non-GET live update requests");
      }),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"];

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/live", {
        method: "POST",
        headers: { upgrade: "websocket" },
      }),
      { WORKSPACE_PRODUCT_STORE: productStoreBinding } as Env,
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "method_not_allowed",
        message: "Workspace live updates require GET",
      },
    });
    expect(productStoreBinding.getByName).not.toHaveBeenCalled();
    expect(requireSessionMock).not.toHaveBeenCalled();
  });

  it("rejects signed-in users without Workspace membership", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_test",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
    const productStoreBinding = {
      getByName: vi.fn(() => {
        throw new Error("Workspace product store should not receive forbidden live update requests");
      }),
    } as unknown as Env["WORKSPACE_PRODUCT_STORE"];

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/live", {
        method: "GET",
        headers: { upgrade: "websocket" },
      }),
      {
        DB: createWorkspaceMembershipDb(null),
        WORKSPACE_PRODUCT_STORE: productStoreBinding,
      } as Env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace",
      },
    });
    expect(productStoreBinding.getByName).not.toHaveBeenCalled();
  });
});

describe("Selected Workspace context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the selected accepted Workspace context for a signed-in session", async () => {
    requireSessionMock.mockResolvedValue({
      id: "user_test",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });

    const response = await worker.fetch(
      new Request("https://example.com/v1/workspaces/workspace_test/context", {
        method: "GET",
      }),
      {
        DB: createSelectedWorkspaceContextDb(),
      } as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspace: {
        id: "workspace_test",
        name: "Research",
        created_at: "2026-05-06T12:00:00.000Z",
        max_source_file_bytes: 2048,
        has_api_key: true,
        role: "admin",
        billing_plan_limits: {
          templates: 3,
          top_level_template_fields: 5,
          table_shaped_fields: 1,
          table_columns_per_field: 5,
          members: 3,
          monthly_pages: 500,
          api_access: false,
        },
        billing_usage_summary: {
          remaining_credits: 0,
          remaining_pages: 500,
        },
      },
    });
  });
});

function createWorkspaceMembershipDb(workspace: Record<string, unknown> | null): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => workspace),
      })),
    })),
  } as unknown as D1Database;
}

function createSelectedWorkspaceContextDb(): D1Database {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        first: vi.fn(async () => {
          if (
            sql.includes("JOIN workspaces t ON t.id = m.workspace_id") &&
            sql.includes("WHERE m.user_id = ? AND t.id = ?")
          ) {
            const [userId, workspaceId] = params;
            if (userId !== "user_test" || workspaceId !== "workspace_test") {
              return null;
            }
            return {
              id: "workspace_test",
              name: "Research",
              created_at: "2026-05-06T12:00:00.000Z",
              max_source_file_bytes: 2048,
              has_api_key: 1,
              role: "admin",
            };
          }

          if (
            sql.includes("self_service_subscription_plan") &&
            sql.includes("FROM workspace_billing_controls")
          ) {
            return null;
          }

          throw new Error(`Unhandled selected Workspace context SQL: ${sql}`);
        }),
      })),
    })),
  } as unknown as D1Database;
}
