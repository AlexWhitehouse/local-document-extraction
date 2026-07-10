import { expect, test } from "bun:test";

import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";

test("local live updates require an accepted session Workspace and reject API keys", async () => {
  const upgrades: Array<{ workspaceId: string }> = [];
  const server = {
    upgrade: (_request: Request, options: { data: { workspaceId: string } }) => {
      upgrades.push(options.data);
      return true;
    },
  };
  const auth = {
    getSession: async () => ({ id: "user_ada", email: "ada@example.com", name: "Ada" }),
  };
  const workspaceControl = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
      workspaceId === "workspace_research" && userId === "user_ada"
        ? { id: workspaceId }
        : null,
  };

  const upgraded = await upgradeLocalLiveUpdate({
    auth: auth as never,
    request: new Request("http://127.0.0.1:8787/v1/workspaces/workspace_research/live", {
      headers: { upgrade: "websocket" },
    }),
    server,
    workspaceControl: workspaceControl as never,
  });
  expect(upgraded).toBeUndefined();
  expect(upgrades).toEqual([{ workspaceId: "workspace_research" }]);

  const apiKeyResponse = await upgradeLocalLiveUpdate({
    auth: auth as never,
    request: new Request("http://127.0.0.1:8787/v1/workspaces/workspace_research/live", {
      headers: { authorization: "Bearer workspace-key", upgrade: "websocket" },
    }),
    server,
    workspaceControl: workspaceControl as never,
  });
  expect(apiKeyResponse?.status).toBe(403);
  await expect(apiKeyResponse?.json()).resolves.toEqual({
    error: { code: "unsupported_auth_mode", message: "Workspace API keys cannot open live updates" },
  });

  const forbiddenResponse = await upgradeLocalLiveUpdate({
    auth: auth as never,
    request: new Request("http://127.0.0.1:8787/v1/workspaces/workspace_legal/live", {
      headers: { upgrade: "websocket" },
    }),
    server,
    workspaceControl: workspaceControl as never,
  });
  expect(forbiddenResponse?.status).toBe(403);
  expect(upgrades).toEqual([{ workspaceId: "workspace_research" }]);
});
