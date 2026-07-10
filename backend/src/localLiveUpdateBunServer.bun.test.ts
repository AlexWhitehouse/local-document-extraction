import { expect, test } from "bun:test";

import { createLocalLiveUpdateHub } from "./localLiveUpdateHub";
import { upgradeLocalLiveUpdate } from "./localLiveUpdateUpgrade";

test("the Bun server upgrades the session Workspace live update route and delivers lifecycle messages", async () => {
  const hub = createLocalLiveUpdateHub();
  const auth = {
    getSession: async () => ({ id: "user_ada", email: "ada@example.com", name: "Ada" }),
  };
  const workspaceControl = {
    getAcceptedWorkspaceContext: ({ workspaceId, userId }: { workspaceId: string; userId: string }) =>
      workspaceId === "workspace_research" && userId === "user_ada" ? { id: workspaceId } : null,
  };
  const server = Bun.serve<{ workspaceId: string }>({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, bunServer) => upgradeLocalLiveUpdate({
      auth: auth as never,
      request,
      server: bunServer,
      workspaceControl: workspaceControl as never,
    }),
    websocket: {
      close: (socket) => {
        hub.unsubscribe({ workspaceId: socket.data.workspaceId, socket });
      },
      message: () => {},
      open: (socket) => {
        hub.subscribe({ workspaceId: socket.data.workspaceId, socket });
      },
    },
  });

  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/v1/workspaces/workspace_research/live`);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Live update WebSocket failed to open"));
    });
    const message = new Promise<string>((resolve, reject) => {
      socket.onmessage = (event) => resolve(String(event.data));
      socket.onerror = () => reject(new Error("Live update WebSocket failed while receiving"));
    });
    hub.broadcastJob("workspace_research", {
      job_id: "job_invoice",
      status: "processing",
      template_id: "tpl_invoice",
      template_version: 1,
      error_code: null,
      error_message: null,
      created_at: "2026-07-09T12:00:00.000Z",
      updated_at: "2026-07-09T12:01:00.000Z",
      completed_at: null,
      current_attempt: 1,
      completed_attempt: 0,
      last_failed_attempt: 0,
    });

    await expect(message).resolves.toContain('"status":"processing"');
    socket.close();
  } finally {
    server.stop(true);
  }
});
