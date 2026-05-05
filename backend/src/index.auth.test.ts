import { beforeEach, describe, expect, it, vi } from "vitest";

const authHandlerMock = vi.hoisted(() => vi.fn());
const createAuthMock = vi.hoisted(() => vi.fn());

vi.mock("./lib/betterAuth", () => ({
  createAuth: createAuthMock,
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

import worker from "./index";
import type { Env } from "./lib/types";

function createEnv(): Env {
  return {
    BETTER_AUTH_SECRET: "test-secret",
    DB: {} as D1Database,
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
});
