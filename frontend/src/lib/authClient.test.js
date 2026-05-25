import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthClientMock = vi.hoisted(() => vi.fn(() => ({ useSession: vi.fn() })));
const adminClientMock = vi.hoisted(() => vi.fn(() => ({ id: "admin-client-plugin" })));

vi.mock("better-auth/react", () => ({
  createAuthClient: createAuthClientMock,
}));

vi.mock("better-auth/client/plugins", () => ({
  adminClient: adminClientMock,
}));

import { createRuntimeAuthClient } from "./authClient";

describe("runtime auth client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://extract.t3m.uk" },
    });
  });

  it("includes Better Auth Application admin utilities on the existing runtime client", () => {
    createRuntimeAuthClient("/v1");

    expect(adminClientMock).toHaveBeenCalledOnce();
    expect(createAuthClientMock).toHaveBeenCalledWith({
      baseURL: "https://extract.t3m.uk/api/auth",
      fetchOptions: {
        credentials: "include",
      },
      plugins: [{ id: "admin-client-plugin" }],
    });
  });
});
